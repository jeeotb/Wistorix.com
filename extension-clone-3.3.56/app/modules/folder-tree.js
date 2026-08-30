const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

/**
 * Collect the selected folder and every non-trashed item below it using the
 * cached Drive parent graph. Shortcuts are treated as leaf items: their target
 * is never traversed, so a shortcut cannot expand the selected scope.
 */
export function createFolderTreeIndex(items) {
  const childrenByParent = new Map();
  const itemById = new Map();
  const itemOrder = new Map();

  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    if (!item?.id || item.trashed) continue;
    itemById.set(item.id, item);
    itemOrder.set(item.id, index);
    for (const parentId of Array.isArray(item.parents) ? item.parents : []) {
      const children = childrenByParent.get(parentId) || [];
      children.push(item);
      childrenByParent.set(parentId, children);
    }
  }

  const collectItemIds = (rootFolderId) => {
    if (!itemById.has(rootFolderId)) return new Set();

    const visitedFolders = new Set();
    const itemIds = new Set();
    const queue = [rootFolderId];
    while (queue.length) {
      const folderId = queue.pop();
      if (visitedFolders.has(folderId)) continue;
      visitedFolders.add(folderId);
      itemIds.add(folderId);

      for (const child of childrenByParent.get(folderId) || []) {
        if (itemIds.has(child.id)) continue;
        itemIds.add(child.id);
        if (child.mimeType === FOLDER_MIME_TYPE && !child.shortcutDetails) {
          queue.push(child.id);
        }
      }
    }
    return itemIds;
  };

  return {
    collectItemIds,
    getItems: (rootFolderId) => [...collectItemIds(rootFolderId)]
      .sort((left, right) => itemOrder.get(left) - itemOrder.get(right))
      .map(itemId => itemById.get(itemId)),
    getDirectChildren: (parentId) => childrenByParent.get(parentId) || [],
    getItem: (itemId) => itemById.get(itemId),
  };
}

export function collectFolderTreeItemIds(rootFolderId, items) {
  return createFolderTreeIndex(items).collectItemIds(rootFolderId);
}

/**
 * Canonical non-trashed dataset for a folder and every descendant. Callers
 * keep their own ownership/type rules, so every consumer shares one subtree
 * boundary without changing its business filters.
 */
export function resolveFolderSubtreeItems(rootFolderId, items) {
  return createFolderTreeIndex(items).getItems(rootFolderId);
}
