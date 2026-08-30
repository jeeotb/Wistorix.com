import {
  completeCleanup,
  failCleanup,
  getServerCleanupHistory,
  getServerProfile,
  reserveCleanup,
  retryPendingCleanupSettlements
} from './server-state.js';

const STORAGE_KEY = 'ws_action_log';
const SESSION_GAP_MS = 30 * 60 * 1000;
const BASE_FREE_FILES = 25;

export const CLEANUP_CREDIT_EXHAUSTED_MESSAGE = 'Bạn đã dùng hết 25 tệp dọn dẹp. Bạn vẫn có thể quét và xem Drive, nhưng cần mua thời gian dọn dẹp hoặc nâng cấp gói để tiếp tục xử lý.';
let _lastSidebarProfileErrorCode = null;

export function computeCleanupCredits({ freeFiles = BASE_FREE_FILES, freeCredits, totalFiles, usedFiles = 0 } = {}) {
  const total = Math.max(0, Math.floor(Number(totalFiles ?? freeFiles ?? freeCredits) || 0));
  const used = Math.min(total, Math.max(0, Math.floor(Number(usedFiles) || 0)));
  return Object.freeze({
    cleanupMode: 'limited',
    usedFiles: used,
    totalFiles: total,
    remainingFiles: Math.max(0, total - used),
    // Compatibility aliases. Values are files, never action-derived credits.
    usedCredits: used,
    totalCredits: total,
    remainingCredits: Math.max(0, total - used)
  });
}

function _loadLogs() {
  return new Promise(resolve => {
    import('./account-manager.js').then(({ readScopedOrLegacy }) => readScopedOrLegacy(STORAGE_KEY))
      .then(value => resolve(value || []))
      .catch(() => {
        chrome.storage.local.get([STORAGE_KEY], result => {
          resolve(result[STORAGE_KEY] || []);
        });
      });
  });
}

function _saveLogs(logs) {
  return new Promise(resolve => {
    import('./account-manager.js').then(({ writeScoped }) => writeScoped(STORAGE_KEY, logs))
      .then(() => resolve())
      .catch(() => {
        chrome.storage.local.set({ [STORAGE_KEY]: logs }, resolve);
      });
  });
}

export async function logAction({ type, fileId, fileName, fileSize, actionLabel }) {
  const operation = arguments[1];
  if (!operation?.operationId) throw new Error('CLEANUP_OPERATION_REQUIRED');
  await completeCleanup(operation, { completedFileIds: [fileId] });
  const logs = await _loadLogs();
  logs.push({
    id: `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    fileId,
    fileName: fileName || 'Unknown',
    fileSize: fileSize || 0,
    actionLabel: actionLabel || type,
    timestamp: new Date().toISOString(),
  });
  await _saveLogs(logs);
  _notifyCreditsChanged();
}

export async function logActionsBulk(actions) {
  const operation = arguments[1];
  if (!actions || !actions.length) return;
  if (!operation?.operationId) throw new Error('CLEANUP_OPERATION_REQUIRED');
  await completeCleanup(operation, { completedFileIds: [...new Set(actions.map(action => action.fileId).filter(Boolean))] });
  const logs = await _loadLogs();
  const now = Date.now();
  actions.forEach((a, i) => {
    logs.push({
      id: `action_${now}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      type: a.type,
      fileId: a.fileId,
      fileName: a.fileName || 'Unknown',
      fileSize: a.fileSize || 0,
      actionLabel: a.actionLabel || a.type,
      timestamp: new Date().toISOString(),
    });
  });
  await _saveLogs(logs);
  _notifyCreditsChanged();
}

export async function getActionLogs() {
  return _loadLogs();
}

export function formatBytes(bytes, decimals = 2) {
  if (!bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export async function getCleanupSessions() {
  const history = await getServerCleanupHistory();
  return (history.operations || []).map(operation => {
    const files = [...new Set(operation.newlyCountedFileIds || operation.succeededFileIds || [])].length;
    return {
      id: operation.operationId,
      createdAt: operation.createdAt,
      label: 'Dọn dẹp Drive',
      freedBytes: 0,
      affectedFiles: files,
      usedFiles: files,
      actionType: 'cleanup',
      actions: [],
    };
  });
}

export async function computeCredits() {
  const profile = await getServerProfile();
  const cleanup = profile.cleanup || {};
  const unlimited = cleanup.isUnlimited === true || cleanup.mode === 'unlimited' || cleanup.mode === 'timed';
  const usedFiles = Math.max(0, Number(cleanup.usedFiles) || 0);
  const remainingFiles = unlimited ? null : Math.max(0, Number(cleanup.remainingFiles) || 0);
  return Object.freeze({
    cleanupMode: unlimited ? 'unlimited' : 'limited',
    usedFiles,
    totalFiles: unlimited ? null : Math.max(0, Number(cleanup.totalFiles) || BASE_FREE_FILES),
    remainingFiles,
    timedExpiresAt: cleanup.timedExpiresAt || null,
    usedCredits: usedFiles,
    totalCredits: unlimited ? null : Math.max(0, Number(cleanup.totalFiles) || BASE_FREE_FILES),
    remainingCredits: remainingFiles
  });
}

export async function canUseCleanupAction({ fileIds = [] } = {}) {
  const profile = await getServerProfile({ allowCache: false });
  const cleanup = profile.cleanup || {};
  const credits = Object.freeze({
    cleanupMode: cleanup.isUnlimited ? cleanup.mode : 'limited',
    remainingFiles: cleanup.isUnlimited ? null : Math.max(0, Number(cleanup.remainingFiles) || 0)
  });
  const requested = [...new Set(fileIds)].length;
  const availableFiles = credits.cleanupMode === 'limited' ? credits.remainingFiles : Infinity;
  return { allowed: availableFiles >= requested, projected: credits, credits };
}

export function canConsumeCleanupAction(credits, fileIds = []) {
  if (credits.cleanupMode !== 'limited') return { allowed: true, projected: credits };
  const newFiles = [...new Set(fileIds)].length;
  const projected = computeCleanupCredits({ totalFiles: credits.totalFiles, usedFiles: credits.usedFiles + newFiles });
  return { allowed: credits.usedFiles + newFiles <= credits.totalFiles, projected };
}

export async function requireCleanupCredit(options) {
  try {
    return await reserveCleanup({ fileId: options?.fileId, fileIds: options?.fileIds });
  } catch (error) {
    if (error?.code === 'NO_CLEANUP_CREDITS') {
      error.message = CLEANUP_CREDIT_EXHAUSTED_MESSAGE;
      error.code = 'CLEANUP_CREDITS_EXHAUSTED';
    }
    throw error;
  }
}

export async function failReservedCleanup(operation) {
  if (!operation?.operationId) return null;
  const result = await failCleanup(operation);
  _notifyCreditsChanged();
  return result;
}

export async function retryPendingCleanupOperations() {
  const results = await retryPendingCleanupSettlements();
  if (results.length) _notifyCreditsChanged();
  return results;
}

function _notifyCreditsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('wistorix:cleanup-credits-changed'));
}

export async function renderSidebarCleanupCard() {
  // Legacy pages use cleanup.html; dashboard SPA uses data-route="#/cleanup".
  // Both cards render canonical usedCredits / totalCredits below.
  const card = document.querySelector('a[href="cleanup.html"], a[data-route="/cleanup"]');
  if (!card) return;
  let credits;
  try {
    credits = await computeCredits();
  } catch (error) {
    const remainingEl = card.querySelector('.sidebar__card-sub');
    const progressBar = card.querySelector('.sidebar__progress-bar');
    const footnoteEl = card.querySelector('.sidebar__card-footnote');
    if (remainingEl) remainingEl.textContent = 'Không thể tải lượt dọn dẹp';
    if (progressBar) progressBar.style.width = '0%';
    if (footnoteEl) footnoteEl.textContent = 'Cần xác minh máy chủ trước khi dọn dẹp';
    const code = error?.code || 'UNKNOWN';
    if (_lastSidebarProfileErrorCode !== code) console.warn('[cleanup] sidebar profile unavailable', { code });
    _lastSidebarProfileErrorCode = code;
    return null;
  }
  const { usedFiles, totalFiles, remainingFiles } = credits;
  const unlimited = credits.cleanupMode !== 'limited';
  const pct = unlimited ? 0 : (totalFiles > 0 ? Math.min(100, (usedFiles / totalFiles) * 100) : 0);
  const remainingEl = card.querySelector('.sidebar__card-sub');
  const progressBar = card.querySelector('.sidebar__progress-bar');
  const footnoteEl = card.querySelector('.sidebar__card-footnote');
  if (remainingEl) remainingEl.textContent = unlimited ? 'Không giới hạn tệp' : remainingFiles + ' tệp còn lại';
  if (progressBar) progressBar.style.width = pct + '%';
  if (footnoteEl) footnoteEl.textContent = unlimited ? 'Dọn dẹp không giới hạn tệp' : 'Đã dùng ' + usedFiles + ' / ' + totalFiles + ' tệp';
  _lastSidebarProfileErrorCode = null;
  return credits;
}
