export function getCanonicalFileFormat(file = {}) {
  const mimeType = String(file.mimeType || '').trim().toLowerCase();
  if (mimeType && mimeType !== 'application/octet-stream') return `mime:${mimeType}`;
  const name = String(file.name || '').trim();
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).trim().toLowerCase() : '';
  return extension ? `ext:${extension}` : '';
}

export function getDuplicateGroupingKey(file) {
  const format = getCanonicalFileFormat(file);
  if (!format) return '';
  const checksum = String(file?.md5Checksum || '').trim();
  if (checksum) return `${format}|md5:${checksum}`;
  const name = String(file?.name || '').trim().toLowerCase();
  return name ? `${format}|name-size:${name}|${file?.size || 0}` : '';
}

export function areSameFileFormat(left, right) {
  const leftFormat = getCanonicalFileFormat(left);
  return Boolean(leftFormat && leftFormat === getCanonicalFileFormat(right));
}
