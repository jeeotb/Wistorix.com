// modules/auth.js
// getAuthToken / getAuthTokenSilently quy về account-manager:
// - Nếu có account active có token hợp lệ => dùng token riêng của account đó
// - Fallback chrome.identity.getAuthToken (account Chrome default) khi chưa seed.
import { getValidAccessToken, getAccessTokenForAccount, getActiveAccount, bootstrapAccounts, upsertAccount, invalidateAccessTokenForAccount } from './account-manager.js';

// Google API actions must never open OAuth UI implicitly.  Login UI opts in.
export function getAuthToken({ interactive = false } = {}) {
  return _resolveToken({ interactive: !!interactive });
}

export function getAuthTokenSilently() {
  return getAuthToken({ interactive: false });
}

// One silent recovery after a Google API 401.  It invalidates only token used
// by current account, then lets caller retry original request once.
export async function recoverAuthTokenAfterUnauthorized(failedToken) {
  try { await bootstrapAccounts(); } catch (_) {}
  const activeAccount = await getActiveAccount();
  if (activeAccount) {
    const invalidated = await invalidateAccessTokenForAccount(activeAccount.id, failedToken);
    if (!invalidated && activeAccount.accessToken && activeAccount.accessToken !== failedToken) {
      const error = new Error('Tài khoản đang hoạt động đã thay đổi; không thể thử lại yêu cầu cũ.');
      error.code = 'AUTH_ACCOUNT_CHANGED';
      throw error;
    }
  } else if (failedToken && typeof chrome !== 'undefined' && chrome.identity?.removeCachedAuthToken) {
    await new Promise(resolve => chrome.identity.removeCachedAuthToken({ token: failedToken }, resolve));
  }
  return getAuthTokenSilently();
}

async function _resolveToken({ interactive }) {
  try {
    await bootstrapAccounts();
  } catch (_) {
    // storage fail — vẫn thử path phía dưới
  }
  let hasActiveAccount = false;
  let activeAccount = null;
  try {
    activeAccount = await getActiveAccount();
    if (activeAccount) {
      hasActiveAccount = true;
      const token = await getAccessTokenForAccount(activeAccount.id, { interactive });
      if (token) return token;
    }
  } catch (err) {
    // Token account hết hạn và silent refresh thất bại.
    if (interactive) {
      console.warn('[auth] account token cần đăng nhập lại:', err.message);
    }
  }
  // Manual multi-account tokens expire across extension restarts.  Chrome
  // identity can still have a valid silent token; accept it only when it is
  // for active account, so account B never receives account A's cache/data.
  if (hasActiveAccount) {
    try {
      const chromeToken = await _chromeIdentityToken(false);
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${chromeToken}` }
      });
      const identity = response.ok ? await response.json() : null;
      if (identity?.email && identity.email.toLowerCase() === String(activeAccount?.email || '').toLowerCase()) {
        await upsertAccount({
          ...activeAccount,
          accessToken: chromeToken,
          tokenExpiresAt: Date.now() + 3600 * 1000
        });
        return chromeToken;
      }
    } catch (_) {
      // Continue to the account-specific error below.
    }
  }
  // CHỈ dùng token của Chrome (single default account) khi CHƯA có multi-account state.
  // Nếu đã có account active, KHÔNG bao giờ fallback sang token account khác —
  // tránh account B nhận nhầm token của account A.
  if (!hasActiveAccount) {
    return _chromeIdentityToken(interactive);
  }
  const error = new Error('Không lấy được token cho tài khoản đang hoạt động. Vui lòng đăng nhập lại tài khoản này.');
  error.code = 'NO_ACCOUNT_TOKEN';
  throw error;
}

function _chromeIdentityToken(interactive) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.identity || !chrome.identity.getAuthToken) {
      reject(new Error('Không có identity API.'));
      return;
    }
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError || new Error('Không lấy được token xác thực.'));
        return;
      }
      resolve(token);
    });
  });
}
