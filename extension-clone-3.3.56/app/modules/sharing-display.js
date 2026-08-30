export function getSharingDisplay(file) {
  const permissions = Array.isArray(file?.permissions) ? file.permissions : [];
  const labels = [];
  const seen = new Set();
  const add = (key, label) => {
    if (!label || seen.has(key)) return;
    seen.add(key);
    labels.push(label);
  };

  permissions.forEach(permission => {
    if (!permission || permission.role === 'owner') return;
    if (permission.type === 'anyone') { add('anyone', 'Công khai'); return; }
    if (permission.type === 'domain') {
      const domain = String(permission.domain || '').trim().toLowerCase();
      if (domain) add(`domain:${domain}`, `Tên miền ${domain}`);
      return;
    }
    if (permission.type === 'user' || permission.type === 'group') {
      const email = String(permission.emailAddress || '').trim();
      if (email) add(`email:${email.toLowerCase()}`, email);
    }
  });

  if (labels.length) return labels.join(' · ');
  return file?.shared ? 'Shared' : 'Chỉ mình tôi';
}
