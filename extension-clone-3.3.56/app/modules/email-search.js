export function filterEmailGroups(emailList, query = '') {
  const normalizedQuery = String(query).trim().toLowerCase();
  if (!normalizedQuery) return Array.isArray(emailList) ? emailList : [];
  return (emailList || []).filter(group => {
    const email = String(group?.email || '').toLowerCase();
    const displayName = String(group?.displayName || '').toLowerCase();
    return email.includes(normalizedQuery) || displayName.includes(normalizedQuery);
  });
}
