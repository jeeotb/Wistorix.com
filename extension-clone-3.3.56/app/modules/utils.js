export function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatDate(isoString) {
  if (!isoString) return 'N/A';
  return new Date(isoString).toLocaleDateString('vi-VN', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
}

// Display-only rule: Drive may retain source metadata from before the file
// existed in Drive. Keep canonical timestamps untouched and never use this
// result for stale, duplicate, sorting, or cache logic.
export function getDisplayTimestamps(file = {}) {
  const createdTime = file?.createdTime;
  const modifiedTime = file?.modifiedTime;
  const createdMs = Date.parse(createdTime || '');
  const modifiedMs = Date.parse(modifiedTime || '');
  return {
    createdTime,
    modifiedTime: Number.isFinite(createdMs) && Number.isFinite(modifiedMs) && modifiedMs < createdMs
      ? createdTime
      : modifiedTime
  };
}
