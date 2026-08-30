import { getAuthToken, getAuthTokenSilently } from './auth.js';
import { renderSidebarCleanupCard, retryPendingCleanupOperations } from './actions.js';
import { normalizeSubscriptionPlan } from './entitlement.js';
import {
  bootstrapAccounts,
  getActiveAccount as getManagedActiveAccount,
  listSignedInAccounts,
  setActiveAccount,
  addNewAccount,
  logoutAccount,
  getAccessTokenForAccount,
  upsertAccount
} from './account-manager.js';

let _activeAccount = null;
let _accounts = [];

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('wistorix:cleanup-credits-changed', () => {
    renderSidebarCleanupCard().catch(error => console.warn('[profile] cleanup sidebar refresh failed', { code: error?.code || 'UNKNOWN' }));
  });
}

function _visiblePlan(account) {
  const normalized = normalizeSubscriptionPlan(account?.subscription || {
    status: account?.subscriptionStatus,
    plan: account?.plan,
    validUntil: account?.subscriptionValidUntil
  });
  return normalized.displayName;
}

function _getInitials(name, email) {
  if (!name) return email ? email.charAt(0).toUpperCase() : '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function _formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

function _hydrateFromManager(account, extra = {}) {
  if (!account) return null;
  return {
    id: account.id,
    name: account.name || 'Tài khoản',
    email: account.email || '',
    initials: account.initials || _getInitials(account.name, account.email),
    plan: account.plan || 'FREE',
    subscription: account.subscription || null,
    subscriptionStatus: account.subscriptionStatus || 'FREE',
    subscriptionValidUntil: account.subscriptionValidUntil || null,
    storageUsed: account.storageUsed || '',
    storageTotal: account.storageTotal || '',
    fileCount: account.fileCount !== undefined ? account.fileCount : 0
  };
}

async function _refreshMeta(account) {
  // Làm mới storage quota + tên email từ API cho account active (best-effort)
  if (!account || !account.accessToken) return account;
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user,storageQuota', {
      headers: { Authorization: `Bearer ${account.accessToken}` }
    });
    if (res.ok) {
      const about = await res.json();
      const storage = about.storageQuota || {};
      const driveUser = about.user || {};
      const used = storage.usage ? parseInt(storage.usage) : 0;
      const limit = storage.limit ? parseInt(storage.limit) : 0;
      account.storageUsed = _formatBytes(used);
      account.storageTotal = _formatBytes(limit);
      if (driveUser.displayName || driveUser.emailAddress) {
        account.name = driveUser.displayName || account.name;
        account.email = driveUser.emailAddress || account.email;
        account.initials = _getInitials(account.name, account.email);
      }
      await upsertAccount(account);
    }
  } catch (_) {}
  return account;
}

function _cacheProfile(profile) {
  try { localStorage.setItem('ws_profile', JSON.stringify(profile)); } catch (_) {}
}

function _cacheAccounts(accounts) {
  try { localStorage.setItem('ws_accounts', JSON.stringify(accounts)); } catch (_) {}
}

/* ── Sync toàn bộ từ account-manager → state in-memory ────── */
async function _syncFromManager() {
  const active = await getManagedActiveAccount();
  const all = await listSignedInAccounts();
  _activeAccount = _hydrateFromManager(active);
  _accounts = all.map(_hydrateFromManager).filter(Boolean);
  if (_activeAccount) _cacheProfile(_activeAccount);
  _cacheAccounts(_accounts);
}

export async function initProfile() {
  _ensureMenuActionsBound();
  try {
    await bootstrapAccounts();
    await _syncFromManager();
    retryPendingCleanupOperations().catch(() => {});
    if (_activeAccount) {
      const acct = await getAccessTokenForAccount(_activeAccount.id, { interactive: false }).catch(() => null);
      if (acct) _refreshMeta(_activeAccount).catch(() => {});
    }
  } catch (_) {}
  refreshUI();
}

export function refreshUI() {
  const sidebarProfile = document.querySelector('.sidebar__profile');
  if (sidebarProfile) renderSidebarProfile(sidebarProfile);
  const dropdown = document.getElementById('profileMenu');
  if (dropdown) renderDropdown(dropdown);
  renderSidebarCleanupCard().catch(error => console.warn('[profile] cleanup sidebar render failed', { code: error?.code || 'UNKNOWN' }));
}

export function getActiveAccount() {
  return _activeAccount;
}

export function getAccounts() {
  return _accounts;
}

async function _doSwitch(accountId) {
  await _syncFromManager();
  const ok = await setActiveAccount(accountId);
  if (!ok) {
    _showToast('error', 'Không thể chuyển sang tài khoản này.');
    return false;
  }
  await _syncFromManager();
  refreshUI();
  return true;
}

export async function switchAccount(accountId) {
  const acc = _accounts.find(a => a.id === accountId);
  if (!acc) return;
  if (_activeAccount && acc.id === _activeAccount.id) { closeProfileMenu(); return; }
  const ok = await _doSwitch(acc.id);
  if (ok) {
    _showToast('success', 'Đã chuyển sang tài khoản ' + acc.email + '.');
    reloadCurrentPage();
  }
}

function reloadCurrentPage() {
  const path = typeof location !== 'undefined' ? location.pathname.split('/').pop() : '';
  const allowList = ['dashboard.html', 'mydrive.html', 'email-shared.html', 'upgrade.html', 'settings.html', 'cleanup.html', 'invite.html'];
  if (allowList.includes(path)) {
    // Reload giúp toàn bộ page render lại theo account mới đúng cache.
    setTimeout(() => { window.location.reload(); }, 300);
  } else {
    refreshUI();
  }
}

function _showToast(type, msg) {
  try {
    const colors = { success: '#10b981', error: '#ef4444', info: '#1e6fff', warning: '#f59e0b' };
    const el = document.createElement('div');
    el.className = 'wix-toast wix-profile-toast';
    el.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2147483647;' +
      'background:' + (colors[type] || '#1e6fff') + ';color:#fff;padding:12px 20px;' +
      'border-radius:8px;font-size:14px;font-family:\'Manrope\',sans-serif;' +
      'box-shadow:0 4px 12px rgba(0,0,0,0.15);max-width:400px;';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { try { el.remove(); } catch (_) {} }, 4000);
  } catch (_) {}
}

function _removeCachedToken(token) {
  return new Promise(resolve => {
    if (!token || !chrome.identity) return resolve();
    try { chrome.identity.removeCachedAuthToken({ token }, () => resolve()); } catch (_) { resolve(); }
  });
}

export function closeProfileMenu() {
  const menu = document.getElementById('profileMenu');
  if (menu) menu.classList.remove('active');
}

export function goToSettingsPage() {
  closeProfileMenu();
  if (window.WistorixRouter) {
    window.location.hash = '#/settings';
    return;
  }
  window.location.href = 'settings.html';
}

export function goToBillingPage() {
  closeProfileMenu();
  if (window.WistorixRouter) {
    window.location.hash = '#/upgrade';
    return;
  }
  window.location.href = 'upgrade.html';
}

/* ── Thêm tài khoản khác — OAuth thật ─────────────────────── */
let _isAddingAccount = false;

export async function addGoogleAccount() {
  if (_isAddingAccount) return;
  _isAddingAccount = true;
  closeProfileMenu();
  try {
    const account = await addNewAccount({ interactive: true });
    await _syncFromManager();
    refreshUI();
    _showToast('success', 'Đã thêm tài khoản ' + account.email + '.');
    reloadCurrentPage();
  } catch (err) {
    const code = err.code;
    const msg = (err && err.message) || '';
    if (code === 'CANCELLED' || /cancel|did not approve|not granted|rejected|abort|interrupt|closed|dismiss|user did not|state mismatch/i.test(msg)) {
      _showToast('info', 'Bạn đã hủy thêm tài khoản.');
    } else {
      _showToast('error', msg === 'ADD_ACCOUNT_OAUTH_CLIENT_ID_REQUIRED'
        ? 'Add Account OAuth chưa được cấu hình. Xem ADD_ACCOUNT_OAUTH_MANUAL_SETUP.md.'
        : (msg || 'Không thể đăng nhập tài khoản Google. Vui lòng thử lại.'));
    }
  } finally {
    _isAddingAccount = false;
  }
}

/* ── Đăng xuất một account ────────────────────────────────── */
export async function logoutProfile() {
  const active = _activeAccount;
  if (!active) return;
  closeProfileMenu();
  const email = active.email || '';
  const confirmed = window.confirm(`Đăng xuất tài khoản ${email} khỏi Wistorix?`);
  if (!confirmed) return;
  await logoutAccount(active.id);
  await _syncFromManager();
  refreshUI();
  _showToast('success', 'Đã đăng xuất tài khoản ' + email + '.');
  reloadCurrentPage();
}

async function _rebindAfterRerender() {
  // Account items được render động từng lần — không cần bind capture lại
  // (dùng event delegation toàn cục bên dưới).
}

/* ── Event delegation ─────────────────────────────────────── */
let _menuActionsBound = false;
export function _ensureMenuActionsBound() {
  if (_menuActionsBound) return;
  _menuActionsBound = true;
  document.addEventListener('click', async (event) => {
    // Account item (chuyển account)
    const accountItem = event.target.closest('[data-account-id]');
    if (accountItem) {
      event.preventDefault();
      event.stopPropagation();
      await switchAccount(accountItem.dataset.accountId);
      return;
    }
    const actionBtn = event.target.closest('[data-profile-action]');
    if (!actionBtn) return;
    const action = actionBtn.dataset.profileAction;
    if (action === 'add-account') addGoogleAccount();
    else if (action === 'settings') goToSettingsPage();
    else if (action === 'billing') goToBillingPage();
  }, { capture: true });

  // Logout
  document.addEventListener('click', (event) => {
    const logoutBtn = event.target.closest('.menu-item.logout');
    if (logoutBtn) {
      event.preventDefault();
      event.stopPropagation();
      logoutProfile();
    }
  }, { capture: true });
}

// Bind NGAY khi module load
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _ensureMenuActionsBound);
  } else {
    _ensureMenuActionsBound();
  }
}

export function renderSidebarProfile(container) {
  if (!container) return;
  const a = _activeAccount;
  const avatarEl = container.querySelector('.sidebar__profile-avatar');
  const nameEl = container.querySelector('.sidebar__profile-name');
  const idEl = container.querySelector('.sidebar__profile-id');
  const badgeEl = container.querySelector('.sidebar__profile-badge');
  if (avatarEl) avatarEl.textContent = a ? a.initials : '';
  if (nameEl) nameEl.textContent = a ? a.name : 'Chưa đăng nhập';
  if (idEl) idEl.textContent = a ? (a.email || '—') : '—';
  if (badgeEl) badgeEl.textContent = a ? _visiblePlan(a) : '';
}

export function renderDropdown(container) {
  if (!container) return;
  const a = _activeAccount;
  const header = container.querySelector('.profile-header');
  if (header) {
    const avatarEl = header.querySelector('.avatar');
    const nameEl = header.querySelector('.name');
    const emailEl = header.querySelector('.email');
    const metaEl = header.querySelector('.meta');
    if (avatarEl) avatarEl.textContent = a ? a.initials : '';
    if (nameEl) {
      let html = a ? a.name : 'Chưa đăng nhập';
      if (a) html += ` <span class="badge">${_visiblePlan(a)}</span>`;
      nameEl.innerHTML = html;
    }
    if (emailEl) emailEl.textContent = a ? (a.email || '') : '';
    if (metaEl) {
      if (a && a.storageUsed && a.storageTotal) {
        metaEl.textContent = `${a.storageUsed} / ${a.storageTotal}`;
      } else {
        metaEl.textContent = '';
      }
    }
  }
  const list = container.querySelector('.account-list');
  if (list) {
    if (_accounts.length === 0) {
      list.innerHTML = '';
    } else {
      list.innerHTML = _accounts.map(acc => {
        const isActive = a && acc.id === a.id;
        return `<div class="account-item ${isActive ? 'active' : ''}" data-account-id="${acc.id}">
            <div class="avatar small">${acc.initials}</div>
            <div class="info">
                <div class="name">${acc.name}</div>
                <div class="email">${acc.email}</div>
            </div>
            ${isActive ? '<div class="check">&#10003;</div>' : ''}
        </div>`;
      }).join('');
    }
  }
  _rebindAfterRerender();
}
