// Analysis-detail table only.  Keeps canonical file arrays immutable.
export function sortAnalysisFiles(files, { key, direction }) {
  const valueFor = file => {
    if (key === 'size') {
      if (file.size === null || file.size === undefined || file.size === '') return null;
      const value = Number(file.size);
      return Number.isFinite(value) ? value : null;
    }
    const value = Date.parse(file[key] || '');
    return Number.isFinite(value) ? value : null;
  };
  return files.map((file, index) => ({ file, index, value: valueFor(file) })).sort((left, right) => {
    if (left.value === null && right.value === null) return left.index - right.index;
    if (left.value === null) return 1;
    if (right.value === null) return -1;
    const result = left.value - right.value;
    return result === 0 ? left.index - right.index : (direction === 'asc' ? result : -result);
  }).map(entry => entry.file);
}
