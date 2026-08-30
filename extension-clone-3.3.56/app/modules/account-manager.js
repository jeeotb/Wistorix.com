// ================================================================
// modules/account-manager.js
// ----------------------------------------------------------------
// Multi-account Google OAuth manager cho Wistorix.
// - Lưu NHIỀU account, mỗi account blog token riêng (theo Google user id)
// - Mở account chooser thật qua chrome.identity.launchWebAuthFlow với
//   prompt=select_account
// - Validate state chống OAuth injection
// - setActiveAccount / switchAccount / logout / removeAccount
// - Cache & storage key được namespacing theo active account
// ================================================================

const STORAGE_KEY = 'wistorix_accounts_v1';
const LEGACY_PROFILE_KEY = 'ws_profile';
const LEGACY_ACCOUNTS_KEY = 'ws_accounts';

import { getAddAccountOAuthClientId } from './oauth-config.js';

let _cache = null;               // in-memory snapshot
let _cachePromise = null;
const _tokenRefreshInFlight = new Map();

function _getManifest() {
  return typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.getManifest() : {};
}

export function getOAuthScopes() {
  const manifest = _getManifest();
  const oauth = manifest.oauth2 || {};
  const manifestScopes = Array.isArray(oauth.scopes) ? oauth.scopes : [];
  const required = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/drive'
  ];
  const merged = [...manifestScopes, ...required].filter((s, i, arr) => typeof s === 'string' && arr.indexOf(s) === i);
  return merged;
}

// True nếu chạy trong extension page / service worker (có chrome.identity)
export function hasIdentity() {
  return typeof chrome !== 'undefined' && !!chrome.identity;
}

/* ── Storage load/save ─────────────────────────────────────── */
function _defaultState() {
  return { version: 2, accounts: {}, activeAccountId: null, primaryWistorixAccountId: null };
}

function _loadLocalStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function _saveLocalStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

export function loadState() {
  if (_cache) return Promise.resolve(_cache);
  if (_cachePromise) return _cachePromise;
  _cachePromise = new Promise((resolve) => {
    const done = (state) => {
      state = state || _defaultState();
      if (!state.accounts) state.accounts = {};
      if (typeof state.activeAccountId !== 'string') state.activeAccountId = null;
      if (typeof state.primaryWistorixAccountId !== 'string') state.primaryWistorixAccountId = null;
      _cache = state;
      _cachePromise = null;
      resolve(state);
    };
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      done(result && result[STORAGE_KEY]);
    });
  });
  return _cachePromise;
}

export function saveState(state) {
  _cache = state;
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: state }, resolve);
  });
}

/* ── Account CRUD ──────────────────────────────────────────── */
function _getInitials(name, email) {
  if (name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    if (parts.length >= 2) return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }
  if (email) return String(email).charAt(0).toUpperCase();
  return '?';
}

export function normalizeAccount(info, tokenInfo = {}) {
  const now = Date.now();
  const id = info.id || ('g_' + String(info.email || '').toLowerCase());
  const initials = _getInitials(info.name, info.email);
  return {
    id,
    email: info.email || '',
    name: info.name || (info.email ? info.email.split('@')[0] : 'Tài khoản'),
    picture: info.picture || '',
    initials,
    plan: info.plan || 'FREE',
    storageUsed: info.storageUsed || '',
    storageTotal: info.storageTotal || '',
    fileCount: info.fileCount !== undefined ? info.fileCount : 0,
    accessToken: tokenInfo.accessToken || '',
    tokenExpiresAt: tokenInfo.tokenExpiresAt || 0,
    scopes: Array.isArray(tokenInfo.scopes) ? tokenInfo.scopes : [],
    addedAt: tokenInfo.addedAt || now,
    lastUsedAt: now,
    signedOut: false
  };
}

export function getAccountById(id) {
  return loadState().then((s) => s.accounts[id] || null);
}

export function getActiveAccountId() {
  return loadState().then((s) => s.activeAccountId);
}

export function getActiveAccount() {
  return loadState().then((s) => {
    const id = s.activeAccountId;
    if (!id) return null;
    return s.accounts[id] || null;
  });
}

// Billing identity stays pinned while activeAccountId changes Drive context.
export function getPrimaryWistorixAccount() {
  return loadState().then((s) => {
    const id = s.primaryWistorixAccountId;
    return id ? s.accounts[id] || null : null;
  });
}

async function _setPrimaryWistorixAccountId(accountId) {
  const s = await loadState();
  if (!accountId || !s.accounts[accountId] || s.accounts[accountId].signedOut) return false;
  s.primaryWistorixAccountId = accountId;
  await saveState(s);
  return true;
}

export function listSignedInAccounts() {
  return loadState().then((s) => {
    return Object.values(s.accounts)
      .filter((a) => !a.signedOut)
      .sort((a, b) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0));
  });
}

export function listAllAccounts() {
  return loadState().then((s) => Object.values(s.accounts));
}

export async function setActiveAccount(accountId, { allowSignedOut = false } = {}) {
  const s = await loadState();
  const acc = s.accounts[accountId];
  if (!acc) return false;
  if (acc.signedOut && !allowSignedOut) return false;
  s.activeAccountId = accountId;
  acc.lastUsedAt = Date.now();
  await saveState(s);
  _mirrorToLegacy(acc);
  return true;
}

export async function upsertAccount(account) {
  const s = await loadState();
  const existing = s.accounts[account.id];
  account.addedAt = existing ? existing.addedAt : (account.addedAt || Date.now());
  account.lastUsedAt = Date.now();
  if (existing) {
    // Giữ token cũ nếu account mới không có token mới (vd cập nhật profile)
    if (!account.accessToken && existing.accessToken) {
      account.accessToken = existing.accessToken;
      account.tokenExpiresAt = existing.tokenExpiresAt;
    }
    account.scopes = account.scopes && account.scopes.length
      ? account.scopes
      : (existing.scopes || []);
  }
  s.accounts[account.id] = account;
  if (!s.primaryWistorixAccountId && !account.signedOut) s.primaryWistorixAccountId = account.id;
  await saveState(s);
  return account;
}

export async function removeAccount(accountId) {
  const s = await loadState();
  delete s.accounts[accountId];
  if (s.primaryWistorixAccountId === accountId) s.primaryWistorixAccountId = null;
  if (s.activeAccountId === accountId) {
    const rest = Object.keys(s.accounts).filter((id) => !s.accounts[id].signedOut);
    s.activeAccountId = rest.length ? rest[0] : null;
  }
  await saveState(s);
  const remaining = await getActiveAccount();
  _mirrorToLegacy(remaining);
  return true;
}

export async function markSignOut(accountId) {
  const s = await loadState();
  const acc = s.accounts[accountId];
  if (!acc) return false;
  acc.signedOut = true;
  acc.accessToken = '';
  acc.tokenExpiresAt = 0;
  if (s.primaryWistorixAccountId === accountId) s.primaryWistorixAccountId = null;
  if (s.activeAccountId === accountId) {
    const rest = Object.keys(s.accounts).filter((id) => !s.accounts[id].signedOut);
    s.activeAccountId = rest.length ? rest[0] : null;
  }
  await saveState(s);
  const remaining = await getActiveAccount();
  _mirrorToLegacy(remaining);
  return true;
}

/* ── Legacy mirror (localStorage) cho code cũ ─────────────── */
function _mirrorToLegacy(active) {
  if (typeof localStorage === 'undefined') return;
  if (active && active.email) {
    _saveLocalStorage(LEGACY_PROFILE_KEY, {
      name: active.name,
      email: active.email,
      initials: active.initials,
      plan: active.plan,
      storageUsed: active.storageUsed,
      storageTotal: active.storageTotal,
      fileCount: active.fileCount
    });
  }
  loadState().then((s) => {
    _saveLocalStorage(LEGACY_ACCOUNTS_KEY, Object.values(s.accounts).map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      initials: a.initials,
      plan: a.plan
    })));
  }).catch(() => {});
}

/* ── Namespacing storage key theo active account ───────────── */
export function scopedKey(key) {
  // key = 'driveFiles' ... -> 'driveFiles::<accountId>'
  // Nếu chưa có account active, dùng 'default' để giữ dữ liệu cũ.
  return loadState().then((s) => {
    const id = s.activeAccountId || 'default';
    return key + '::' + id;
  });
}

export function scopedKeySync(key) {
  const id = (_cache && _cache.activeAccountId) || 'default';
  return key + '::' + id;
}

// Legacy fallback: với namespace 'default', cho phép đọc cả key cũ (chưa có ::)
export async function readScopedOrLegacy(key) {
  const scoped = await scopedKey(key);
  const s = await loadState();
  const id = s.activeAccountId || 'default';
  const result = await chrome.storage.local.get([scoped, id === 'default' ? key : scoped]);
  if (result[scoped] !== undefined) return result[scoped];
  if (id === 'default' && result[key] !== undefined) return result[key];
  return undefined;
}

export async function writeScoped(key, value) {
  const scoped = await scopedKey(key);
  const s = await loadState();
  const id = s.activeAccountId || 'default';
  const patch = { [scoped]: value };
  // Nếu đang ở namespace default, xoá key cũ để tránh 2 nguồn dữ liệu
  if (id === 'default') patch[key] = value;
  await chrome.storage.local.set(patch);
  return value;
}

/* ── Format bytes (dùng chung) ─────────────────────────────── */
export function formatBytesShort(bytes) {
  if (!bytes) return '0 B';
  const n = parseInt(bytes, 10);
  if (!n || n <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(k)), sizes.length - 1);
  const val = parseFloat((n / Math.pow(k, i)).toFixed(2));
  const display = val % 1 === 0 ? val.toFixed(0) : val.toFixed(2).replace(/\.?0+$/, '');
  return `${display} ${sizes[i]}`;
}

/* ── OAuth: launchWebAuthFlow account chooser ──────────────── */
function _randomState() {
  const arr = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function getAddAccountRedirectUri() {
  if (!hasIdentity() || typeof chrome.identity.getRedirectURL !== 'function') {
    throw new Error('No identity redirect API available');
  }
  return chrome.identity.getRedirectURL('google-oauth');
}

export function buildAddAccountAuthorizationUrl({ clientId, redirectUri, state, scopes }) {
  if (!clientId) throw new Error('ADD_ACCOUNT_OAUTH_CLIENT_ID_REQUIRED');
  if (!redirectUri) throw new Error('OAUTH_REDIRECT_URI_REQUIRED');
  if (!state) throw new Error('OAUTH_STATE_REQUIRED');
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('scope', (scopes || []).join(' '));
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('prompt', 'select_account');
  authUrl.searchParams.set('state', state);
  return authUrl.toString();
}

export function parseAddAccountCallback(redirectUrl, expectedState) {
  const parsed = new URL(redirectUrl);
  const raw = parsed.hash && parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.search.slice(1);
  const params = new URLSearchParams(raw);
  if (params.get('state') !== expectedState) throw new Error('OAuth state mismatch');
  if (params.get('error')) throw new Error(params.get('error_description') || params.get('error') || 'OAuth error');
  const accessToken = params.get('access_token');
  if (!accessToken) throw new Error('No access token returned');
  const expiresIn = parseInt(params.get('expires_in'), 10) || 3600;
  return {
    accessToken,
    tokenExpiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
    scope: params.get('scope') || ''
  };
}

// Chỉ chạy trong extension (service worker / page) — có chrome.identity.
export function launchOAuthFlow({ interactive = true } = {}) {
  return new Promise((resolve, reject) => {
    if (!hasIdentity()) {
      reject(new Error('No identity API available'));
      return;
    }
    const clientId = getAddAccountOAuthClientId();
    if (!clientId) {
      reject(new Error('ADD_ACCOUNT_OAUTH_CLIENT_ID_REQUIRED'));
      return;
    }
    const redirectUri = getAddAccountRedirectUri();
    const state = _randomState();
    const scopes = getOAuthScopes();
    const authUrl = buildAddAccountAuthorizationUrl({ clientId, redirectUri, state, scopes });
    // No token/profile data is logged.
    console.info('[oauth:add-account] flow started', {
      clientIdSuffix: clientId.slice(-12),
      redirectUri,
      responseType: 'token'
    });

    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive }, (redirectUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'OAuth cancelled'));
        return;
      }
      if (!redirectUrl) {
        reject(new Error('No redirect URL returned'));
        return;
      }
      try {
        const tokenInfo = parseAddAccountCallback(redirectUrl, state);
        console.info('[oauth:add-account] callback received');
        resolve(tokenInfo);
      } catch (err) {
        console.warn('[oauth:add-account] callback failed', err?.message || 'OAuth callback error');
        reject(err);
      }
    });
  });
}

/* ── Fetch Google user thật ───────────────────────────────── */
export async function fetchGoogleUser(token) {
  if (!token) throw new Error('Missing token');
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Failed to fetch Google user');
  const info = await res.json();
  if (!info || !info.email) throw new Error('No email returned from Google');
  return info;
}

export async function fetchStorageQuota(token) {
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user,storageQuota', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return {};
    const about = await res.json();
    const storage = about.storageQuota || {};
    return {
      storageUsed: about.user ? '' : '',
      storageUsedBytes: storage.usage ? parseInt(storage.usage) : 0,
      storageTotalBytes: storage.limit ? parseInt(storage.limit) : 0
    };
  } catch (_) {
    return {};
  }
}

/* ── Luồng thêm account mới ───────────────────────────────── */
export async function addNewAccount({ interactive = true } = {}) {
  let tokenInfo;
  try {
    tokenInfo = await launchOAuthFlow({ interactive });
  } catch (err) {
    const msg = String(err && err.message || '');
    if (/cancel|not granted|rejected|abort|user did not|no success|interrupt|state mismatch|access_denied/i.test(msg)) {
      const e = new Error('Bạn đã hủy đăng nhập tài khoản mới.');
      e.code = 'CANCELLED';
      throw e;
    }
    throw err;
  }

  const userInfo = await fetchGoogleUser(tokenInfo.accessToken);

  const account = normalizeAccount(userInfo, {
    accessToken: tokenInfo.accessToken,
    tokenExpiresAt: tokenInfo.tokenExpiresAt,
    scopes: tokenInfo.scope ? tokenInfo.scope.split(/\s+/) : getOAuthScopes(),
    addedAt: Date.now()
  });

  // Dự phòng: lấy storage quota để hiển thị
  const quota = await fetchStorageQuota(tokenInfo.accessToken);
  if (quota && quota.storageUsedBytes !== undefined) {
    const used = quota.storageUsedBytes;
    const total = quota.storageTotalBytes;
    account.storageUsed = formatBytesShort(used);
    account.storageTotal = formatBytesShort(total);
  }

  const saved = await upsertAccount(account);
  await setActiveAccount(saved.id);
  return saved;
}

/* ── Refresh token silent (interactive:false) ─────────────── */
export async function refreshAccessTokenForAccount(accountId, { interactive = false } = {}) {
  const acc = await getAccountById(accountId);
  if (!acc) return null;
  let tokenInfo;
  try {
    tokenInfo = await launchOAuthFlow({ interactive });
  } catch (err) {
    if (!interactive) throw err; // silent fail truyền lên cho caller quyết định
    throw err;
  }
  const userInfo = await fetchGoogleUser(tokenInfo.accessToken);
  const updated = normalizeAccount(userInfo, {
    accessToken: tokenInfo.accessToken,
    tokenExpiresAt: tokenInfo.tokenExpiresAt,
    scopes: tokenInfo.scope ? tokenInfo.scope.split(/\s+/) : acc.scopes,
    addedAt: acc.addedAt
  });
  updated.picture = updated.picture || acc.picture;
  updated.storageUsed = updated.storageUsed || acc.storageUsed;
  updated.storageTotal = updated.storageTotal || acc.storageTotal;
  updated.fileCount = updated.fileCount !== undefined ? updated.fileCount : acc.fileCount;
  await upsertAccount(updated);
  return updated;
}

/* ── Lấy token hợp lệ cho account ─────────────────────────── */
// - Có token + chưa hết hạn → trả về
// - Hết hạn/mất → thử silent refresh → nếu không được & interactive → mở OAuth
export async function getAccessTokenForAccount(accountId, { interactive = false } = {}) {
  const acc = await getAccountById(accountId);
  if (!acc) return null;
  if (acc.accessToken && acc.tokenExpiresAt > Date.now() + 60 * 1000) {
    return acc.accessToken;
  }
  const pending = _tokenRefreshInFlight.get(accountId);
  if (pending) return pending;
  const refresh = (async () => {
    try {
      const refreshed = await refreshAccessTokenForAccount(accountId, { interactive });
      return refreshed ? refreshed.accessToken : null;
    } catch (err) {
      if (interactive) {
        // mở OAuth lại cho đúng account
        const again = await addNewAccount({ interactive: true });
        if (again && again.id === accountId) return again.accessToken;
        if (again) {
          await setActiveAccount(again.id);
          return again.accessToken;
        }
        return null;
      }
      throw err;
    }
  })();
  _tokenRefreshInFlight.set(accountId, refresh);
  try {
    return await refresh;
  } finally {
    if (_tokenRefreshInFlight.get(accountId) === refresh) _tokenRefreshInFlight.delete(accountId);
  }
}

export async function getValidAccessToken() {
  const account = await getActiveAccount();
  if (account) {
    return getAccessTokenForAccount(account.id, { interactive: false });
  }
  return null;
}

// Never derive billing bearer from active Drive account. On a fresh local
// installation, Chrome's main identity is the only safe bootstrap source.
export async function getPrimaryWistorixAccessToken({ interactive = false } = {}) {
  const primary = await getPrimaryWistorixAccount();
  if (primary) return getAccessTokenForAccount(primary.id, { interactive });
  const token = await _chromeIdentityToken(interactive);
  const userInfo = await fetchGoogleUser(token);
  const account = await upsertAccount(normalizeAccount(userInfo, {
    accessToken: token,
    tokenExpiresAt: Date.now() + 3600 * 1000,
    scopes: getOAuthScopes(),
    addedAt: Date.now()
  }));
  await _setPrimaryWistorixAccountId(account.id);
  return token;
}

/* ── Token tương thích chrome.identity ────────────────────── */
async function _chromeIdentityToken(interactive) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.identity || !chrome.identity.getAuthToken) {
      reject(new Error('No identity API'));
      return;
    }
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError || new Error('No token'));
        return;
      }
      resolve(token);
    });
  });
}

async function _removeChromeCachedToken(token) {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.identity || !token) return resolve();
    try {
      chrome.identity.removeCachedAuthToken({ token }, () => resolve());
    } catch (_) {
      resolve();
    }
  });
}

// Clear only token rejected by Google.  Other managed accounts keep tokens.
export async function invalidateAccessTokenForAccount(accountId, failedToken) {
  if (!accountId || !failedToken) return false;
  const s = await loadState();
  const acc = s.accounts[accountId];
  if (!acc || acc.accessToken !== failedToken) return false;
  acc.accessToken = '';
  acc.tokenExpiresAt = 0;
  await saveState(s);
  await _removeChromeCachedToken(failedToken);
  return true;
}

/* ── Bootstrap: nếu chưa có account nào, seed từ legacy + chrome.identity ── */
export async function bootstrapAccounts() {
  const s = await loadState();
  if (Object.keys(s.accounts).length > 0) {
    // đã có multi-account state — đảm bảo legacy mirror
    const active = await getActiveAccount();
    if (!s.primaryWistorixAccountId || !s.accounts[s.primaryWistorixAccountId] || s.accounts[s.primaryWistorixAccountId].signedOut) {
      s.primaryWistorixAccountId = s.activeAccountId || Object.keys(s.accounts).find(id => !s.accounts[id].signedOut) || null;
      await saveState(s);
    }
    _mirrorToLegacy(active);
    return s;
  }

  // Seed từ legacy localStorage (ws_accounts / ws_profile)
  const legacyAccounts = _loadLocalStorage(LEGACY_ACCOUNTS_KEY) || [];
  const legacyProfile = _loadLocalStorage(LEGACY_PROFILE_KEY);
  let seeded = false;

  const seedInfo = legacyProfile || legacyAccounts[0] || null;
  if (seedInfo && seedInfo.email) {
    const acc = normalizeAccount(seedInfo, { addedAt: Date.now() });
    s.accounts[acc.id] = acc;
    s.activeAccountId = acc.id;
    s.primaryWistorixAccountId = acc.id;
    seeded = true;
  }

  // Lấy token thật cho account đang active qua chrome.identity (account Chrome default)
  const active = s.activeAccountId ? s.accounts[s.activeAccountId] : null;
  if (seeded && active && !active.accessToken) {
    try {
      const token = await _chromeIdentityToken(false);
      if (token) {
        active.accessToken = token;
        active.tokenExpiresAt = Date.now() + 3600 * 1000; // ước tính; sẽ refresh khi cần
      }
    } catch (_) {
      // chưa đăng nhập Chrome → để người dùng thêm account qua UI
    }
  }

  // Fresh installs have no legacy profile.  If Chrome already has an authorized
  // identity token, turn it into the same account state used by the profile and
  // router instead of leaving authentication and the profile out of sync.
  if (!seeded) {
    try {
      const token = await _chromeIdentityToken(false);
      const userInfo = await fetchGoogleUser(token);
      const account = normalizeAccount(userInfo, {
        accessToken: token,
        tokenExpiresAt: Date.now() + 3600 * 1000,
        scopes: getOAuthScopes(),
        addedAt: Date.now()
      });
      s.accounts[account.id] = account;
      s.activeAccountId = account.id;
      s.primaryWistorixAccountId = account.id;
      seeded = true;
    } catch (_) {
      // No cached Chrome identity token is normal before first sign-in.
    }
  }

  await saveState(s);
  _mirrorToLegacy(s.activeAccountId ? s.accounts[s.activeAccountId] : null);
  return s;
}

/* ── Logout ───────────────────────────────────────────────── */
export async function logoutAccount(accountId) {
  const acc = await getAccountById(accountId);
  if (acc && acc.accessToken) {
    // Ở chrome.identity cache cũ, byte từng cached — revoke best-effort
    try {
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${encodeURIComponent(acc.accessToken)}`, { method: 'POST', mode: 'no-cors' });
    } catch (_) {}
    await _removeChromeCachedToken(acc.accessToken);
  }
  await markSignOut(accountId);
}

export function _resetCache() {
  _cache = null;
  _cachePromise = null;
  _tokenRefreshInFlight.clear();
}

// Scope/version thay đổi → xoá toàn bộ token đã lưu để buộc cấp quyền mới.
// Giữ nguyên danh sách account (name/email), chỉ bỏ token.
export async function clearAllAccountTokens() {
  const s = await loadState();
  let changed = false;
  for (const acc of Object.values(s.accounts)) {
    if (acc.accessToken) {
      acc.accessToken = '';
      acc.tokenExpiresAt = 0;
      changed = true;
    }
  }
  if (changed) await saveState(s);
}
