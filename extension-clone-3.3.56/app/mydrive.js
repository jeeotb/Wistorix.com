import { scanDrive, loadFilesFromCache, deleteFile, getFilePermissions, getFileOwner, getFileMetadata, removeCachedPermission, revokePermission, transferOwnership, isConsentRequiredError, canCurrentAccountManageSharing } from './modules/drive.js';
import { getAuthToken, getAuthTokenSilently } from './modules/auth.js';
import { formatBytes, formatDate, getDisplayTimestamps } from './modules/utils.js';
import { initProfile } from './modules/profile.js';
import { failReservedCleanup, logAction, logActionsBulk, requireCleanupCredit } from './modules/actions.js';
import { ownershipRequestMessage, submitOwnershipRequest } from './modules/ownership-request.js';
import { createFolderTreeIndex, resolveFolderSubtreeItems } from './modules/folder-tree.js';
import { openDuplicateActionModal } from './modules/duplicate-action.js';
import { getInheritedParentId, openActionConfirm, openOwnershipRequestModal, openOwnershipTransferModal, openSharePermissionsModal } from './modules/action-modals.js';
import { getSharingDisplay } from './modules/sharing-display.js';
import { PreviewController } from './modules/quick-preview.js';
import { SmartDownloader } from './modules/download.js';
import { sortAnalysisFiles } from './modules/analysis-table-sort.js';
import { getDuplicateGroupingKey } from './modules/duplicate-format.js';
import { getMyDrivePaginationItems } from './modules/mydrive-pagination.js';
import { getActiveAccountId } from './modules/account-manager.js';
import { ALL_FILE_TYPE, hasFileTypeFolderContextChanged, matchesFileTypeFilter, populateFileTypeFilter } from './modules/file-type-filter.js';

const AppState = window.WistorixAppState;

const FILES_PER_PAGE = 17;

/* ── State ────────────────────────────────────────────────── */
let allFiles = [];
let ownedFiles = [];
let folderSubtreeIndex = null;
let folderTree = [];
let folderMap = {};     // folderId → folderName
let parentMap = {};     // fileId → parentId
let currentFolder = null;
let searchKeyword = '';
let myDriveFileType = ALL_FILE_TYPE;
let currentPage = 1;
let currentView = 'list';
let myDriveSort = { key: 'createdTime', direction: 'desc' };
let selectedFile = null;
let selectedFileIds = new Set();
let isBulkDeleteInFlight = false;
let isBulkDownloadInFlight = false;
let isBulkRevokeInFlight = false;
let isBulkTransferInFlight = false;
let isPreviewOpen = false;
let previewController = null;
let folderSortMode = 'alpha';
let folderHeaderRequestId = 0;
let folderHeaderPermissions = new Map();
let myDriveAccountId = null;
let isFolderHeaderActionInFlight = false;

// activeCardFilter: 'public' | 'dupes' | 'empty' | null — click summary card lọc file ngay trong My Drive
let activeCardFilter = null;
// Lưu set id các file thuộc group duplicate để lọc khớp số nhóm trên card
let duplicateFileIds = new Set();

// Read-only bridge for modules/drive.js debugTimestampPipeline().
window.WistorixMyDriveTimestampDebug = {
    getFile: (fileId) => allFiles.find(file => file.id === fileId) || null,
    getDatasetFile: (fileId) => getFilteredFiles().find(file => file.id === fileId) || null,
    getFiles: () => allFiles,
    getDatasetFiles: () => getFilteredFiles(),
    getPreviewFile: () => selectedFile
};

/* ── Helpers ──────────────────────────────────────────────── */
const fmt = (n) => new Intl.NumberFormat('en-US').format(Number(n) || 0);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getFolderSortMode() {
    return new Promise(resolve => {
        if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
            chrome.storage.sync.get(['folderSort'], data => resolve(data.folderSort || 'alpha'));
            return;
        }
        try { resolve(JSON.parse(localStorage.getItem('ws_folderSort')) || 'alpha'); } catch (_) { resolve('alpha'); }
    });
}

export function compareFolderNodes(a, b, mode = folderSortMode) {
    const nameComparison = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (mode === 'size-asc') return (a.directSize - b.directSize) || nameComparison;
    if (mode === 'size-desc') return (b.directSize - a.directSize) || nameComparison;
    return nameComparison;
}

export function sortFolderNodes(nodes, mode = folderSortMode) {
    return [...nodes].sort((a, b) => compareFolderNodes(a, b, mode));
}

function sortedFolderNodes(nodes) {
    return sortFolderNodes(nodes, folderSortMode);
}

if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'sync' || !changes.folderSort) return;
        folderSortMode = changes.folderSort.newValue || 'alpha';
        if (folderTree.length) renderTree(folderTree);
    });
}

function getFileIcon(mimeType) {
    if (!mimeType) return 'fas fa-file';
    if (mimeType.includes('video')) return 'fab fa-youtube';
    if (mimeType.includes('pdf')) return 'fas fa-file-pdf';
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('gzip') || mimeType.includes('tar')) return 'fas fa-file-archive';
    if (mimeType.includes('folder')) return 'fas fa-folder';
    if (mimeType.includes('image')) return 'fas fa-file-image';
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'fas fa-file-excel';
    if (mimeType.includes('document') || mimeType.includes('word')) return 'fas fa-file-word';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'fas fa-file-powerpoint';
    if (mimeType.includes('text')) return 'fas fa-file-alt';
    return 'fas fa-file';
}

function getFileNameHtml(file) {
    const icon = getFileIcon(file.mimeType);
    const name = escapeHtml(file.name || 'Unnamed');
    return `<span class="file-name-cell"><i class="${icon} file-icon" style="color:${icon === 'fas fa-folder' ? '#f59e0b' : '#6b7280'}"></i><span class="file-name-text">${name}</span></span>`;
}

function getFileTypeCategory(mimeType) {
    if (!mimeType) return 'other';
    if (mimeType === 'application/vnd.google-apps.folder') return 'folder';
    if (mimeType.includes('video')) return 'video';
    if (mimeType.includes('pdf')) return 'pdf';
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('gzip')) return 'zip';
    if (mimeType.includes('image')) return 'image';
    if (mimeType.includes('document') || mimeType.includes('word') || mimeType.includes('sheet') || mimeType.includes('presentation')) return 'document';
    return 'other';
}

function getFileColor(mimeType) {
    const t = getFileTypeCategory(mimeType);
    const colors = { video: '#ef4444', pdf: '#ef4444', zip: '#f59e0b', image: '#3b82f6', document: '#10b981', folder: '#f59e0b' };
    return colors[t] || '#6b7280';
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/* ── Tree Building ────────────────────────────────────────── */
function isFolder(f) {
    return f.mimeType === 'application/vnd.google-apps.folder' || f.mimeType?.includes('folder');
}

// Logic lọc card summary — dùng cùng field với computeCards() để khớp số hiển thị
function isPublicFile(file) {
    return Boolean(
        file.isPublic === true ||
        file.visibility === 'public' ||
        (file.permissions || []).some(p => p.type === 'anyone')
    );
}

function isDuplicateFile(file) {
    return duplicateFileIds.has(file.id);
}

function isEmptyFile(file) {
    return !parseInt(file.size); // khớp logic computeCards: emptyFiles = nonFolders.filter(f => !parseInt(f.size))
}

export function buildFolderTree(files, treeIndex = createFolderTreeIndex(files)) {
    const folders = files.filter(f => isFolder(f) && !f.trashed);
    folderMap = {};
    parentMap = {};

    for (const f of folders) {
        folderMap[f.id] = f.name || 'Unnamed';
        if (f.parents && f.parents.length > 0) {
            parentMap[f.id] = f.parents[0];
        } else {
            parentMap[f.id] = 'root';
        }
    }

    // Build tree structure: root children and hierarchy
    const nodeMap = {};
    for (const f of folders) {
        const subtreeItemIds = treeIndex.collectItemIds(f.id);
        let count = 0;
        for (const itemId of subtreeItemIds) {
            const item = treeIndex.getItem(itemId);
            if (item && !isFolder(item)) count += 1;
        }
        const directChildren = treeIndex.getDirectChildren(f.id).filter(g => !isFolder(g));
        const directSize = directChildren.reduce((total, file) => total + (Number.parseInt(file.size, 10) || 0), 0);
        nodeMap[f.id] = { id: f.id, name: f.name || 'Unnamed', children: [], count, directSize };
    }

    const roots = [];
    for (const f of folders) {
        const node = nodeMap[f.id];
        const parentId = parentMap[f.id];
        if (parentId === 'root' || !nodeMap[parentId] || folderCreatesCycle(f.id, parentId, nodeMap)) {
            roots.push(node);
        } else if (nodeMap[parentId]) {
            nodeMap[parentId].children.push(node);
        }
    }

    return roots;
}

function folderCreatesCycle(folderId, parentId, nodeMap) {
    const visited = new Set([folderId]);
    let cursor = parentId;
    while (cursor && cursor !== 'root' && nodeMap[cursor]) {
        if (visited.has(cursor)) return true;
        visited.add(cursor);
        cursor = parentMap[cursor];
    }
    return false;
}

export function resolveMyDriveFolderDataset(folderId, files) {
    const list = Array.isArray(files) ? files : [];
    return !folderId || folderId === 'root'
        ? list
        : resolveFolderSubtreeItems(folderId, list);
}

function getSelectedFolderDataset() {
    if (!currentFolder || currentFolder === 'root') return ownedFiles;
    return folderSubtreeIndex
        ? folderSubtreeIndex.getItems(currentFolder)
        : resolveMyDriveFolderDataset(currentFolder, ownedFiles);
}

function rebuildOwnedFolderIndex() {
    folderSubtreeIndex = createFolderTreeIndex(ownedFiles);
    folderTree = buildFolderTree(ownedFiles, folderSubtreeIndex);
}

function resetMyDriveFileTypeFilter() {
    myDriveFileType = ALL_FILE_TYPE;
    const select = document.getElementById('mydrive-file-type-filter');
    if (select) select.value = ALL_FILE_TYPE;
}

function setMyDriveFolder(nextFolder) {
    const nextFolderId = nextFolder || null;
    if (hasFileTypeFolderContextChanged(currentFolder, nextFolderId)) resetMyDriveFileTypeFilter();
    currentFolder = nextFolderId;
    currentPage = 1;
}

function refreshSelectedFolderView() {
    renderFolderHeader();
    updateCards(computeCards(getSelectedFolderDataset()));
    renderCurrentView();
}

export function getImmediateFolderContentCounts(folderId, files) {
    const children = (Array.isArray(files) ? files : []).filter(file =>
        file && !file.trashed && Array.isArray(file.parents) && file.parents.includes(folderId)
    );
    return {
        files: children.filter(file => !isFolder(file)).length,
        folders: children.filter(isFolder).length
    };
}

export function getFolderPermissionSummary(permissions) {
    const isInherited = permission => permission?.inherited === true ||
        permission?.permissionDetails?.some(detail => detail?.inherited === true) === true;
    const shared = (Array.isArray(permissions) ? permissions : []).filter(permission =>
        permission && !permission.deleted && permission.role !== 'owner' &&
        ['anyone', 'user', 'group', 'domain'].includes(permission.type)
    );
    const principalKey = permission => {
        const identity = permission.type === 'domain' ? permission.domain : permission.emailAddress;
        return `${permission.type}:${String(identity || permission.id || '').trim().toLowerCase()}`;
    };
    const principals = new Set(shared.filter(permission => ['user', 'group', 'domain'].includes(permission.type)).map(principalKey));
    const directPrincipals = new Set(shared.filter(permission => !isInherited(permission) && ['user', 'group', 'domain'].includes(permission.type)).map(principalKey));
    const inheritedPrincipals = new Set(shared.filter(permission => isInherited(permission) && ['user', 'group', 'domain'].includes(permission.type)).map(principalKey));
    const hasDirectPublic = shared.some(permission => permission.type === 'anyone' && !isInherited(permission));
    const hasInheritedPublic = shared.some(permission => permission.type === 'anyone' && isInherited(permission));
    const hasDirectDomain = shared.some(permission => permission.type === 'domain' && !isInherited(permission));
    const hasInheritedDomain = shared.some(permission => permission.type === 'domain' && isInherited(permission));
    return {
        isPublic: hasDirectPublic || hasInheritedPublic,
        publicInherited: hasInheritedPublic,
        hasDomain: hasDirectDomain || hasInheritedDomain,
        domainInherited: hasInheritedDomain,
        principalCount: principals.size,
        directPrincipalCount: directPrincipals.size,
        inheritedPrincipalCount: inheritedPrincipals.size,
        hasInheritedAccess: shared.some(isInherited),
        hasSharing: shared.length > 0
    };
}

function getCurrentFolderFile() {
    return currentFolder ? ownedFiles.find(file => file.id === currentFolder && isFolder(file) && !file.trashed) || null : null;
}

function getFolderParentContext(folder) {
    const id = folder?.parents?.[0] || null;
    if (!id || id === 'root') return { id: null, name: null, file: null };
    const file = allFiles.find(item => item.id === id) || null;
    return { id, name: file?.name || folderMap[id] || null, file };
}

function canManageFolderPermissions(file) {
    return canCurrentAccountManageSharing(file) && file?.capabilities?.canShare === true;
}

export function getFolderEffectiveAccess(folder, permissions = []) {
    const parent = getFolderParentContext(folder);
    const inherited = (Array.isArray(permissions) ? permissions : []).filter(permission => getInheritedParentId(permission));
    const inheritedFromParent = inherited.some(permission => getInheritedParentId(permission) === parent.id);
    const parentManageKnown = parent.file ? canManageFolderPermissions(parent.file) : null;
    const actionRestricted = folder?.capabilities?.canShare === false || folder?.capabilities?.canTrash === false;
    const parentConstraint = Boolean(parent.id && folder?.ownedByMe === true && parent.file?.ownedByMe !== true &&
        (actionRestricted || (inheritedFromParent && parentManageKnown === false)));
    return {
        parent,
        hasInheritedParent: inheritedFromParent,
        parentConstraint,
        canManagePermissions: canManageFolderPermissions(folder),
        canTransferOwnership: Boolean(folder?.ownedByMe === true && folder?.capabilities?.canShare === true && !folder.driveId && !folder.teamDriveId),
        canTrash: folder?.capabilities?.canTrash === true,
        canManageInherited: permission => {
            const parentId = getInheritedParentId(permission);
            if (!parentId) return false;
            const source = parentId === parent.id ? parent.file : allFiles.find(item => item.id === parentId);
            return source ? canManageFolderPermissions(source) : undefined;
        }
    };
}

function setFolderHeaderText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function closeFolderHeaderMenu() {
    const menu = document.getElementById('mydrive-folder-header-menu');
    const button = document.getElementById('mydrive-folder-header-more');
    if (menu) menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
}

function renderFolderHeaderActions(folder, permissions) {
    const access = getFolderEffectiveAccess(folder, permissions);
    const permissionSummary = permissions ? getFolderPermissionSummary(permissions) : null;
    const inheritedActionable = Array.isArray(permissions) && permissions.some(permission =>
        getInheritedParentId(permission) && access.canManageInherited(permission) !== false
    );
    const canOpenPermissionManager = access.canManagePermissions || inheritedActionable;
    const manageButton = document.getElementById('mydrive-folder-header-manage');
    const stopSharing = document.querySelector('[data-folder-header-action="stop-sharing"]');
    const transfer = document.querySelector('[data-folder-header-action="transfer"]');
    const request = document.querySelector('[data-folder-header-action="request"]');
    const trash = document.querySelector('[data-folder-header-action="trash"]');
    const openDrive = document.querySelector('[data-folder-header-action="open-drive"]');
    if (manageButton) manageButton.disabled = !canOpenPermissionManager;
    if (stopSharing) stopSharing.hidden = !(inheritedActionable || (access.canManagePermissions && (permissionSummary?.hasSharing ?? getFileActionState(folder).stopSharing)));
    if (transfer) transfer.hidden = !access.canTransferOwnership;
    if (request) request.hidden = folder.ownedByMe === true;
    if (trash) trash.hidden = !access.canTrash;
    if (openDrive) openDrive.disabled = !folder.webViewLink;
}

function renderFolderHeaderParentConstraint(folder, permissions) {
    const row = document.getElementById('mydrive-folder-header-parent');
    const text = document.getElementById('mydrive-folder-header-parent-text');
    const warning = document.getElementById('mydrive-folder-header-parent-warning');
    if (!row || !text || !warning) return;
    const access = getFolderEffectiveAccess(folder, permissions);
    const show = access.parentConstraint || access.hasInheritedParent;
    row.hidden = !show;
    if (!show) return;
    text.textContent = access.parent.name ? `🔗 Nằm trong "${access.parent.name}"` : '🔗 Nằm trong thư mục cha';
    warning.hidden = !access.parentConstraint;
    warning.textContent = access.parent.name
        ? `⚠ Một số thao tác được quản lý bởi thư mục cha "${access.parent.name}"`
        : '⚠ Một số thao tác được quản lý bởi thư mục cha';
}

function renderFolderHeaderPermissionState(folder, permissions, state = 'ready') {
    const loading = document.getElementById('mydrive-folder-header-loading');
    const error = document.getElementById('mydrive-folder-header-error');
    const privateBadge = document.getElementById('mydrive-folder-header-private');
    const publicBadge = document.getElementById('mydrive-folder-header-public');
    const domainBadge = document.getElementById('mydrive-folder-header-domain');
    const peopleBadge = document.getElementById('mydrive-folder-header-people');
    if (loading) loading.hidden = state !== 'loading';
    if (error) error.hidden = state !== 'error';
    [privateBadge, publicBadge, domainBadge, peopleBadge].forEach(badge => { if (badge) badge.hidden = true; });
    renderFolderHeaderParentConstraint(folder, state === 'ready' ? permissions : []);
    if (state !== 'ready') return;
    const summary = getFolderPermissionSummary(permissions);
    if (!summary.hasSharing && privateBadge) privateBadge.hidden = false;
    if (summary.isPublic && publicBadge) {
        publicBadge.hidden = false;
        publicBadge.textContent = summary.publicInherited ? '🌐 Công khai · Kế thừa' : '🌐 Công khai';
    }
    if (summary.hasDomain && domainBadge) {
        domainBadge.hidden = false;
        domainBadge.textContent = summary.domainInherited ? '🏢 Nội bộ · Kế thừa' : '🏢 Nội bộ';
    }
    if (summary.principalCount && peopleBadge) {
        peopleBadge.hidden = false;
        peopleBadge.textContent = summary.directPrincipalCount === 0 && summary.inheritedPrincipalCount > 0
            ? `👥 ${fmt(summary.inheritedPrincipalCount)} quyền kế thừa`
            : `👥 ${fmt(summary.principalCount)} quyền truy cập${summary.hasInheritedAccess ? ' · Kế thừa' : ''}`;
    }
    renderFolderHeaderActions(folder, permissions);
}

function renderFolderHeader() {
    const header = document.getElementById('mydrive-folder-header');
    const folder = getCurrentFolderFile();
    const requestId = ++folderHeaderRequestId;
    closeFolderHeaderMenu();
    if (!header) return;
    if (!folder) {
        header.hidden = true;
        return;
    }
    header.hidden = false;
    const counts = getImmediateFolderContentCounts(folder.id, ownedFiles);
    const owner = folder.owners?.[0];
    setFolderHeaderText('mydrive-folder-header-name', folder.name || 'Thư mục không tên');
    setFolderHeaderText('mydrive-folder-header-counts', `${fmt(counts.files)} tệp · ${fmt(counts.folders)} thư mục`);
    setFolderHeaderText('mydrive-folder-header-owner', folder.ownedByMe === true
        ? '👤 Bạn là chủ sở hữu'
        : `👤 ${owner?.displayName || owner?.emailAddress || 'Không xác định chủ sở hữu'}`);
    renderFolderHeaderActions(folder);
    const cachedPermissions = folderHeaderPermissions.get(folder.id);
    if (cachedPermissions) {
        renderFolderHeaderPermissionState(folder, cachedPermissions);
        return;
    }
    renderFolderHeaderPermissionState(folder, [], 'loading');
    getFilePermissions(folder.id).then(permissions => {
        if (requestId !== folderHeaderRequestId || currentFolder !== folder.id) return;
        const safePermissions = Array.isArray(permissions) ? permissions : [];
        folderHeaderPermissions.set(folder.id, safePermissions);
        renderFolderHeaderPermissionState(folder, safePermissions);
    }).catch(error => {
        console.warn('Không thể tải quyền thư mục cho Folder Header:', error);
        if (requestId !== folderHeaderRequestId || currentFolder !== folder.id) return;
        renderFolderHeaderPermissionState(folder, [], 'error');
    });
}

function updateBulkSelectionBar() {
    const bar = document.getElementById('mydrive-bulk-action-bar');
    const count = document.getElementById('mydrive-bulk-count');
    if (!bar) return;
    bar.classList.toggle('is-visible', selectedFileIds.size > 0);
    if (count) count.innerHTML = `<strong>${fmt(selectedFileIds.size)}</strong> file đã chọn`;
}

function clearMyDriveSelection() {
    selectedFileIds.clear();
    document.querySelectorAll('#mydrive-tbody .wix-chk-row').forEach(checkbox => { checkbox.checked = false; });
    const selectAll = document.getElementById('mydrive-chk-all');
    if (selectAll) selectAll.checked = false;
    updateBulkSelectionBar();
}

function clearSelectionOutsideCurrentContext() {
    const visibleIds = new Set(getFilteredFiles().map(file => file.id));
    selectedFileIds = new Set([...selectedFileIds].filter(id => visibleIds.has(id)));
    updateBulkSelectionBar();
}

function getSelectedMyDriveFiles() {
    return allFiles.filter(file => selectedFileIds.has(file.id));
}

async function handleBulkDownload() {
    if (isBulkDownloadInFlight) return;
    const files = getSelectedMyDriveFiles().filter(file => file.capabilities?.canDownload !== false);
    if (!files.length) { Toast.warning('Không có tệp nào có thể tải xuống.'); return; }
    const button = document.getElementById('mydrive-bulk-btn-download');
    isBulkDownloadInFlight = true;
    if (button) button.disabled = true;
    let completed = 0;
    try {
        for (const file of files) {
            const token = await getAuthToken();
            const downloader = new SmartDownloader(token);
            try {
                const saved = await downloader.start(file.id, file.name, parseInt(file.size || 0), () => {});
                if (saved) completed++;
            } catch (error) {
                console.warn('Bulk download failed:', file.id, error);
            }
        }
        if (completed) Toast.success(`Đã tải ${completed} tệp.`);
    } finally {
        if (button) button.disabled = false;
        isBulkDownloadInFlight = false;
    }
}

async function handleBulkRevoke() {
    if (isBulkRevokeInFlight) return;
    const files = getSelectedMyDriveFiles().filter(file => getFileActionState(file).stopSharing);
    if (!files.length) { Toast.warning('Không có tệp nào đang được chia sẻ để thu hồi quyền.'); return; }
    if (!await openActionConfirm(`Ngừng chia sẻ ${files.length} tệp đã chọn?`)) return;
    const operation = await requireCleanupMutation(files);
    if (!operation) return;
    const button = document.getElementById('mydrive-bulk-btn-revoke');
    isBulkRevokeInFlight = true;
    if (button) button.disabled = true;
    const actions = [];
    let failed = 0;
    try {
        for (const file of files) {
            if (!operation.allowedFileIds.includes(file.id)) { failed++; continue; }
            try {
                if (!canCurrentAccountManageSharing(allFiles.find(item => item.id === file.id))) { failed++; continue; }
                const permissions = await getFilePermissions(file.id);
                const revocable = permissions.filter(permission => permission.role !== 'owner' && !permission.inherited && !permission.permissionDetails?.some(detail => detail.inherited));
                const revokedIds = new Set();
                for (const permission of revocable) {
                    if (!canCurrentAccountManageSharing(allFiles.find(item => item.id === file.id))) { break; }
                    try {
                        await revokePermission(file.id, permission.id);
                        revokedIds.add(permission.id);
                    } catch (_) { /* Keep partial failures visible in final count. */ }
                }
                if (!revokedIds.size) { failed++; continue; }
                file.permissions = (file.permissions || []).filter(permission => !revokedIds.has(permission.id));
                file.shared = file.permissions.some(permission => permission.role !== 'owner');
                actions.push({ type: 'revoke', fileId: file.id, fileName: file.name, fileSize: file.size, actionLabel: 'Thu hồi quyền' });
            } catch (_) { failed++; }
        }
        if (actions.length) {
            await logActionsBulk(actions, operation);
            refreshMyDriveAfterMutation();
            Toast.success(`Đã thu hồi quyền chia sẻ của ${actions.length} tệp.`);
        }
        if (!actions.length) await failReservedCleanup(operation);
        if (failed) Toast.warning(`Không thể thu hồi quyền của ${failed} tệp.`);
    } finally {
        if (button) button.disabled = false;
        isBulkRevokeInFlight = false;
    }
}

async function handleBulkTransferOwnership() {
    if (isBulkTransferInFlight) return;
    const selected = getSelectedMyDriveFiles();
    const files = selected.filter(file => file.ownedByMe === true && file.capabilities?.canShare !== false && !file.trashed);
    const skipped = selected.length - files.length;
    if (!files.length) { Toast.warning('Không có tệp nào đủ quyền để chuyển sở hữu.'); return; }
    const email = await openOwnershipTransferModal(files);
    if (!email || !EMAIL_RE.test(email.trim())) {
        if (email) Toast.warning('Email không hợp lệ');
        return;
    }
    const operation = await requireCleanupMutation(files);
    if (!operation) return;
    const button = document.getElementById('mydrive-bulk-btn-transfer');
    isBulkTransferInFlight = true;
    if (button) button.disabled = true;
    const actions = [];
    let failed = 0;
    try {
        for (const file of files) {
            if (!operation.allowedFileIds.includes(file.id)) { failed++; continue; }
            try {
                const result = await transferOwnership(file, email.trim().toLowerCase());
                if (result.status !== 'completed' && result.status !== 'pending') { failed++; continue; }
                if (result.status === 'completed') {
                    file.ownedByMe = false;
                    file.owners = [{ emailAddress: result.email, me: false }];
                }
                if (!result.alreadyPending) actions.push({ type: result.status === 'completed' ? 'transfer_ownership' : 'transfer_ownership_pending', fileId: file.id, fileName: file.name, fileSize: file.size, actionLabel: 'Chuyển quyền sở hữu' });
            } catch (_) { failed++; }
        }
        if (actions.length) await logActionsBulk(actions, operation);
        else await failReservedCleanup(operation);
        refreshMyDriveAfterMutation();
        if (actions.length) Toast.success(`Đã xử lý chuyển sở hữu cho ${actions.length} tệp.`);
        if (failed || skipped) Toast.warning(`${failed} thất bại, ${skipped} không đủ điều kiện.`);
    } finally {
        if (button) button.disabled = false;
        isBulkTransferInFlight = false;
    }
}

function refreshMyDriveAfterMutation() {
    ownedFiles = allFiles.filter(file => file.ownedByMe === true);
    if (currentFolder && !ownedFiles.some(file => file.id === currentFolder && isFolder(file) && !file.trashed)) {
        setMyDriveFolder(null);
    }
    rebuildOwnedFolderIndex();
    const duplicateGroups = findDuplicates(ownedFiles.filter(file => !isFolder(file) && !file.trashed));
    duplicateFileIds = new Set(duplicateGroups.flatMap(group => group.map(file => file.id)));
    renderTree(folderTree);
    const activeFolderId = currentFolder || 'root';
    document.querySelectorAll('.tree-row').forEach(row => {
        row.classList.toggle('active', row.dataset.folderId === activeFolderId);
    });
    clearSelectionOutsideCurrentContext();
    refreshSelectedFolderView();
}

function updateFolderHeaderPermissionCache(fileId, updater) {
    const permissions = folderHeaderPermissions.get(fileId);
    if (!permissions) return;
    folderHeaderPermissions.set(fileId, updater(permissions));
}

async function openFolderPermissionManager(folder, { revokeAllOnOpen = false } = {}) {
    const access = getFolderEffectiveAccess(folder, folderHeaderPermissions.get(folder.id));
    const inheritedActionable = (folderHeaderPermissions.get(folder.id) || []).some(permission =>
        getInheritedParentId(permission) && access.canManageInherited(permission) !== false
    );
    if (!access.canManagePermissions && !inheritedActionable) {
        Toast.error('Bạn không có quyền ngừng chia sẻ thư mục này.');
        return;
    }
    await openSharePermissionsModal({
        file: folder,
        getFilePermissions,
        getFileOwner,
        getFileMetadata,
        removeCachedPermission,
        revokePermission,
        requireCleanupMutation,
        revokeAllOnOpen,
        toast: Toast,
        getInheritedParentName: parentId => {
            const parent = parentId === access.parent.id ? access.parent : getFolderParentContext({ parents: [parentId] });
            return parent.name || '';
        },
        canManageInheritedPermission: access.canManageInherited,
        allowInheritedPermissionManagement: true,
        canManageSharing: candidate => canManageFolderPermissions(candidate || allFiles.find(item => item.id === folder.id)),
        onPermissionRevoked: async (permission, operation) => {
            folder.permissions = (folder.permissions || []).filter(item => item.id !== permission?.id);
            folder.shared = folder.permissions.some(item => item.role !== 'owner');
            updateFolderHeaderPermissionCache(folder.id, permissions => permissions.filter(item => item.id !== permission?.id));
            await logAction({ type: 'revoke', fileId: folder.id, fileName: folder.name, actionLabel: 'Thu hồi quyền thư mục' }, operation);
            refreshMyDriveAfterMutation();
        },
        onPermissionsRevoked: async (permissions, operation) => {
            const revokedIds = new Set(permissions.map(permission => permission.id));
            folder.permissions = (folder.permissions || []).filter(item => !revokedIds.has(item.id));
            folder.shared = folder.permissions.some(item => item.role !== 'owner');
            updateFolderHeaderPermissionCache(folder.id, cached => cached.filter(item => !revokedIds.has(item.id)));
            await logAction({ type: 'revoke', fileId: folder.id, fileName: folder.name, actionLabel: 'Thu hồi quyền thư mục' }, operation);
            refreshMyDriveAfterMutation();
        },
        onInheritedPermissionRevoked: async ({ parent, parentPermission, childPermission, operation }) => {
            const cachedParent = allFiles.find(item => item.id === parent.id);
            if (cachedParent) {
                cachedParent.permissions = (cachedParent.permissions || []).filter(item => item.id !== parentPermission.id);
                cachedParent.shared = cachedParent.permissions.some(item => item.role !== 'owner');
            }
            folder.permissions = (folder.permissions || []).filter(item => item.id !== childPermission.id);
            folder.shared = folder.permissions.some(item => item.role !== 'owner');
            updateFolderHeaderPermissionCache(parent.id, cached => cached.filter(item => item.id !== parentPermission.id));
            updateFolderHeaderPermissionCache(folder.id, cached => cached.filter(item => item.id !== childPermission.id));
            await logAction({ type: 'revoke', fileId: parent.id, fileName: parent.name, actionLabel: 'Thu hồi quyền thư mục cha' }, operation);
            refreshMyDriveAfterMutation();
        }
    });
}

async function transferFolderOwnership(folder) {
    if (!getFolderEffectiveAccess(folder).canTransferOwnership) {
        Toast.error('Bạn không có quyền chuyển quyền sở hữu thư mục này.');
        return;
    }
    const email = await openOwnershipTransferModal([folder]);
    if (!email) return;
    if (!EMAIL_RE.test(email.trim())) { Toast.warning('Email không hợp lệ'); return; }
    const operation = await requireCleanupMutation(folder.id);
    if (!operation) return;
    const result = await transferOwnership(folder, email.trim().toLowerCase());
    if (result.status === 'completed') {
        folder.ownedByMe = false;
        folder.owners = [{ emailAddress: result.email, me: false }];
        const permission = (folder.permissions || []).find(item => item.emailAddress?.trim().toLowerCase() === result.email);
        if (permission) permission.role = 'owner';
        await logAction({ type: 'transfer_ownership', fileId: folder.id, fileName: folder.name, fileSize: folder.size, actionLabel: 'Chuyển quyền sở hữu thư mục' }, operation);
        Toast.success('Đã chuyển quyền sở hữu thư mục thành công!');
        refreshMyDriveAfterMutation();
    } else if (result.status === 'pending') {
        if (!result.alreadyPending) await logAction({ type: 'transfer_ownership_pending', fileId: folder.id, fileName: folder.name, fileSize: folder.size, actionLabel: 'Gửi lời mời chuyển quyền sở hữu thư mục' }, operation);
        Toast.info('Đã gửi lời mời chuyển quyền sở hữu. Người nhận cần chấp nhận trong email.');
    } else if (result.status === 'already_owner') {
        await failReservedCleanup(operation);
        Toast.info('Email này đã là chủ sở hữu của thư mục.');
    }
}

async function requestFolderOwnership(folder) {
    await openOwnershipRequestModal({ files: [folder], getFileOwner, submitOwnershipRequest, ownershipRequestMessage, toast: Toast });
}

async function trashFolder(folder) {
    if (!getFolderEffectiveAccess(folder).canTrash) {
        Toast.error('Google Drive không cho phép chuyển thư mục này vào thùng rác từ vị trí hiện tại.');
        return;
    }
    const counts = getImmediateFolderContentCounts(folder.id, ownedFiles);
    if (!await openActionConfirm(`Chuyển thư mục "${folder.name}" vào thùng rác?\nThư mục có ${counts.files} tệp và ${counts.folders} thư mục con trực tiếp.`)) return;
    const operation = await requireCleanupMutation(folder.id);
    if (!operation) return;
    await deleteFile(folder.id);
    folder.trashed = true;
    folderHeaderPermissions.delete(folder.id);
    const parentId = parentMap[folder.id];
    setMyDriveFolder(parentId && ownedFiles.some(item => item.id === parentId && isFolder(item) && !item.trashed) ? parentId : null);
    await logAction({ type: 'delete', fileId: folder.id, fileName: folder.name, fileSize: folder.size, actionLabel: 'Xóa thư mục' }, operation);
    Toast.success(`Đã chuyển thư mục "${folder.name}" vào thùng rác.`);
    refreshMyDriveAfterMutation();
}

function renderTree(nodes, container, isRootLevel = true) {
    if (!container) container = document.getElementById('sidebar-tree');
    if (!container) return;

    if (isRootLevel) {
        container.innerHTML = '';
    }

    if (isRootLevel) {
        // Add root "My Drive" row
        const rootLi = document.createElement('li');
        rootLi.className = 'tree-item';

        const rootRow = document.createElement('div');
        rootRow.className = 'tree-row';
        rootRow.dataset.folderId = 'root';

        const rootToggle = document.createElement('span');
        rootToggle.className = 'tree-toggle';
        rootToggle.textContent = nodes && nodes.length > 0 ? '▾' : '';
        rootToggle.style.visibility = nodes && nodes.length > 0 ? 'visible' : 'hidden';

        const rootIcon = document.createElement('span');
        rootIcon.className = 'tree-icon';
        rootIcon.textContent = '📁';

        const rootName = document.createElement('span');
        rootName.className = 'tree-name';
        rootName.textContent = 'My Drive';

        const rootCount = document.createElement('span');
        rootCount.className = 'tree-count';
        const rootFileCount = ownedFiles.filter(f => !isFolder(f) && !f.trashed).length;
        rootCount.textContent = fmt(rootFileCount);

        rootRow.appendChild(rootToggle);
        rootRow.appendChild(rootIcon);
        rootRow.appendChild(rootName);
        rootRow.appendChild(rootCount);
        rootLi.appendChild(rootRow);

        const rootChildrenUl = document.createElement('ul');
        rootChildrenUl.className = 'tree-children';
        rootChildrenUl.style.display = nodes && nodes.length > 0 ? 'block' : 'none';
        rootLi.appendChild(rootChildrenUl);

        // Root toggle
        rootToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = rootChildrenUl.style.display === 'block';
            rootChildrenUl.style.display = isOpen ? 'none' : 'block';
            rootToggle.textContent = isOpen ? '▸' : '▾';
        });

        // Root click — clear folder filter (show all)
        rootRow.addEventListener('click', () => {
            document.querySelectorAll('.tree-row.active').forEach(el => el.classList.remove('active'));
            rootRow.classList.add('active');
            setMyDriveFolder(null);
            clearMyDriveSelection();
            refreshSelectedFolderView();
        });

        container.appendChild(rootLi);

        if (!nodes || nodes.length === 0) return;

        // Render child folders inside root's children
        for (const node of sortedFolderNodes(nodes)) {
            buildTreeItem(node, rootChildrenUl);
        }
    } else {
        // Recursive level — no root row
        for (const node of sortedFolderNodes(nodes)) {
            buildTreeItem(node, container);
        }
    }
}

function buildTreeItem(node, parentContainer) {
    const li = document.createElement('li');
    li.className = 'tree-item';

    const row = document.createElement('div');
    row.className = 'tree-row';
    row.dataset.folderId = node.id;

    const hasChildren = node.children && node.children.length > 0;

    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    toggle.textContent = hasChildren ? '▸' : '';
    toggle.style.visibility = hasChildren ? 'visible' : 'hidden';

    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.textContent = '📁';

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = node.name;

    const count = document.createElement('span');
    count.className = 'tree-count';
    count.textContent = fmt(node.count);

    row.appendChild(toggle);
    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(count);
    li.appendChild(row);

    const childrenUl = document.createElement('ul');
    childrenUl.className = 'tree-children';
    childrenUl.style.display = 'none';
    li.appendChild(childrenUl);

    if (hasChildren) {
        renderTree(node.children, childrenUl, false);
    }

    // Toggle expand/collapse
    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = childrenUl.style.display === 'block';
        childrenUl.style.display = isOpen ? 'none' : 'block';
        toggle.textContent = isOpen ? '▸' : '▾';
    });

    // Click on row — set active + filter table
    row.addEventListener('click', () => {
        document.querySelectorAll('.tree-row.active').forEach(el => el.classList.remove('active'));
        row.classList.add('active');
        setMyDriveFolder(node.id);
        clearMyDriveSelection();
        refreshSelectedFolderView();
    });

    parentContainer.appendChild(li);
}

/* ── Card Stats ───────────────────────────────────────────── */
export function computeCards(files) {
    const owned = files.filter(f => f.ownedByMe && !f.trashed);
    const folders = owned.filter(f => isFolder(f));
    const nonFolders = owned.filter(f => !isFolder(f));

    const totalSize = nonFolders.reduce((s, f) => s + (parseInt(f.size) || 0), 0);
    const publicFiles = owned.filter(f => !isFolder(f) && !f.trashed && (f.permissions || []).some(p => p.type === 'anyone'));
    const emptyFiles = nonFolders.filter(f => !parseInt(f.size));
    const dupes = findDuplicates(nonFolders);

    const wastedSize = dupes.reduce((s, g) => {
        if (g.length < 2) return s;
        const sizes = g.map(f => parseInt(f.size) || 0).filter(sz => sz > 0);
        if (sizes.length === 0) return s;
        return s + (sizes[0] * (g.length - 1));
    }, 0);

    return {
        storage: formatBytes(totalSize),
        storageSub: `${fmt(nonFolders.length)} tệp · ${fmt(folders.length)} thư mục`,
        public: fmt(publicFiles.length),
        dupes: `${fmt(dupes.filter(g => g.length >= 2).length)} nhóm`,
        dupesSub: `Lãng phí ${formatBytes(wastedSize)}`,
        empty: fmt(emptyFiles.length),
    };
}

/* ── Duplicate detection (simplified) ─────────────────────── */
function findDuplicates(files) {
    const groups = [];
    const seen = {};

    for (const f of files) {
        if (isFolder(f) || f.trashed) continue;
        const key = getDuplicateGroupingKey(f);
        if (!key) continue;
        if (!seen[key]) { seen[key] = []; groups.push(seen[key]); }
        seen[key].push(f);
    }

    return groups.filter(g => g.length >= 2);
}

/* ── Table ────────────────────────────────────────────────── */
function getFilteredFiles() {
    let files = getSelectedFolderDataset().filter(f => !f.trashed && (myDriveFileType === 'folder' || !isFolder(f)));

    // Bộ lọc card summary — giữ nguyên logic đếm card (không đổi giao diện)
    if (activeCardFilter) {
        if (activeCardFilter === 'public') {
            files = files.filter(f => isPublicFile(f));
        } else if (activeCardFilter === 'dupes') {
            files = files.filter(f => duplicateFileIds.has(f.id));
        } else if (activeCardFilter === 'empty') {
            files = files.filter(f => isEmptyFile(f));
        }
    }

    if (searchKeyword) {
        const kw = searchKeyword.toLowerCase();
        files = files.filter(f => (f.name || '').toLowerCase().includes(kw));
    }

    if (myDriveFileType) files = files.filter(file => matchesFileTypeFilter(file, myDriveFileType));

    return files;
}

function renderList(pageFiles, total, totalPages) {
    const tbody = document.getElementById('mydrive-tbody');
    const empty = document.getElementById('mydrive-empty');
    const listStatus = document.getElementById('mydrive-list-status');

    if (!tbody) return;

    if (listStatus) listStatus.textContent = `${fmt(total)} file`;

    if (pageFiles.length === 0) {
        tbody.innerHTML = '';
        if (empty) empty.style.display = 'block';
        return;
    }

    if (empty) empty.style.display = 'none';

    tbody.innerHTML = pageFiles.map(f => buildRow(f)).join('');

    tbody.querySelectorAll('.wix-chk-row').forEach(checkbox => {
        checkbox.checked = selectedFileIds.has(checkbox.dataset.id);
    });

    // Bind select all
    const chkAll = document.getElementById('mydrive-chk-all');
    if (chkAll) {
        chkAll.onchange = () => {
            document.querySelectorAll('#mydrive-tbody .wix-chk-row').forEach(cb => {
                cb.checked = chkAll.checked;
                if (chkAll.checked) selectedFileIds.add(cb.dataset.id);
                else selectedFileIds.delete(cb.dataset.id);
            });
            updateBulkSelectionBar();
        };
    }
    const visibleChecks = [...tbody.querySelectorAll('.wix-chk-row')];
    if (chkAll) chkAll.checked = visibleChecks.length > 0 && visibleChecks.every(checkbox => checkbox.checked);
    updateBulkSelectionBar();
}

function renderPagination(total, totalPages) {
    const pagination = document.getElementById('mydrive-pagination');
    if (!pagination) return;

    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }

    let html = '';
    if (currentPage > 1) {
        html += `<button class="wix-pg-btn" data-page="${currentPage - 1}">‹</button>`;
    }
    for (const item of getMyDrivePaginationItems(currentPage, totalPages)) {
        if (item === 'ellipsis') {
            html += `<span class="wix-pg-dots">…</span>`;
        } else {
            html += `<button class="wix-pg-btn${item === currentPage ? ' wix-pg-btn--active' : ''}" data-page="${item}">${item}</button>`;
        }
    }
    if (currentPage < totalPages) {
        html += `<button class="wix-pg-btn" data-page="${currentPage + 1}">›</button>`;
    }
    pagination.innerHTML = html;
    pagination.onclick = (e) => {
        const btn = e.target.closest('[data-page]');
        if (!btn) return;
        currentPage = parseInt(btn.dataset.page);
        renderCurrentView();
        document.getElementById('mydrive-table-wrapper')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
}

function getStatusBadge(file) {
    if (file.trashed) return `<span class="vbadge vbadge--trash">Thùng rác</span>`;
    const isPublic = (file.permissions || []).some(p => p.type === 'anyone');
    if (isPublic) return `<span class="vbadge vbadge--public">Công khai</span>`;
    const hasDomain = (file.permissions || []).some(p => p.type === 'domain');
    if (hasDomain) return `<span class="vbadge vbadge--internal">Nội bộ</span>`;
    if (file.shared) return `<span class="vbadge vbadge--shared">Shared</span>`;
    return `<span class="vbadge vbadge--private">Riêng tư</span>`;
}

function getPath(file) {
    if (!file.parents || file.parents.length === 0) return 'My Drive';
    const parent = file.parents[0];
    const name = folderMap[parent];
    if (!name) return 'My Drive';
    return `My Drive > ${escapeHtml(name)}`;
}

function getFileActionState(file) {
    const perms = file.permissions || [];
    const hasShareable = perms.some(p => p.type === 'anyone' || p.type === 'domain' || p.type === 'group' || (p.type === 'user' && p.role !== 'owner'));
    return {
        transferOwner: Boolean(file.ownedByMe && file.capabilities?.canShare && !file.driveId && !file.teamDriveId),
        requestOwner: Boolean(!file.ownedByMe),
        stopSharing: canCurrentAccountManageSharing(file) && Boolean(file.shared || hasShareable),
        compareDuplicate: canCurrentAccountManageSharing(file) && duplicateFileIds.has(file.id),
        deleteFile: Boolean(file.capabilities?.canTrash || file.capabilities?.canDelete || file.ownedByMe)
    };
}

function buildRow(file) {
    const fileSize = parseInt(file.size) || 0;
    const iconColor = getFileColor(file.mimeType);
    const fileIcon = getFileIcon(file.mimeType);
    const safeName = escapeHtml(file.name || '');

    const isPublic = (file.permissions || []).some(p => p.type === 'anyone');
    const hasAnyone = isPublic;
    const hasDomain = (file.permissions || []).some(p => p.type === 'domain');

    let shareHtml = '';
    if (hasAnyone) shareHtml = '<span class="access-badge access-badge--public"><i class="fas fa-globe"></i></span>';
    else if (hasDomain) shareHtml = '<span class="access-badge access-badge--domain"><i class="fas fa-building"></i></span>';
    else if (file.shared) shareHtml = '<span class="access-badge access-badge--shared"><i class="fas fa-users"></i></span>';
    else shareHtml = '<span class="access-badge access-badge--private"><i class="fas fa-lock"></i></span>';

    const ownerName = (file.owners && file.owners.length > 0) ? escapeHtml(file.owners[0].displayName || '') : (file.ownedByMe ? 'Tôi' : 'Khác');

    const ac = getFileActionState(file);
    const aCls = (ok) => ok ? '' : ' action-btn-5--disabled';
    const aDis = (ok) => ok ? '' : 'disabled aria-disabled="true" tabindex="-1"';

    const displayDates = getDisplayTimestamps(file);

    return `<tr data-file-id="${escapeHtml(file.id)}">
        <td><input type="checkbox" class="wix-chk wix-chk-row" data-id="${escapeHtml(file.id)}"></td>
        <td><span class="file-name-cell"><i class="${fileIcon} file-icon" style="color:${iconColor}"></i><span class="file-name-text">${escapeHtml(file.name || 'Unnamed')}</span></span></td>
        <td style="color:var(--text-muted);font-size:13px;">${getPath(file)}</td>
        <td>${getStatusBadge(file)}</td>
        <td style="color:var(--text-secondary);font-size:13px;">${ownerName}</td>
        <td class="td-shared" data-file-id="${escapeHtml(file.id)}" data-file-name="${safeName}">${shareHtml}</td>
        <td class="td-size" style="font-weight:500;font-size:13px;">${fileSize > 0 ? formatBytes(fileSize) : '—'}</td>
        <td style="color:var(--text-muted);font-size:12px;">${displayDates.createdTime ? formatDate(displayDates.createdTime) : '—'}</td>
        <td style="color:var(--text-muted);font-size:12px;">${displayDates.modifiedTime ? formatDate(displayDates.modifiedTime) : '—'}</td>
        <td class="td-actions"><div class="action-links-5">
            <button class="action-btn-5 action-btn-5--transfer${aCls(ac.transferOwner)}" data-action="transfer" data-file-id="${escapeHtml(file.id)}" data-file-name="${safeName}" title="Chuyển quyền sở hữu sang người khác" ${aDis(ac.transferOwner)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 8 21 12 17 16"/><line x1="9" y1="12" x2="21" y2="12"/></svg></button>
            <button class="action-btn-5 action-btn-5--request${aCls(ac.requestOwner)}" data-action="request" data-file-id="${escapeHtml(file.id)}" data-file-name="${safeName}" title="Yêu cầu lấy lại quyền sở hữu về bạn" ${aDis(ac.requestOwner)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>
            <button class="action-btn-5 action-btn-5--stop-share${aCls(ac.stopSharing)}" data-action="stop-sharing" data-file-id="${escapeHtml(file.id)}" data-file-name="${safeName}" title="Ngừng chia sẻ - đưa file về riêng tư, chỉ người được cấp mới mở được" ${aDis(ac.stopSharing)}><i class="fas fa-lock"></i></button>
            <button class="action-btn-5 action-btn-5--compare${aCls(ac.compareDuplicate)}" data-action="compare" data-file-id="${escapeHtml(file.id)}" data-file-name="${safeName}" title="So sánh & xóa bản trùng nội dung, giữ bản gốc" ${aDis(ac.compareDuplicate)}><i class="fas fa-copy"></i></button>
            <button class="action-btn-5 action-btn-5--delete${aCls(ac.deleteFile)}" data-action="delete" data-file-id="${escapeHtml(file.id)}" data-file-name="${safeName}" title="Xóa tệp" ${aDis(ac.deleteFile)}><i class="fas fa-trash"></i></button>
        </div></td>
    </tr>`;
}

/* ── Preview Panel ────────────────────────────────────── */
function getPreviewBadgeText(mime) {
    if (mime.includes('image')) return 'Ảnh render trực tiếp từ Google Drive';
    if (mime.includes('video')) return 'Video stream từ Google Drive';
    if (mime.includes('pdf')) return 'Xem tài liệu qua trình xem Drive';
    if (mime.includes('zip') || mime.includes('rar') || mime.includes('gzip') || mime.includes('tar') || mime.includes('7z')) return 'Loại tệp này chưa hỗ trợ xem nhanh';
    if (mime.includes('document') || mime.includes('word')) return 'Xem tài liệu qua Google Docs';
    if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('sheet')) return 'Xem bảng tính qua Google Sheets';
    if (mime.includes('audio')) return 'Phát audio từ Google Drive';
    if (mime.includes('folder')) return 'Thư mục Google Drive';
    return 'Loại tệp này chưa hỗ trợ xem nhanh';
}

function getPreviewIcon(mime) {
    if (mime.includes('image')) return 'fa-file-image';
    if (mime.includes('video')) return 'fa-file-video';
    if (mime.includes('pdf')) return 'fa-file-pdf';
    if (mime.includes('zip') || mime.includes('rar') || mime.includes('gzip') || mime.includes('tar') || mime.includes('7z')) return 'fa-file-archive';
    if (mime.includes('document') || mime.includes('word')) return 'fa-file-word';
    if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('sheet')) return 'fa-file-excel';
    if (mime.includes('audio')) return 'fa-file-audio';
    if (mime.includes('folder')) return 'fa-folder';
    return 'fa-file';
}

function openPreview(file) {
    const displayDates = getDisplayTimestamps(file);
    selectedFile = file;
    isPreviewOpen = true;

    const name = file.name || '—';

    document.getElementById('mdrv-previewFileName').textContent = name;
    document.getElementById('mdrv-previewPath').textContent = getPath(file);

    const isPublic = (file.permissions || []).some(p => p.type === 'anyone');
    const hasDomain = (file.permissions || []).some(p => p.type === 'domain');
    let statusText = 'Riêng tư';
    if (file.trashed) statusText = 'Thùng rác';
    else if (isPublic) statusText = 'Công khai';
    else if (hasDomain) statusText = 'Nội bộ';
    else if (file.shared) statusText = 'Shared';
    document.getElementById('mdrv-previewStatus').textContent = statusText;

    const ownerName = (file.owners && file.owners.length > 0)
        ? file.owners[0].displayName || '—'
        : (file.ownedByMe ? 'Tôi' : 'Khác');
    document.getElementById('mdrv-previewOwner').textContent = ownerName;

    document.getElementById('mdrv-previewShared').textContent = getSharingDisplay(file);

    const fileSize = parseInt(file.size) || 0;
    document.getElementById('mdrv-previewSize').textContent = fileSize > 0 ? formatBytes(fileSize) : '—';

    document.getElementById('mdrv-previewCreated').textContent = displayDates.createdTime ? formatDate(displayDates.createdTime) : '—';
    document.getElementById('mdrv-previewModified').textContent = displayDates.modifiedTime ? formatDate(displayDates.modifiedTime) : '—';

    document.getElementById('mdrv-previewRecommendation').textContent = isPublic ? 'Thu hồi quyền truy cập' : '—';

    previewController?.open(file);
}

function closePreview() {
    previewController?.close();
    selectedFile = null;
    isPreviewOpen = false;
}

/* ── Main ─────────────────────────────────────────────────── */
async function loadMyDriveData() {
    folderSortMode = await getFolderSortMode();
    myDriveAccountId = await getActiveAccountId().catch(() => null);
    folderHeaderPermissions.clear();
    folderHeaderRequestId++;
    try {
        allFiles = AppState
            ? await AppState.getFiles(loadFilesFromCache, () => scanDrive(true, null))
            : await loadFilesFromCache();
        if (!AppState && (!allFiles || allFiles.length === 0)) allFiles = await scanDrive(true, null);
    } catch (e) {
        console.warn('Load failed, triggering scan:', e);
        try {
            allFiles = await scanDrive(true, null);
        } catch (e2) {
            console.error('Scan failed:', e2);
        }
    }

    if (!allFiles) allFiles = [];

    // Filter owned files only — this is the core requirement
    ownedFiles = allFiles.filter(f => f.ownedByMe === true);
    resetMyDriveFileTypeFilter();
    setMyDriveFolder(null);
    clearMyDriveSelection();

    // Build folder tree from ALL owned items (folders + files for parent refs)
    rebuildOwnedFolderIndex();

    // Compute cards
    const cards = computeCards(getSelectedFolderDataset());

    // Lưu set id file duplicate để filter "File trùng lặp" khớp với số nhóm trên card
    const dupGroups = findDuplicates(ownedFiles.filter(f => !isFolder(f) && !f.trashed));
    duplicateFileIds = new Set(dupGroups.flatMap(g => g.map(f => f.id)));

    // Update UI
    renderTree(folderTree);
    // Activate root "My Drive" by default
    requestAnimationFrame(() => {
        const rootRow = document.querySelector('.tree-item:first-child .tree-row');
        if (rootRow) rootRow.classList.add('active');
    });
    updateCards(cards);
    currentPage = 1;
    renderCurrentView();
}

function updateCards(cards) {
    const elStorage = document.getElementById('mdc-storage');
    const elStorageSub = document.getElementById('mdc-storage-sub');
    const elPublic = document.getElementById('mdc-public');
    const elDupes = document.getElementById('mdc-dupes');
    const elDupesSub = document.getElementById('mdc-dupes-sub');
    const elEmpty = document.getElementById('mdc-empty');

    if (elStorage) elStorage.textContent = cards.storage;
    if (elStorageSub) elStorageSub.textContent = cards.storageSub;
    if (elPublic) elPublic.textContent = cards.public;
    if (elDupes) elDupes.textContent = cards.dupes;
    if (elDupesSub) elDupesSub.textContent = cards.dupesSub;
    if (elEmpty) elEmpty.textContent = cards.empty;
}

/* ── View Toggle Helpers ──────────────────────────────────── */
function setActiveView(id) {
    document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

/* ── Grid View ──────────────────────────────────────────── */
function renderGrid(pageFiles) {
    const grid = document.getElementById('fileGrid');
    if (!grid) return;

    if (!pageFiles || pageFiles.length === 0) {
        grid.innerHTML = '';
        return;
    }

    grid.innerHTML = pageFiles.map(f => buildGridCard(f)).join('');
}

function buildGridCard(file) {
    const icon = getFileIcon(file.mimeType);
    const size = parseInt(file.size) || 0;
    const date = file.modifiedTime ? formatDate(file.modifiedTime) : '—';
    const color = getFileColor(file.mimeType);

    return `<div class="grid-card" data-file-id="${escapeHtml(file.id)}">
        <div class="grid-card__icon">
            <i class="${icon}" style="color:${color}"></i>
        </div>
        <div class="grid-card__name">${escapeHtml(file.name || 'Unnamed')}</div>
        <div class="grid-card__meta">${size > 0 ? formatBytes(size) : '—'} · ${date}</div>
    </div>`;
}

/* ── Render current view (shared pagination) ─────────────── */
function getPaginatedFiles(files) {
    const totalPages = Math.max(1, Math.ceil(files.length / FILES_PER_PAGE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * FILES_PER_PAGE;
    return files.slice(start, start + FILES_PER_PAGE);
}

function updateMyDriveSortIndicators() {
    document.querySelectorAll('[data-mydrive-sort]').forEach(header => {
        const icon = header.querySelector('.sort-icon');
        if (!icon) return;
        const active = header.dataset.mydriveSort === myDriveSort.key;
        icon.className = `fas ${active ? (myDriveSort.direction === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} sort-icon${active ? ' sort-icon--active' : ''}`;
    });
}

function bindMyDriveSort() {
    const table = document.getElementById('mydrive-table');
    if (!table || table._myDriveSortBound) return;
    table._myDriveSortBound = true;
    table.querySelector('thead')?.addEventListener('click', event => {
        const header = event.target.closest('[data-mydrive-sort]');
        if (!header) return;
        const key = header.dataset.mydriveSort;
        myDriveSort.direction = myDriveSort.key === key && myDriveSort.direction === 'asc' ? 'desc' : 'asc';
        myDriveSort.key = key;
        currentPage = 1;
        updateMyDriveSortIndicators();
        renderCurrentView();
    });
    updateMyDriveSortIndicators();
}

function updateViewButtons() {
    setActiveView(currentView === 'list' ? 'btnListView' : 'btnGridView');
    document.getElementById('fileGrid').style.display = currentView === 'grid' ? 'grid' : 'none';
    document.getElementById('fileTable').style.display = currentView === 'list' ? 'block' : 'none';
}

function renderCurrentView() {
    const visibleFiles = sortAnalysisFiles(getFilteredFiles(), myDriveSort);
    const totalPages = Math.max(1, Math.ceil(visibleFiles.length / FILES_PER_PAGE));
    if (currentPage > totalPages) currentPage = totalPages;

    const pageFiles = getPaginatedFiles(visibleFiles);

    if (currentView === 'list') {
        renderList(pageFiles, visibleFiles.length, totalPages);
    } else {
        renderGrid(pageFiles);
    }

    renderPagination(visibleFiles.length, totalPages);
}

/* ── Toast ────────────────────────────────────────────────── */
const Toast = {
    show(msg, type, duration) {
        const existing = document.querySelector('.wix-toast');
        if (existing) existing.remove();
        const colors = { success: '#065f46', error: '#dc2626', warning: '#b45309', info: '#1e40af' };
        const el = document.createElement('div');
        el.className = 'wix-toast';
        el.style.cssText = `position:fixed;top:20px;right:20px;z-index:99999;background:${colors[type] || '#1e40af'};color:#fff;padding:12px 20px;border-radius:8px;font-size:14px;font-family:'Manrope',sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.15);animation:toastIn .3s ease;max-width:400px;`;
        el.innerHTML = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), duration || 4000);
    },
    success(msg) { this.show(msg, 'success'); },
    error(msg) { this.show(msg, 'error'); },
    warning(msg) { this.show(msg, 'warning'); },
    info(msg) { this.show(msg, 'info'); }
};

async function requireCleanupMutation(target) {
    try {
        const fileIds = [...new Set((Array.isArray(target) ? target : [target])
            .map(item => String(item?.id || item || '').trim()).filter(Boolean))];
        return await requireCleanupCredit({ fileIds });
    } catch (error) {
        Toast.warning(error.message);
        return false;
    }
}

/* ── Init ─────────────────────────────────────────────────── */
let _mounted = false;
let _mountPromise = null;

export async function mount() {
    if (_mounted) return;
    _mounted = true;
    _mountPromise = (async () => {
        initProfile().catch(error => console.warn('[mydrive] profile refresh failed', { code: error?.code || 'UNKNOWN' }));
        try {
        await getAuthTokenSilently();
    } catch (_) {
        // Not authenticated — show empty state
        document.getElementById('mydrive-empty').style.display = 'block';
        return;
    }

    previewController = new PreviewController({
        panel: document.getElementById('mdrv-filePreview'),
        overlay: document.getElementById('mdrv-previewOverlay'),
        area: document.getElementById('mdrv-previewArea'),
        content: document.getElementById('mdrv-previewContent'),
        fallbackIcon: document.getElementById('mdrv-previewHeroIcon'),
        fallbackName: document.getElementById('mdrv-previewHeroName'),
        fallbackBadge: document.getElementById('mdrv-previewHeroBadge')
    });

    /* ── Back Button ──────────────────────────────────── */
    document.getElementById('btnMyDriveBack').addEventListener('click', () => history.back());

    /* ── Folder Header ────────────────────────────────── */
    document.getElementById('mydrive-folder-header')?.addEventListener('click', async event => {
        const action = event.target.closest('[data-folder-header-action]')?.dataset.folderHeaderAction;
        if (!action) return;
        event.preventDefault();
        const folder = getCurrentFolderFile();
        if (!folder) return;
        if (action === 'more') {
            const menu = document.getElementById('mydrive-folder-header-menu');
            const button = document.getElementById('mydrive-folder-header-more');
            const open = menu?.hidden;
            if (menu) menu.hidden = !open;
            if (button) button.setAttribute('aria-expanded', String(Boolean(open)));
            return;
        }
        if (action === 'retry-permissions') {
            folderHeaderPermissions.delete(folder.id);
            renderFolderHeader();
            return;
        }
        closeFolderHeaderMenu();
        if (isFolderHeaderActionInFlight) return;
        isFolderHeaderActionInFlight = true;
        try {
            if (action === 'manage') await openFolderPermissionManager(folder);
            else if (action === 'stop-sharing') await openFolderPermissionManager(folder, { revokeAllOnOpen: true });
            else if (action === 'open-drive' && folder.webViewLink) window.open(folder.webViewLink, '_blank');
            else if (action === 'transfer') await transferFolderOwnership(folder);
            else if (action === 'request') await requestFolderOwnership(folder);
            else if (action === 'trash') await trashFolder(folder);
        } catch (error) {
            console.error('Folder Header action error:', error);
            Toast.error('Lỗi: ' + (error.message || 'Không thể thực hiện thao tác.'));
        } finally {
            isFolderHeaderActionInFlight = false;
        }
    });

    /* ── View Toggle ───────────────────────────────────── */
    document.getElementById('btnListView').onclick = () => {
        currentView = 'list';
        updateViewButtons();
        renderCurrentView();
    };
    document.getElementById('btnGridView').onclick = () => {
        currentView = 'grid';
        updateViewButtons();
        renderCurrentView();
    };

    bindMyDriveSort();

    const fileTypeFilter = document.getElementById('mydrive-file-type-filter');
    populateFileTypeFilter(fileTypeFilter);
    fileTypeFilter?.addEventListener('change', event => {
        myDriveFileType = event.target.value;
        currentPage = 1;
        clearMyDriveSelection();
        renderCurrentView();
    });

    /* ── Search ─────────────────────────────────────────── */
    document.getElementById('searchInput').oninput = (e) => {
        searchKeyword = e.target.value.toLowerCase();
        currentPage = 1;
        clearMyDriveSelection();
        renderCurrentView();
    };

    /* ── Preview Panel Events ───────────────────────────── */
    document.getElementById('mydrive-tbody').addEventListener('click', (e) => {
        if (e.target.closest('.action-links-5') || e.target.closest('.td-shared') || e.target.closest('.wix-chk-row') || e.target.closest('input[type="checkbox"]')) return;
        const row = e.target.closest('tr');
        if (!row) return;
        const fileId = row.dataset.fileId;
        if (!fileId) return;
        const file = ownedFiles.find(f => f.id === fileId);
        if (file) openPreview(file);
    });
    document.getElementById('mydrive-tbody').addEventListener('pointerover', (e) => {
        const row = e.target.closest('tr[data-file-id]');
        if (!row || row.contains(e.relatedTarget)) return;
        const file = ownedFiles.find(item => item.id === row.dataset.fileId);
        if (file) previewController?.schedulePrefetch(file);
    });
    document.getElementById('mydrive-tbody').addEventListener('pointerout', (e) => {
        const row = e.target.closest('tr[data-file-id]');
        if (row && !row.contains(e.relatedTarget)) previewController?.cancelPrefetch();
    });

    document.getElementById('mydrive-tbody').addEventListener('change', (e) => {
        const checkbox = e.target.closest('.wix-chk-row');
        if (!checkbox) return;
        if (checkbox.checked) selectedFileIds.add(checkbox.dataset.id);
        else selectedFileIds.delete(checkbox.dataset.id);
        const checks = [...document.querySelectorAll('#mydrive-tbody .wix-chk-row')];
        const selectAll = document.getElementById('mydrive-chk-all');
        if (selectAll) selectAll.checked = checks.length > 0 && checks.every(item => item.checked);
        updateBulkSelectionBar();
    });

    document.getElementById('mydrive-bulk-btn-deselect')?.addEventListener('click', clearMyDriveSelection);
    document.getElementById('mydrive-bulk-btn-download')?.addEventListener('click', handleBulkDownload);
    document.getElementById('mydrive-bulk-btn-revoke')?.addEventListener('click', handleBulkRevoke);
    document.getElementById('mydrive-bulk-btn-transfer')?.addEventListener('click', handleBulkTransferOwnership);
    document.getElementById('mydrive-bulk-btn-delete')?.addEventListener('click', async () => {
        if (isBulkDeleteInFlight) return;
        isBulkDeleteInFlight = true;
        const button = document.getElementById('mydrive-bulk-btn-delete');
        try {
            const selected = getFilteredFiles().filter(file => selectedFileIds.has(file.id) && !file.trashed);
            if (!await openActionConfirm(`Chuyển ${selected.length} tệp đã chọn vào thùng rác?`)) return;
            const operation = await requireCleanupMutation(selected);
            if (!selected.length || !operation) return;
            if (button) button.disabled = true;
            const actions = [];
            let failed = 0;
            for (const file of selected) {
                if (!operation.allowedFileIds.includes(file.id)) { failed++; continue; }
                try {
                    await deleteFile(file.id);
                    file.trashed = true;
                    actions.push({ type: 'delete', fileId: file.id, fileName: file.name, fileSize: file.size, actionLabel: 'Xóa file' });
                } catch (_) { failed++; }
            }
            if (actions.length) await logActionsBulk(actions, operation);
            else await failReservedCleanup(operation);
            refreshMyDriveAfterMutation();
            if (actions.length) Toast.success(`Đã chuyển ${actions.length} tệp vào thùng rác.`);
            if (failed) Toast.error(`Không thể chuyển ${failed} tệp vào thùng rác.`);
        } finally {
            if (button) button.disabled = false;
            isBulkDeleteInFlight = false;
        }
    });

    document.getElementById('fileGrid').addEventListener('click', (e) => {
        const card = e.target.closest('.grid-card');
        if (!card) return;
        const fileId = card.dataset.fileId;
        if (!fileId) return;
        const file = ownedFiles.find(f => f.id === fileId);
        if (file) openPreview(file);
    });

    /* ── Preview Panel Controls ─────────────────────────── */
    document.getElementById('mdrv-previewClose').addEventListener('click', closePreview);
    document.getElementById('mdrv-previewOverlay').addEventListener('click', closePreview);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isPreviewOpen) closePreview();
    });

    /* ── Preview Action Buttons ─────────────────────────── */
    document.getElementById('mdrv-btnOpenDrive').addEventListener('click', () => {
        if (selectedFile?.webViewLink) {
            window.open(selectedFile.webViewLink, '_blank');
        }
    });

    document.getElementById('mdrv-btnDeleteFile').addEventListener('click', async () => {
        if (!selectedFile?.id) return;
        if (!await openActionConfirm('Chuyển tệp này vào thùng rác?')) return;
        const operation = await requireCleanupMutation(selectedFile.id);
        if (!operation) return;
        try {
            await deleteFile(selectedFile.id);
            const localFile = allFiles.find(file => file.id === selectedFile.id);
            if (localFile) localFile.trashed = true;
            await logAction({ type: 'delete', fileId: selectedFile.id, fileName: selectedFile.name, fileSize: selectedFile.size, actionLabel: 'Xóa file' }, operation);
            closePreview();
            refreshMyDriveAfterMutation();
        } catch (err) {
            await failReservedCleanup(operation);
            alert('Không thể xóa tệp: ' + err.message);
        }
    });

    /* ── Action Button Delegation ─────────────────────────── */
    document.getElementById('mydrive-tbody').addEventListener('click', async (e) => {
        const sharedCell = e.target.closest('.td-shared[data-file-id]');
        if (sharedCell) {
            e.stopPropagation();
            const fileId = sharedCell.dataset.fileId;
            const file = allFiles.find(item => item.id === fileId);
            if (!file) return;
            await openSharePermissionsModal({
                file,
                getFilePermissions,
                getFileOwner,
                getFileMetadata,
                removeCachedPermission,
                revokePermission,
                requireCleanupMutation,
                toast: Toast,
                canManageSharing: candidate => canCurrentAccountManageSharing(candidate || allFiles.find(item => item.id === fileId)),
                onPermissionRevoked: async (permission, operation) => {
                    file.permissions = (file.permissions || []).filter(item => item.id !== permission?.id);
                    file.shared = file.permissions.some(item => item.role !== 'owner');
                    await logAction({ type: 'revoke', fileId, fileName: file.name, actionLabel: 'Thu hồi quyền' }, operation);
                    refreshMyDriveAfterMutation();
                },
                onPermissionsRevoked: async (permissions, operation) => {
                    const revokedIds = new Set(permissions.map(permission => permission.id));
                    file.permissions = (file.permissions || []).filter(item => !revokedIds.has(item.id));
                    file.shared = file.permissions.some(item => item.role !== 'owner');
                    await logAction({ type: 'revoke', fileId, fileName: file.name, actionLabel: 'Thu hồi quyền' }, operation);
                    refreshMyDriveAfterMutation();
                },
                onInheritedPermissionRevoked: async ({ parent, parentPermission, childPermission, operation }) => {
                    const cachedParent = allFiles.find(item => item.id === parent.id);
                    if (cachedParent) {
                        cachedParent.permissions = (cachedParent.permissions || []).filter(item => item.id !== parentPermission.id);
                        cachedParent.shared = cachedParent.permissions.some(item => item.role !== 'owner');
                    }
                    file.permissions = (file.permissions || []).filter(item => item.id !== childPermission.id);
                    file.shared = file.permissions.some(item => item.role !== 'owner');
                    await logAction({ type: 'revoke', fileId: parent.id, fileName: parent.name, actionLabel: 'Thu hồi quyền thư mục cha' }, operation);
                    refreshMyDriveAfterMutation();
                }
            });
            return;
        }
        const btn = e.target.closest('[data-action]');
        if (!btn || btn.disabled || btn.classList.contains('action-btn-5--disabled')) return;
        e.stopPropagation();
        const action = btn.dataset.action;
        const fileId = btn.dataset.fileId;
        const fileName = btn.dataset.fileName;
        if (!fileId) return;
        let operation = null;
        const origHTML = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        try {
            if (action === 'transfer') {
                const file = ownedFiles.find(f => f.id === fileId);
                if (!file) { Toast.error('Không tìm thấy file.'); btn.disabled = false; btn.innerHTML = origHTML; return; }
                if (file.ownedByMe !== true || (file.capabilities && file.capabilities.canShare === false)) {
                    Toast.error('Bạn không có quyền chuyển quyền sở hữu tệp này.');
                    btn.disabled = false; btn.innerHTML = origHTML; return;
                }
                const email = await openOwnershipTransferModal([file]);
                if (!email) { btn.disabled = false; btn.innerHTML = origHTML; return; }
                if (!EMAIL_RE.test(email.trim())) {
                    Toast.warning('Email không hợp lệ');
                    btn.disabled = false; btn.innerHTML = origHTML; return;
                }
                operation = await requireCleanupMutation(fileId);
                if (!operation) { btn.disabled = false; btn.innerHTML = origHTML; return; }
                const result = await transferOwnership(file, email);
                if (result.status === 'completed') {
                    file.ownedByMe = false;
                    file.owners = [{ emailAddress: result.email, me: false }];
                    const targetPermission = (file.permissions || []).find(permission => permission.emailAddress?.trim().toLowerCase() === result.email);
                    if (targetPermission) targetPermission.role = 'owner';
                    await logAction({ type: 'transfer_ownership', fileId, fileName, fileSize: file.size, actionLabel: 'Chuyển quyền sở hữu' }, operation);
                    Toast.success('Đã chuyển quyền sở hữu thành công!');
                    refreshMyDriveAfterMutation();
                } else if (result.status === 'pending') {
                    if (!result.alreadyPending) await logAction({ type: 'transfer_ownership_pending', fileId, fileName, fileSize: file.size, actionLabel: 'Gửi lời mời chuyển quyền sở hữu' }, operation);
                    Toast.info(result.alreadyPending
                        ? 'Lời mời chuyển quyền sở hữu đã được gửi trước đó. Người nhận cần chấp nhận quyền sở hữu trong email để hoàn tất.'
                        : 'Đã gửi lời mời chuyển quyền sở hữu tới email này. Người nhận cần mở email và chấp nhận quyền sở hữu trước khi hoàn tất.');
                } else if (result.status === 'already_owner') {
                    await failReservedCleanup(operation);
                    Toast.info('Email này đã là chủ sở hữu của tệp.');
                }
            } else if (action === 'request') {
                const file = allFiles.find(item => item.id === fileId);
                if (!file) throw new Error('Không tìm thấy file');
                await openOwnershipRequestModal({
                    files: [file], getFileOwner, submitOwnershipRequest, ownershipRequestMessage, toast: Toast
                });
            } else if (action === 'stop-sharing') {
                const file = allFiles.find(item => item.id === fileId);
                if (!file) throw new Error('Không tìm thấy file');
                if (!canCurrentAccountManageSharing(file)) {
                    Toast.error('Bạn không có quyền ngừng chia sẻ tệp này.');
                    btn.disabled = false; btn.innerHTML = origHTML; return;
                }
                await openSharePermissionsModal({
                    file, getFilePermissions, getFileMetadata, removeCachedPermission, revokePermission, requireCleanupMutation, toast: Toast,
                    canManageSharing: candidate => canCurrentAccountManageSharing(candidate || allFiles.find(item => item.id === fileId)),
                    onPermissionRevoked: async (permission, operation) => {
                        file.permissions = (file.permissions || []).filter(item => item.id !== permission?.id);
                        file.shared = file.permissions.some(item => item.role !== 'owner');
                        await logAction({ type: 'revoke', fileId, fileName, actionLabel: 'Thu hồi quyền' }, operation);
                        refreshMyDriveAfterMutation();
                    },
                    onPermissionsRevoked: async (permissions, operation) => {
                        const revokedIds = new Set(permissions.map(permission => permission.id));
                        file.permissions = (file.permissions || []).filter(item => !revokedIds.has(item.id));
                        file.shared = file.permissions.some(item => item.role !== 'owner');
                        await logAction({ type: 'revoke', fileId, fileName, actionLabel: 'Thu hồi quyền' }, operation);
                        refreshMyDriveAfterMutation();
                    },
                    onInheritedPermissionRevoked: async ({ parent, parentPermission, childPermission, operation }) => {
                        const cachedParent = allFiles.find(item => item.id === parent.id);
                        if (cachedParent) {
                            cachedParent.permissions = (cachedParent.permissions || []).filter(item => item.id !== parentPermission.id);
                            cachedParent.shared = cachedParent.permissions.some(item => item.role !== 'owner');
                        }
                        file.permissions = (file.permissions || []).filter(item => item.id !== childPermission.id);
                        file.shared = file.permissions.some(item => item.role !== 'owner');
                        await logAction({ type: 'revoke', fileId: parent.id, fileName: parent.name, actionLabel: 'Thu hồi quyền thư mục cha' }, operation);
                        refreshMyDriveAfterMutation();
                    }
                });
            } else if (action === 'compare') {
                const file = allFiles.find(item => item.id === fileId);
                if (!canCurrentAccountManageSharing(file)) { Toast.error('Bạn không có quyền xử lý bản trùng của tệp này.'); btn.disabled = false; btn.innerHTML = origHTML; return; }
                if (!file.md5Checksum) { Toast.info('Không có thông tin mã băm để so sánh.'); btn.disabled = false; btn.innerHTML = origHTML; return; }
                openDuplicateActionModal({
                    getFiles: () => allFiles,
                    sourceFileId: fileId,
                    fileName,
                    formatBytes,
                    formatDate,
                    escapeHtml,
                    renderIcon: item => `<i class="${getFileIcon(item.mimeType)} file-icon"></i>`,
                    confirmAction: openActionConfirm,
                    requireCleanupMutation,
                    deleteFile,
                    logAction,
                    canManageDuplicate: canCurrentAccountManageSharing,
                    onMutationSuccess: () => refreshMyDriveAfterMutation(),
                    toast: Toast
                });
            } else if (action === 'delete') {
                if (!await openActionConfirm(`Chuyển "${fileName}" vào thùng rác?\nBạn có thể khôi phục bất cứ lúc nào từ Google Drive.`)) { btn.disabled = false; btn.innerHTML = origHTML; return; }
                operation = await requireCleanupMutation(fileId);
                if (!operation) { btn.disabled = false; btn.innerHTML = origHTML; return; }
                await deleteFile(fileId);
                const localFile = allFiles.find(file => file.id === fileId);
                if (localFile) localFile.trashed = true;
                await logAction({ type: 'delete', fileId, fileName, fileSize: ownedFiles.find(f => f.id === fileId)?.size, actionLabel: 'Xóa file' }, operation);
                Toast.success(`Đã chuyển "${fileName}" vào thùng rác.`);
                refreshMyDriveAfterMutation();
            }
        } catch (err) {
            if (operation) await failReservedCleanup(operation);
            console.error('Action error:', err);
            const msg = (err && err.message) || '';
            if (action === 'transfer') {
                if (isConsentRequiredError(err)) {
                    Toast.info('Google Drive yêu cầu người nhận xác nhận quyền sở hữu trước. Hãy yêu cầu người nhận kiểm tra email và chấp nhận lời mời.');
                } else if (err.code === 'not_owner' || err.code === 'cannot_share') {
                    Toast.error('Bạn không có quyền chuyển quyền sở hữu tệp này.');
                } else if (err.code === 'shared_drive') {
                    Toast.error('File nằm trong Shared Drive, không hỗ trợ chuyển quyền sở hữu.');
                } else if (err.code === 'invalid_email') {
                    Toast.warning('Email không hợp lệ');
                } else if (err.status === 403 || err.reason === 'insufficientFilePermissions' ||
                           /insufficient.*permission|domain policy|allowed to transfer|outside your domain|same organization/i.test(msg)) {
                    Toast.error('Không thể chuyển quyền sở hữu cho email này do chính sách Google Drive hoặc giới hạn domain.');
                } else {
                    Toast.error('Lỗi: ' + msg);
                }
            } else {
                Toast.error('Lỗi: ' + msg);
            }
        }
        btn.disabled = false;
        btn.innerHTML = origHTML;
    });

    /* ── Stat Card Clicks ─────────────────────────────── */
    // Không điều hướng sang Dashboard — chỉ lọc danh sách file ngay trong My Drive
    document.querySelectorAll('.my-drive-card--clickable').forEach(card => {
        card.addEventListener('click', () => {
            const filter = card.dataset.mydriveFilter;
            if (filter !== 'public' && filter !== 'dupes' && filter !== 'empty') return;

            // Click lại card đang active → reset bộ lọc (về toàn bộ My Drive)
            if (activeCardFilter === filter) {
                activeCardFilter = null;
            } else {
                activeCardFilter = filter;
            }

            // Reset về root My Drive để hiển thị toàn Drive theo đúng logic card
            document.querySelectorAll('.tree-row.active').forEach(el => el.classList.remove('active'));
            const rootRow = document.querySelector('.tree-item:first-child .tree-row');
            if (rootRow) rootRow.classList.add('active');
            setMyDriveFolder(null);
            clearMyDriveSelection();

            // Cập nhật trạng thái active trên card (không đổi giao diện chính)
            document.querySelectorAll('.my-drive-card--clickable').forEach(c => c.classList.remove('my-drive-card--filtered'));
            if (activeCardFilter) card.classList.add('my-drive-card--filtered');

            refreshSelectedFolderView();
        });
    });

    // Auto-load on init
    await loadMyDriveData();

    })();
    await _mountPromise;
}

export async function onShow() {
    // Router may reveal the styled fragment while first data hydration is
    // still running. Reuse that in-flight mount instead of starting a second
    // Drive load on a rapid leave/return.
    if (_mountPromise) await _mountPromise;
    const savedSort = await getFolderSortMode();
    if (savedSort !== folderSortMode) {
        folderSortMode = savedSort;
        renderTree(folderTree);
    }
    const activeAccountId = await getActiveAccountId().catch(() => null);
    if (myDriveAccountId !== activeAccountId) await loadMyDriveData();
}
export async function onHide() { closePreview(); closeFolderHeaderMenu(); folderHeaderRequestId++; }

// Standalone (mở mydrive.html trực tiếp, không qua shell) → tự khởi động
if (!window.WistorixRouter) {
    document.addEventListener('DOMContentLoaded', () => { mount(); });
}
