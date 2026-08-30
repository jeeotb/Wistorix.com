export function getMyDrivePaginationItems(currentPage, totalPages) {
  const total = Math.max(1, Number.parseInt(totalPages, 10) || 1);
  const current = Math.min(total, Math.max(1, Number.parseInt(currentPage, 10) || 1));
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const start = current <= 4 ? 2 : current >= total - 3 ? total - 4 : current - 2;
  const end = current <= 4 ? 5 : current >= total - 3 ? total - 1 : current + 2;
  const items = [1];
  if (start > 2) items.push('ellipsis');
  for (let page = start; page <= end; page++) items.push(page);
  if (end < total - 1) items.push('ellipsis');
  items.push(total);
  return items;
}
