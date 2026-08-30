import { getDuplicateGroupingKey } from './duplicate-format.js';

export function createDuplicateIndex(files) {
  const groupsByKey = new Map();
  for (const file of Array.isArray(files) ? files : []) {
    if (!file?.name || file.mimeType === 'application/vnd.google-apps.folder') continue;
    const key = getDuplicateGroupingKey(file);
    if (!key) continue;
    const group = groupsByKey.get(key) || [];
    group.push(file);
    groupsByKey.set(key, group);
  }

  const duplicateFiles = [];
  const duplicateFilesWithGroupIndex = [];
  let groupCount = 0;
  for (const group of groupsByKey.values()) {
    if (group.length <= 1) continue;
    duplicateFiles.push(...group);
    group.forEach(file => duplicateFilesWithGroupIndex.push({ ...file, _dupeGroupIdx: groupCount }));
    groupCount += 1;
  }
  return { groupCount, duplicateFiles, duplicateFilesWithGroupIndex };
}
