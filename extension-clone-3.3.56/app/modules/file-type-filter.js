export const ALL_FILE_TYPE = '';

export const FILE_TYPE_FILTER_OPTIONS = Object.freeze([
  { value: ALL_FILE_TYPE, label: 'Tất cả loại' },
  { value: 'image', label: 'Hình ảnh' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: 'document', label: 'Tài liệu' },
  { value: 'spreadsheet', label: 'Bảng tính' },
  { value: 'presentation', label: 'Trình chiếu' },
  { value: 'pdf', label: 'PDF' },
  { value: 'zip', label: 'File nén' },
  { value: 'folder', label: 'Thư mục' }
]);

export function matchesFileTypeFilter(file, type = ALL_FILE_TYPE) {
  return !type || String(file?.mimeType || '').toLowerCase().includes(type);
}

export function hasFileTypeFolderContextChanged(currentFolderId, nextFolderId) {
  return (currentFolderId || null) !== (nextFolderId || null);
}

export function populateFileTypeFilter(select) {
  if (!select) return;
  const selected = select.value;
  select.replaceChildren(...FILE_TYPE_FILTER_OPTIONS.map(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }));
  select.value = FILE_TYPE_FILTER_OPTIONS.some(option => option.value === selected) ? selected : ALL_FILE_TYPE;
}
