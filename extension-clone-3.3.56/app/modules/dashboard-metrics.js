// Canonical metrics for Dashboard cards and charts.  Dashboard risk/sharing
// scope is owned, non-trashed Drive items; categories are exclusive.
export function isDashboardOwnedItem(file) {
  return Boolean(file && file.ownedByMe === true && !file.trashed);
}

export function isPublicFile(file) {
  return isDashboardOwnedItem(file) && (file.permissions || []).some(permission => permission?.type === 'anyone');
}

function isDomainShared(file) {
  return (file.permissions || []).some(permission => permission?.type === 'domain');
}

function isDirectlyShared(file) {
  return (file.permissions || []).some(permission =>
    (permission?.type === 'user' || permission?.type === 'group') && permission?.role !== 'owner'
  );
}

export function getSharingCategory(file) {
  if (!isDashboardOwnedItem(file)) return null;
  if (isPublicFile(file)) return 'public';
  if (isDomainShared(file)) return 'internal';
  if (isDirectlyShared(file)) return 'shared';
  return 'private';
}

export function computeSharingMetrics(files) {
  const counts = { public: 0, internal: 0, private: 0, shared: 0, total: 0 };
  (Array.isArray(files) ? files : []).forEach(file => {
    const category = getSharingCategory(file);
    if (!category) return;
    counts[category]++;
    counts.total++;
  });
  return counts;
}

export function isSharedSizeItem(file) {
  if (!file || file.trashed || file.ownedByMe === true) return false;
  const mime = String(file.mimeType || '').toLowerCase();
  if (!mime || mime.includes('folder') || mime === 'application/vnd.google-apps.shortcut' || file.shortcutDetails) return false;
  return Number.isFinite(Number(file.size)) && Number(file.size) > 0;
}

export function computeStorageMetrics(files, quotaUsageBytes = null) {
  const sharedBytes = (Array.isArray(files) ? files : []).reduce((total, file) =>
    total + (isSharedSizeItem(file) ? Number(file.size) : 0), 0);
  const fallbackMyBytes = (Array.isArray(files) ? files : []).reduce((total, file) => {
    if (!isDashboardOwnedItem(file)) return total;
    const mime = String(file.mimeType || '').toLowerCase();
    if (!mime || mime.includes('folder') || mime === 'application/vnd.google-apps.shortcut' || file.shortcutDetails) return total;
    return total + (Number.isFinite(Number(file.size)) && Number(file.size) > 0 ? Number(file.size) : 0);
  }, 0);
  const hasQuotaUsage = quotaUsageBytes !== null && quotaUsageBytes !== undefined &&
    Number.isFinite(Number(quotaUsageBytes)) && Number(quotaUsageBytes) >= 0;
  const myBytes = hasQuotaUsage ? Number(quotaUsageBytes) : fallbackMyBytes;
  return { myBytes, sharedBytes, totalBytes: myBytes + sharedBytes, source: hasQuotaUsage ? 'quota' : 'scan-fallback' };
}
