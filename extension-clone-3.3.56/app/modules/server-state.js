import { getCloudFunctionBase } from './payos.js';
import { getActiveAccountId, getPrimaryWistorixAccessToken, getPrimaryWistorixAccount } from './account-manager.js';

const PENDING_SETTLEMENTS_KEY = 'ws_server_state_pending_settlements_v1';
const REQUEST_TIMEOUT_MS = 15000;
const PROFILE_CACHE_TTL_MS = 3000;
const HISTORY_CACHE_TTL_MS = 30000;
const SERVER_ENDPOINTS = Object.freeze({
  profile: 'getServerProfile',
  history: 'getCleanupHistory',
  reserve: 'reserveCleanup',
  complete: 'completeCleanup',
  fail: 'failCleanup'
});

function runtimeError(code, fallback, status = null) {
  const error = new Error(fallback || code);
  error.code = code;
  if (Number.isFinite(status)) error.status = status;
  return error;
}

function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return `cleanup_${globalThis.crypto.randomUUID().replace(/-/g, '')}`;
  const bytes = new Uint8Array(24);
  globalThis.crypto?.getRandomValues?.(bytes);
  return `cleanup_${Array.from(bytes).map(value => value.toString(16).padStart(2, '0')).join('') || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

function storageGet(key) {
  return new Promise(resolve => chrome.storage.local.get([key], value => resolve(value[key])));
}

function storageSet(value) {
  return new Promise(resolve => chrome.storage.local.set(value, resolve));
}

export function createServerStateClient({
  getBase = getCloudFunctionBase,
  getToken = () => getPrimaryWistorixAccessToken({ interactive: false }),
  getAccountKey = async () => (await getPrimaryWistorixAccount().catch(() => null))?.id || null,
  getDriveAccountId = async () => getActiveAccountId(),
  fetchFn = fetch,
  cacheGet = storageGet,
  cacheSet = storageSet
} = {}) {
  const profileInFlight = new Map();
  const profileMemory = new Map();
  const historyInFlight = new Map();
  const historyMemory = new Map();
  let authContextInFlight = null;

  async function getAuthenticatedContext() {
    if (authContextInFlight) return authContextInFlight;
    const pending = (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const accountKey = await getAccountKey();
        let token;
        try { token = await getToken(); } catch (_) {
          throw runtimeError('UNAUTHENTICATED', 'Vui lòng đăng nhập lại để xác minh lượt dọn dẹp.');
        }
        if (!token) throw runtimeError('UNAUTHENTICATED', 'Vui lòng đăng nhập lại để xác minh lượt dọn dẹp.');
        if (accountKey === await getAccountKey()) return { accountKey, token };
      }
      throw runtimeError('ACCOUNT_CHANGED', 'Tài khoản xác minh đã thay đổi. Vui lòng thử lại.');
    })();
    authContextInFlight = pending;
    try { return await pending; } finally {
      if (authContextInFlight === pending) authContextInFlight = null;
    }
  }

  async function request(functionName, { method = 'POST', body, authContext } = {}) {
    const { token } = authContext || await getAuthenticatedContext();
    const base = await getBase();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchFn(`${base}/${functionName}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal
      });
      let payload = {};
      try { payload = await response.json(); } catch (_) {}
      if (!response.ok) throw runtimeError(payload.error || `HTTP_${response.status}`, payload.message || `Máy chủ xác minh trả lỗi ${response.status}.`, response.status);
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') throw runtimeError('REQUEST_TIMEOUT', 'Máy chủ xác minh phản hồi quá lâu.');
      if (error instanceof TypeError) throw runtimeError('NETWORK_ERROR', 'Không thể kết nối máy chủ xác minh lượt dọn dẹp.');
      throw error;
    } finally { clearTimeout(timeout); }
  }

  function cacheProfile(accountKey, profile) {
    if (accountKey && profile?.cleanup) profileMemory.set(accountKey, { profile, cachedAt: Date.now() });
    return profile;
  }

  async function getServerProfile({ allowCache = true } = {}) {
    const cachedAccountKey = await getAccountKey();
    const cached = cachedAccountKey ? profileMemory.get(cachedAccountKey) : null;
    if (allowCache && cached && Date.now() - cached.cachedAt < PROFILE_CACHE_TTL_MS) return cached.profile;
    const authContext = await getAuthenticatedContext();
    const { accountKey } = authContext;
    const existing = profileInFlight.get(accountKey || '__unknown__');
    if (existing) return existing;
    const key = accountKey || '__unknown__';
    const pending = request(SERVER_ENDPOINTS.profile, { method: 'GET', authContext })
      .then(profile => cacheProfile(accountKey, profile))
      .finally(() => profileInFlight.delete(key));
    profileInFlight.set(key, pending);
    return pending;
  }

  async function getCleanupHistory() {
    const authContext = await getAuthenticatedContext();
    const key = authContext.accountKey || '__unknown__';
    const cached = historyMemory.get(key);
    if (cached && Date.now() - cached.cachedAt < HISTORY_CACHE_TTL_MS) return cached.history;
    const existing = historyInFlight.get(key);
    if (existing) return existing;
    const pending = request(SERVER_ENDPOINTS.history, { method: 'GET', authContext })
      .then(history => {
        historyMemory.set(key, { history, cachedAt: Date.now() });
        return history;
      })
      .finally(() => historyInFlight.delete(key));
    historyInFlight.set(key, pending);
    return pending;
  }

  async function refreshProfile(accountKey) {
    if (accountKey) profileMemory.delete(accountKey);
    return getServerProfile({ allowCache: false });
  }

  async function reserveCleanup({ fileId, fileIds, idempotencyKey = createIdempotencyKey() } = {}) {
    const requestedFileIds = [...new Set((Array.isArray(fileIds) ? fileIds : [fileId])
      .map(value => String(value || '').trim()).filter(Boolean))];
    if (!requestedFileIds.length) throw runtimeError('INVALID_FILE_ID', 'Không xác định được tệp cần dọn dẹp.');
    const authContext = await getAuthenticatedContext();
    const { accountKey } = authContext;
    const driveAccountId = await getDriveAccountId();
    if (accountKey) profileMemory.delete(accountKey);
    const result = await request(SERVER_ENDPOINTS.reserve, { body: { fileIds: requestedFileIds, driveAccountId, idempotencyKey }, authContext });
    cacheProfile(accountKey, result);
    if (!result?.operation?.operationId) throw runtimeError('INVALID_OPERATION', 'Máy chủ không trả về mã xử lý dọn dẹp.');
    return {
      operationId: result.operation.operationId,
      idempotencyKey,
      requestedFileIds,
      allowedFileIds: result.operation.allowedFileIds || [],
      blockedFileIds: result.operation.blockedFileIds || [],
      profile: result
    };
  }

  async function _queueSettlement(kind, body) {
    const pending = await cacheGet(PENDING_SETTLEMENTS_KEY) || [];
    if (!pending.some(item => item.kind === kind && item.body?.operationId === body.operationId)) {
      pending.push({ kind, body, createdAt: new Date().toISOString() });
      await cacheSet({ [PENDING_SETTLEMENTS_KEY]: pending });
    }
  }

  async function _settle(functionName, kind, body) {
    try {
      const authContext = await getAuthenticatedContext();
      const result = await request(functionName, { body, authContext });
      const { accountKey } = authContext;
      if (accountKey) profileMemory.delete(accountKey);
      historyMemory.delete(accountKey || '__unknown__');
      cacheProfile(accountKey, result);
      const pending = await cacheGet(PENDING_SETTLEMENTS_KEY) || [];
      await cacheSet({ [PENDING_SETTLEMENTS_KEY]: pending.filter(item => item.body?.operationId !== body.operationId) });
      return { ...result, pending: false };
    } catch (error) {
      await _queueSettlement(kind, body);
      return { pending: true, error };
    }
  }

  function completeCleanup(operation, { completedFileIds = [] } = {}) {
    return _settle(SERVER_ENDPOINTS.complete, 'complete', {
      operationId: operation.operationId,
      completedFileIds
    });
  }

  function failCleanup(operation) {
    return _settle(SERVER_ENDPOINTS.fail, 'fail', { operationId: operation.operationId });
  }

  async function retryPendingSettlements() {
    const pending = await cacheGet(PENDING_SETTLEMENTS_KEY) || [];
    const results = [];
    for (const item of pending) {
      results.push(await _settle(item.kind === 'complete' ? SERVER_ENDPOINTS.complete : SERVER_ENDPOINTS.fail, item.kind, item.body));
    }
    return results;
  }

  return { getServerProfile, getCleanupHistory, reserveCleanup, completeCleanup, failCleanup, retryPendingSettlements, refreshProfile };
}

const client = createServerStateClient();
export const getServerProfile = options => client.getServerProfile(options);
export const getServerCleanupHistory = () => client.getCleanupHistory();
export const reserveCleanup = options => client.reserveCleanup(options);
export const completeCleanup = (operation, result) => client.completeCleanup(operation, result);
export const failCleanup = operation => client.failCleanup(operation);
export const retryPendingCleanupSettlements = () => client.retryPendingSettlements();
