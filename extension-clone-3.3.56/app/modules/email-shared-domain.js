export function getEmailDomain(email) {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const match = normalized.match(/^[^\s@]+@([^\s@]+)$/);
  return match ? match[1] : null;
}

export function getEmailSharedDomainMode(activeEmail) {
  const domain = getEmailDomain(activeEmail);
  return { mode: domain === 'gmail.com' ? 'gmail-domain' : 'organization', domain };
}

export function isDifferentEmailDomain(recipientEmail, activeDomain) {
  const recipientDomain = getEmailDomain(recipientEmail);
  return !!recipientDomain && !!activeDomain && recipientDomain !== activeDomain;
}

export function getEmailSharedExternalSummary(groups, corporateCount, mode) {
  if (mode?.mode === 'gmail-domain') {
    return {
      label: 'KHÔNG CÙNG TÊN MIỀN',
      phrase: 'không cùng tên miền',
      count: (Array.isArray(groups) ? groups : []).filter(group =>
        !group?.isAnyone && isDifferentEmailDomain(group?.email, mode.domain)
      ).length
    };
  }
  return { label: 'EMAIL NGOÀI TỔ CHỨC', phrase: 'ngoài tổ chức', count: corporateCount };
}
