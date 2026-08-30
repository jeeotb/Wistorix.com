import { findMatchingInheritedParentPermission, getInheritedParentId } from './action-modals.js';
import { createFilePathResolver } from './file-path.js';

const normalizePath = path => String(path || '')
  .split(/\s*(?:>|›|\/)\s*/)
  .map(part => part.trim())
  .filter(Boolean);

const pathForFile = file => file?.path || file?.fullPath || file?.folderPath || file?.displayPath || '';

function getGraphCandidates(file, byId) {
  const candidates = [];
  const visited = new Set();
  let parentId = Array.isArray(file?.parents) ? file.parents[0] : null;
  while (parentId && parentId !== 'root' && !visited.has(parentId) && candidates.length < 12) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    candidates.push({ id: parent.id, file: parent, name: parent.name || '—', source: 'parent-map' });
    parentId = Array.isArray(parent.parents) ? parent.parents[0] : null;
  }
  return candidates;
}

function getPathCandidates(file, files, path) {
  const parts = normalizePath(path || pathForFile(file));
  if (!parts.length) return { candidates: [], ambiguous: false };
  if (parts[0].toLowerCase() === 'my drive') parts.shift();
  if (parts.at(-1) === file?.name) parts.pop();
  if (!parts.length) return { candidates: [], ambiguous: false };

  const resolvePath = createFilePathResolver(files);
  const expectedPaths = new Set();
  for (let length = 1; length <= parts.length; length++) {
    expectedPaths.add(`My Drive > ${parts.slice(0, length).join(' > ')}`);
  }
  const byPath = new Map();
  for (const candidate of files || []) {
    if (!candidate?.id || !String(candidate.mimeType || '').includes('folder')) continue;
    const parentPath = resolvePath(candidate);
    const candidatePath = parentPath === '—' ? '—' : `${parentPath} > ${candidate.name || '—'}`;
    if (!expectedPaths.has(candidatePath)) continue;
    const matches = byPath.get(candidatePath) || [];
    matches.push(candidate);
    byPath.set(candidatePath, matches);
  }
  if ([...byPath.values()].some(matches => matches.length !== 1)) return { candidates: [], ambiguous: true };

  return {
    candidates: [...byPath.entries()]
      .sort(([left], [right]) => right.length - left.length)
      .map(([, [candidate]]) => ({ id: candidate.id, file: candidate, name: candidate.name || '—', source: 'path' })),
    ambiguous: false
  };
}

async function getCandidatePermissions(candidate, getFilePermissions, permissionCache, lookups) {
  if (Array.isArray(candidate.file?.permissions)) return candidate.file.permissions;
  let pending = permissionCache?.get(candidate.id);
  if (!pending) {
    if (!getFilePermissions || lookups.count >= lookups.max) return null;
    lookups.count++;
    pending = Promise.resolve(getFilePermissions(candidate.id)).then(permissions => Array.isArray(permissions) ? permissions : []);
    permissionCache?.set(candidate.id, pending);
  }
  try { return await pending; } catch (_) { return null; }
}

export async function resolveInheritedPermissionSource({ file, permission, files, getFilePermissions, path, permissionCache = new Map(), maxPermissionLookups = 4 }) {
  const explicitParentId = getInheritedParentId(permission);
  const allFiles = Array.isArray(files) ? files : [];
  const byId = new Map(allFiles.filter(item => item?.id).map(item => [item.id, item]));
  if (explicitParentId) {
    const parent = byId.get(explicitParentId);
    return {
      status: 'resolved', source: 'explicit', parentId: explicitParentId,
      parentName: parent?.name || '—', parent, permission
    };
  }

  const graphCandidates = getGraphCandidates(file, byId);
  const lookups = { count: 0, max: maxPermissionLookups };
  for (const candidate of graphCandidates) {
    const parentPermissions = await getCandidatePermissions(candidate, getFilePermissions, permissionCache, lookups);
    const parentPermission = parentPermissions && findMatchingInheritedParentPermission(permission, parentPermissions);
    if (!parentPermission) continue;
    return {
      status: 'resolved', source: candidate.source, parentId: candidate.id, parentName: candidate.name,
      parent: candidate.file,
      permission: {
        ...permission,
        permissionDetails: [...(permission.permissionDetails || []), { inherited: true, inheritedFrom: candidate.id }]
      }
    };
  }

  const pathResult = getPathCandidates(file, allFiles, path);
  if (pathResult.ambiguous) return { status: 'ambiguous' };
  for (const candidate of pathResult.candidates) {
    if (graphCandidates.some(item => item.id === candidate.id)) continue;
    const parentPermissions = await getCandidatePermissions(candidate, getFilePermissions, permissionCache, lookups);
    const parentPermission = parentPermissions && findMatchingInheritedParentPermission(permission, parentPermissions);
    if (!parentPermission) continue;
    return {
      status: 'resolved', source: candidate.source, parentId: candidate.id, parentName: candidate.name,
      parent: candidate.file,
      permission: {
        ...permission,
        permissionDetails: [...(permission.permissionDetails || []), { inherited: true, inheritedFrom: candidate.id }]
      }
    };
  }
  return { status: 'unresolved' };
}
