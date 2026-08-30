import { getReferralUrl, getReferralSummary } from './referral.js';
import { getActiveAccount } from './account-manager.js';

const STORAGE_KEY = 'ws_invites';
const INVITE_CACHE_TTL_MS = 30000;
const inviteMemory = new Map();
const inviteInFlight = new Map();

async function _accountKey() {
  return (await getActiveAccount().catch(() => null))?.id || '__unknown__';
}

function _loadData() {
  return new Promise(resolve => {
    import('./account-manager.js').then(({ readScopedOrLegacy }) => readScopedOrLegacy(STORAGE_KEY))
      .then(value => resolve(value || { invites: [] }))
      .catch(() => {
        chrome.storage.local.get([STORAGE_KEY], result => {
          resolve(result[STORAGE_KEY] || { invites: [] });
        });
      });
  });
}

function _saveData(data) {
  return new Promise(resolve => {
    import('./account-manager.js').then(({ writeScoped }) => writeScoped(STORAGE_KEY, data))
      .then(() => resolve())
      .catch(() => {
        chrome.storage.local.set({ [STORAGE_KEY]: data }, resolve);
      });
  });
}

export async function getInvites() {
  const key = await _accountKey();
  const cached = inviteMemory.get(key);
  if (cached && Date.now() - cached.cachedAt < INVITE_CACHE_TTL_MS) return cached.invites;
  const existing = inviteInFlight.get(key);
  if (existing) return existing;
  const pending = getReferralSummary().then(async summary => {
    if (key !== await _accountKey()) return [];
    const invites = (summary.referrals || []).map((referral, index) => ({
      id: `referral_${index}`,
      name: referral.referee || 'Đang chờ liên kết tài khoản',
      initials: referral.referee ? referral.referee.slice(0, 2).toUpperCase() : '…',
      status: referral.status === 'REWARDED' ? 'success' : 'pending',
      reward: '+1 lượt',
      createdAt: referral.activatedAt || referral.createdAt,
    }));
    inviteMemory.set(key, { invites, cachedAt: Date.now() });
    return invites;
  }).catch(() => {
    // A failed backend request must not display local/demo referrals as real.
    return [];
  }).finally(() => inviteInFlight.delete(key));
  inviteInFlight.set(key, pending);
  return pending;
}

export async function getReferralLink() {
  return getReferralUrl();
}

export async function addInvite({ name, status }) {
  // Compatibility no-op: invitation state is now server-owned and starts at
  // the public landing endpoint, never from a local UI mutation.
  void name; void status;
  return getInvites();
}

function _relativeTime(dateStr) {
  if (!dateStr) return 'Đã gửi lời mời';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  const weeks = Math.floor(days / 7);
  if (mins < 1) return 'Vừa xong';
  if (mins < 60) return mins + ' phút trước';
  if (hours < 24) return hours + ' giờ trước';
  if (days === 1) return 'Hôm qua';
  if (days < 7) return days + ' ngày trước';
  if (weeks === 1) return '1 tuần trước';
  return weeks + ' tuần trước';
}

export async function computeInviteStats(_usedFiles, knownInvites = null) {
  const invites = Array.isArray(knownInvites) ? knownInvites : await getInvites();
  const successful = invites.filter(i => i.status === 'success').length;
  const pending = invites.filter(i => i.status === 'pending').length;
  const receivedCredits = successful;
  // Referral rewards are timed-unlimited units, not file quota. File usage
  // must never reduce the number of granted reward units.
  const referralRemaining = receivedCredits;
  return { successful, pending, receivedCredits, referralRemaining };
}

export function formatInviteList(invites) {
  return invites.map(p => ({
    initials: p.initials || p.name.slice(0, 2).toUpperCase(),
    name: p.name,
    time: p.status === 'pending' ? 'Đã gửi lời mời' : _relativeTime(p.createdAt),
    reward: '+1 lượt',
    status: p.status === 'success' ? 'success' : 'pending',
  }));
}
