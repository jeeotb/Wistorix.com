// WISTORIX referral client.  Codes, attribution and rewards are owned by the
// backend; this module never creates credits or derives a code from an email.
import { getAuthTokenSilently } from './auth.js';
import { getActiveAccount } from './account-manager.js';
import { getCloudFunctionBase } from './payos.js';

const SHARE_TEXT = 'Mời bạn dùng Wistorix để dọn dẹp Google Drive và nhận lượt dọn dẹp miễn phí.';
const referralRecordPromises = new Map();

async function _accountKey() {
  return (await getActiveAccount().catch(() => null))?.id || '__unknown__';
}

function _activeEmail() {
  try { return String(JSON.parse(localStorage.getItem('ws_profile') || '{}').email || '').trim().toLowerCase(); } catch (_) { return ''; }
}

async function _request(functionName, { method = 'POST', body, authenticated = true } = {}) {
  const base = await getCloudFunctionBase();
  const headers = { 'Content-Type': 'application/json' };
  if (authenticated) headers.Authorization = `Bearer ${await getAuthTokenSilently()}`;
  const response = await fetch(`${base}/${functionName}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) {
    const error = new Error(data.error || `REFERRAL_REQUEST_FAILED_${response.status}`);
    error.code = data.error || 'REFERRAL_REQUEST_FAILED';
    throw error;
  }
  return data;
}

function _normalizeLandingUrl(value) {
  const url = String(value || '').replace(/\/$/, '');
  if (!/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(url)) {
    const error = new Error('REFERRAL_LANDING_URL_REQUIRED');
    error.code = 'REFERRAL_LANDING_URL_REQUIRED';
    throw error;
  }
  return url;
}

async function _getReferralRecord() {
  const key = await _accountKey();
  const existing = referralRecordPromises.get(key);
  if (existing) return existing;
  const pending = _request('getReferralCode', { method: 'GET' }).then(async result => {
    if (key !== await _accountKey()) {
      const error = new Error('REFERRAL_ACCOUNT_CHANGED');
      error.code = 'REFERRAL_ACCOUNT_CHANGED';
      throw error;
    }
    return {
      code: String(result.code || ''),
      landingUrl: _normalizeLandingUrl(result.landingUrl),
    };
  }).catch(error => {
    if (referralRecordPromises.get(key) === pending) referralRecordPromises.delete(key);
    throw error;
  });
  referralRecordPromises.set(key, pending);
  return pending;
}

// Kept as a compatibility export only.  New codes must be server-generated.
export function generateStableReferralCode() {
  throw new Error('REFERRAL_CODE_SERVER_REQUIRED');
}

export async function getReferralCode() { return (await _getReferralRecord()).code; }

export async function getReferralUrl() {
  const { code, landingUrl } = await _getReferralRecord();
  if (!/^[a-z0-9_-]{6,64}$/i.test(code)) throw new Error('INVALID_REFERRAL_CODE');
  return `${landingUrl}/r/${encodeURIComponent(code)}`;
}

// This is called only after scanDrive has returned successfully.  The backend
// validates the active Google identity and its first-scan/reward ledgers.
export async function activateReferralAfterFirstScan() {
  return _request('activateReferralAfterFirstScan', { body: { activationType: 'scanDrive_success' } });
}

export async function getReferralRewardCredits() {
  const result = await _request('getReferralRewardCredits', { method: 'GET' });
  return Math.max(0, Number(result.credits) || 0);
}

export async function getReferralSummary() { return _request('getReferralSummary', { method: 'GET' }); }

async function _copyText(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch (_) { return false; }
}

export async function copyReferralLink() { return _copyText(await getReferralUrl()); }

export function openShareWindow(url) {
  try {
    if (chrome?.tabs?.create) { chrome.tabs.create({ url }); return true; }
  } catch (_) {}
  try { return !!window.open(url, '_blank', 'noopener,noreferrer'); } catch (_) { return false; }
}

function trackShare(channel, referralCode) {
  import('../src/analytics.js').then(({ trackEvent }) => trackEvent('referral_share_clicked', {
    channel, referralCode, accountEmail: _activeEmail(),
  }).catch(() => {})).catch(() => {});
}

async function _resolveShare(notify) {
  try {
    const [url, code] = await Promise.all([getReferralUrl(), getReferralCode()]);
    return { url, code };
  } catch (error) {
    (notify || (() => {}))('Chưa thể tạo link giới thiệu. Referral landing chưa được cấu hình hoặc bạn cần đăng nhập lại.', true);
    return null;
  }
}

export async function handleShareFacebook(notify) {
  const target = await _resolveShare(notify); if (!target) return false;
  trackShare('facebook', target.code);
  if (openShareWindow(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(target.url)}`)) {
    (notify || (() => {}))('Đã mở Facebook để chia sẻ link giới thiệu.'); return true;
  }
  const copied = await _copyText(target.url);
  (notify || (() => {}))(copied ? 'Không mở được Facebook. Đã sao chép link.' : 'Không thể mở Facebook. Vui lòng sao chép link thủ công.', !copied);
  return copied;
}

export async function handleShareMessenger(notify) {
  const target = await _resolveShare(notify); if (!target) return false;
  trackShare('messenger', target.code);
  if (navigator.share) {
    try { await navigator.share({ title: 'Wistorix', text: SHARE_TEXT, url: target.url }); return true; }
    catch (error) { if (error?.name === 'AbortError') return false; }
  }
  const copied = await _copyText(target.url);
  (notify || (() => {}))(copied ? 'Đã sao chép link. Hãy dán vào ứng dụng chat bạn muốn gửi.' : 'Không thể sao chép link. Vui lòng sao chép thủ công.', !copied);
  return copied;
}

export async function handleShareEmail(notify) {
  const target = await _resolveShare(notify); if (!target) return false;
  trackShare('email', target.code);
  const subject = encodeURIComponent('Mời bạn dùng Wistorix');
  const body = encodeURIComponent(`${SHARE_TEXT}\n\n${target.url}`);
  if (openShareWindow(`mailto:?subject=${subject}&body=${body}`)) { (notify || (() => {}))('Đã mở ứng dụng email để gửi lời mời.'); return true; }
  const copied = await _copyText(target.url);
  (notify || (() => {}))(copied ? 'Không mở được email. Đã sao chép link.' : 'Không thể sao chép link. Vui lòng sao chép thủ công.', !copied);
  return copied;
}

export async function handleShareCopy(notify) {
  const target = await _resolveShare(notify); if (!target) return false;
  trackShare('copy', target.code);
  const copied = await _copyText(target.url);
  (notify || (() => {}))(copied ? 'Đã sao chép link giới thiệu.' : 'Không thể sao chép link. Vui lòng sao chép thủ công.', !copied);
  return copied;
}
