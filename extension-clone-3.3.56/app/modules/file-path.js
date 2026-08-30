export function createFilePathResolver(files) {
  const byId = new Map((Array.isArray(files) ? files : []).filter(file => file?.id).map(file => [file.id, file]));
  return file => {
    if (!file) return '—';
    const parents = Array.isArray(file.parents) ? file.parents : [];
    if (!parents.length || parents[0] === 'root') return 'My Drive';
    const parts = [];
    const visited = new Set();
    let parentId = parents[0];
    while (parentId && parentId !== 'root' && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) return '—';
      parts.unshift(parent.name || '—');
      parentId = Array.isArray(parent.parents) ? parent.parents[0] : 'root';
    }
    return parentId && parentId !== 'root' ? '—' : `My Drive${parts.length ? ` > ${parts.join(' > ')}` : ''}`;
  };
}
