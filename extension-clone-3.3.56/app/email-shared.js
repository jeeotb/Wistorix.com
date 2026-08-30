import { scanDrive, loadFilesFromCache, revokePermissionSafe, revokePermission, getFilePermissions, getFileMetadata, removeCachedPermission, canCurrentAccountManageSharing } from './modules/drive.js';
import { getAuthTokenSilently } from './modules/auth.js';
import { formatBytes } from './modules/utils.js';
import { initProfile } from './modules/profile.js';
import { getActiveAccount } from './modules/account-manager.js';
import { collectFolderTreeItemIds } from './modules/folder-tree.js';
import { failReservedCleanup, logAction, logActionsBulk, requireCleanupCredit } from './modules/actions.js';
import { filterEmailGroups } from './modules/email-search.js';
import { getEmailDomain, getEmailSharedDomainMode, getEmailSharedExternalSummary } from './modules/email-shared-domain.js';
import { handleInheritedPermissionRevoke } from './modules/action-modals.js';
import { resolveInheritedPermissionSource } from './modules/inherited-permission-source.js';

const AppState = window.WistorixAppState;

let allFiles = [];
let emailGroups = {};
let anyoneFiles = [];
let currentModalEmail = null;
let currentModalGroup = null;
let userDomain = '';
let activeDomainMode = getEmailSharedDomainMode(null);
let folderChoices = [];
let emailSearchQuery = '';
let renderedEmailData = { emailList: [] };
let emailSearchAccount = '';

const fmt = (n) => new Intl.NumberFormat('en-US').format(Number(n) || 0);

const Toast = {
  show(msg, type, duration) {
    const existing = document.querySelector('.wix-toast');
    if (existing) existing.remove();
    const colors = { success: '#065f46', error: '#dc2626', warning: '#b45309', info: '#1e40af' };
    const bg = colors[type] || colors.info;
    const el = document.createElement('div');
    el.className = 'wix-toast';
    el.style.background = bg;
    el.innerHTML = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.remove(); }, duration || 4000);
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

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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

function getFileIconColor(mimeType) {
  if (!mimeType) return '#6b7280';
  if (mimeType.includes('pdf')) return '#ef4444';
  if (mimeType.includes('zip') || mimeType.includes('rar')) return '#f59e0b';
  if (mimeType.includes('folder')) return '#3b82f6';
  if (mimeType.includes('image')) return '#10b981';
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return '#059669';
  if (mimeType.includes('document') || mimeType.includes('word')) return '#2563eb';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '#f97316';
  if (mimeType.includes('video')) return '#ef4444';
  return '#6b7280';
}

function isExternal(email) {
  const domain = getEmailDomain(email);
  return !domain || !userDomain || domain !== userDomain;
}

function getExternalSummaryMetric(groups, corporateCount) {
  return getEmailSharedExternalSummary(groups, corporateCount, activeDomainMode);
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(s => s[0]).join('').toUpperCase().slice(0, 2);
}

function isPermissionInherited(permission) {
  if (permission.inherited === true || permission.inherited === 'true') return true;
  if (permission.permissionDetails && Array.isArray(permission.permissionDetails)) {
    return permission.permissionDetails.some(d => d.inherited === true || d.inheritedFrom);
  }
  if (permission.inheritedFrom) return true;
  return false;
}

function accountKey(account) {
  return String(account?.id || account?.email || '').trim().toLowerCase();
}

async function accountIsCurrent(key) {
  return Boolean(key) && accountKey(await getActiveAccount()) === key;
}

function processFiles(files) {
  emailGroups = {};
  anyoneFiles = [];

  const owned = files.filter(f => canCurrentAccountManageSharing(f) && !f.trashed);

  const anyonePerms = [];

  for (const file of owned) {
    const perms = file.permissions || [];
    for (const p of perms) {
      if (p.type === 'anyone') {
        anyonePerms.push({
          file,
          permission: p,
          inherited: isPermissionInherited(p)
        });
        continue;
      }
      if (p.type === 'domain') {
        anyonePerms.push({
          file,
          permission: p,
          inherited: isPermissionInherited(p),
          isDomain: true
        });
        continue;
      }
      if (p.type !== 'user' && p.type !== 'group') continue;
      if (p.role === 'owner') continue;

      const email = p.emailAddress;
      if (!email) continue;

      if (!emailGroups[email]) {
        emailGroups[email] = {
          email,
          displayName: p.displayName || email.split('@')[0] || email,
          isExternal: isExternal(email),
          isAnyone: false,
          files: [],
          stats: { total: 0, view: 0, edit: 0 }
        };
      }

      emailGroups[email].files.push({ file, permission: p, inherited: isPermissionInherited(p) });
      emailGroups[email].stats.total++;
      if (p.role === 'reader' || p.role === 'commenter') emailGroups[email].stats.view++;
      else if (p.role === 'writer' || p.role === 'fileOrganizer') emailGroups[email].stats.edit++;
    }
  }

  if (anyonePerms.length > 0) {
    const anyoneGroup = {
      email: 'anyone-with-link',
      displayName: 'Công khai qua liên kết',
      isExternal: true,
      isAnyone: true,
      files: anyonePerms,
      stats: { total: 0, view: 0, edit: 0 }
    };
    for (const item of anyonePerms) {
      anyoneGroup.stats.total++;
      if (item.permission.role === 'reader' || item.permission.role === 'commenter') anyoneGroup.stats.view++;
      else if (item.permission.role === 'writer' || item.permission.role === 'fileOrganizer') anyoneGroup.stats.edit++;
    }
    emailGroups['anyone-with-link'] = anyoneGroup;
  }

  const sorted = Object.values(emailGroups).sort((a, b) => {
    if (a.isAnyone !== b.isAnyone) return a.isAnyone ? -1 : 1;
    if (a.isExternal !== b.isExternal) return a.isExternal ? -1 : 1;
    return b.stats.total - a.stats.total;
  });

  let totalExternal = sorted.filter(e => e.isExternal && !e.isAnyone).length;
  if (anyonePerms.length > 0) totalExternal += 1;
  const externalSummary = getExternalSummaryMetric(sorted, totalExternal);

  return {
    emailList: sorted,
    anyoneFiles: anyonePerms,
    totalEmails: sorted.length,
    totalExternal,
    externalSummary,
    totalShares: sorted.reduce((s, e) => s + e.stats.total, 0)
  };
}

function renderAll(data) {
  renderedEmailData = data;
  renderHero(data);
  renderStats(data);
  renderEmailList(filterEmailGroups(data.emailList, emailSearchQuery));
}

function applyEmailSearch(query) {
  emailSearchQuery = String(query || '');
  renderEmailList(filterEmailGroups(renderedEmailData.emailList, emailSearchQuery));
}

function renderHero(data) {
  const el = document.getElementById('shared-hero-count');
  const sub = document.getElementById('shared-hero-sub');
  if (el) el.textContent = fmt(data.totalEmails);
  if (sub) sub.textContent = `${fmt(data.totalEmails)} email (${fmt(data.externalSummary.count)} ${data.externalSummary.phrase}) đang được chia sẻ ${fmt(data.totalShares)} tệp. Rà soát định kỳ để thu hồi quyền không còn cần thiết.`;
}

function renderStats(data) {
  const el1 = document.getElementById('stat-emails');
  const el2 = document.getElementById('stat-external');
  const el3 = document.getElementById('stat-shares');
  const externalLabel = document.getElementById('stat-external-label');
  if (el1) el1.textContent = fmt(data.totalEmails);
  if (el2) el2.textContent = fmt(data.externalSummary.count);
  if (el3) el3.textContent = fmt(data.totalShares);
  if (externalLabel) externalLabel.textContent = data.externalSummary.label;
}

function renderEmailList(emailList) {
  const container = document.getElementById('shared-email-list');
  const empty = document.getElementById('shared-empty');
  if (!container) return;

  if (emailList.length === 0) {
    container.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  container.innerHTML = emailList.map(g => buildEmailItem(g)).join('');

  container.querySelectorAll('.btn-view').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const email = btn.dataset.email;
      const group = emailGroups[email];
      if (group) openFileSidebar(group, email);
    });
  });

  container.querySelectorAll('.btn-revoke').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const email = btn.dataset.email;
      const group = emailGroups[email];
      if (!group) return;
      if (!confirm(`Thu hồi toàn bộ quyền của ${email === 'anyone-with-link' ? 'tệp công khai' : email}?`)) return;
      const operation = await requireCleanupMutation(group.files.map(({ file }) => file.id));
      if (!operation) return;
      btn.disabled = true;
      const result = await revokeAllForEmail(email, (processed, total) => {
        btn.textContent = `Đang thu hồi ${processed}/${total} — ${Math.round(processed / total * 100)}%`;
      }, operation);
      btn.disabled = false;
      btn.textContent = 'Thu hồi toàn bộ';
      if (result) showRevokeSummary(result);
    });
  });
}

function buildEmailItem(g) {
  const initials = g.isAnyone ? '' : getInitials(g.displayName);
  const badges = [];
  if (g.stats.edit > 0) badges.push(`<span class="badge edit">Chỉnh sửa ${g.stats.edit}</span>`);
  if (g.stats.view > 0) badges.push(`<span class="badge view">Xem ${g.stats.view}</span>`);
  if (g.isExternal) badges.push(`<span class="badge external">ngoài tổ chức</span>`);

  let avatarHtml;
  if (g.isAnyone) {
    avatarHtml = `<div class="avatar avatar--globe"><i class="fas fa-globe-asia"></i></div>`;
  } else {
    avatarHtml = `<div class="avatar">${escapeHtml(initials)}</div>`;
  }

  const displayName = g.isAnyone ? 'anyone-with-link' : escapeHtml(g.email);

  return `<div class="email-card" data-email="${escapeHtml(g.email)}">
    <div class="email-left">
      ${avatarHtml}
      <div class="email-info">
        <div class="email-name">${displayName}</div>
        <div class="email-meta">
          <span>${fmt(g.stats.total)} tệp</span>
          ${badges.join('')}
        </div>
      </div>
    </div>
    <div class="email-actions">
      <button class="btn-view" data-email="${escapeHtml(g.email)}"><i class="fas fa-eye"></i> Xem tệp</button>
      <button class="btn-revoke" data-email="${escapeHtml(g.email)}"><i class="fas fa-ban"></i> Thu hồi toàn bộ</button>
    </div>
  </div>`;
}

function openFileSidebar(group, email) {
  currentModalEmail = email;
  currentModalGroup = group;
  const title = email === 'anyone-with-link' ? 'Tệp công khai qua liên kết' : email;
  document.getElementById('sidebarEmailTitle').textContent = title;
  renderFileList(group.files);
  document.getElementById('fileSidebar').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function getFileTypeLabel(mimeType) {
  if (!mimeType) return 'Tệp';
  if (mimeType.includes('folder')) return 'Thư mục';
  if (mimeType.includes('pdf')) return 'PDF';
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'Bảng tính';
  if (mimeType.includes('document') || mimeType.includes('word')) return 'Tài liệu';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'Trình chiếu';
  if (mimeType.includes('image')) return 'Hình ảnh';
  if (mimeType.includes('video')) return 'Video';
  if (mimeType.includes('zip') || mimeType.includes('rar')) return 'Nén';
  if (mimeType.includes('text')) return 'Văn bản';
  return 'Tệp';
}

function renderFileList(files) {
  const container = document.getElementById('sidebarFileList');
  container.innerHTML = files.map(({ file, permission, inherited }) => {
    const icon = getFileIcon(file.mimeType);
    const iconColor = getFileIconColor(file.mimeType);
    const size = parseInt(file.size) || 0;
    const roleLabel = permission.role === 'writer' || permission.role === 'fileOrganizer' ? 'Chỉnh sửa' : 'Xem';
    const pathParts = (file.parents || []);
    const pathStr = pathParts.length > 0 ? `› ${pathParts.slice(0, 2).join(' › ')}` : '';
    const sizeStr = size > 0 ? formatBytes(size) : getFileTypeLabel(file.mimeType);
    const isInherited = inherited;
    return `<div class="file-item">
      <input type="checkbox" class="file-checkbox" data-fileid="${escapeHtml(file.id)}" data-permid="${escapeHtml(permission.id)}" data-inherited="${isInherited ? '1' : '0'}">
      <div class="file-icon-box" style="color:${iconColor};">
        <i class="${icon}"></i>
      </div>
      <div class="file-info">
        <div class="file-name" title="${escapeHtml(file.name || 'Unnamed')}">${escapeHtml(file.name || 'Unnamed')}</div>
        <div class="file-meta">
          ${pathStr ? `<span>${escapeHtml(pathStr)}</span> <span>·</span>` : ''}
          <span>${escapeHtml(sizeStr)}</span>
        </div>
      </div>
      <div class="file-role-badge ${roleLabel === 'Chỉnh sửa' ? 'badge--edit' : 'badge--view'}">${roleLabel}</div>
      <div class="file-actions">
        <button class="file-action-btn file-action-btn--danger revoke-single" data-fileid="${escapeHtml(file.id)}" data-permid="${escapeHtml(permission.id)}" data-inherited="${isInherited ? '1' : '0'}">
          <i class="fas fa-ban"></i> Thu hồi
        </button>
      </div>
    </div>`;
  }).join('');

  document.getElementById('sidebarSelectedCount').textContent = '0 đã chọn';
  document.getElementById('sidebarRevokeSelected').textContent = 'Thu hồi 0 tệp';
  document.getElementById('sidebarCheckAll').checked = false;

  container.querySelectorAll('.file-checkbox').forEach(cb => {
    cb.addEventListener('change', updateSelectedCount);
  });

  document.getElementById('sidebarCheckAll').addEventListener('change', function() {
    container.querySelectorAll('.file-checkbox').forEach(cb => cb.checked = this.checked);
    updateSelectedCount();
  });

  container.querySelectorAll('.revoke-single').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fileId = btn.dataset.fileid;
      const permId = btn.dataset.permid;
      const inherited = btn.dataset.inherited === '1';
      const fileItem = btn.closest('.file-item');
      const fileName = fileItem ? fileItem.querySelector('.file-name')?.textContent || 'tệp' : 'tệp';

      if (inherited) {
        const target = currentModalGroup?.files?.find(item => item.file.id === fileId && item.permission.id === permId);
        if (target) await revokeInheritedPermissionFromSidebar({ file: target.file, permission: target.permission, fileName });
        else Toast.warning(inheritedParentRequiredMessage());
        return;
      }

      if (!confirm(`Thu hồi quyền của "${fileName}"?`)) return;
      const operation = await requireCleanupMutation(fileId);
      if (!operation) return;
      const mutationAccount = accountKey(await getActiveAccount());
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      const result = await revokePermissionSafe(fileId, permId, { inherited: false });
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-ban"></i> Thu hồi';
      if (result.ok) {
        await logAction({ type: 'revoke', fileId, fileName, actionLabel: 'Thu hồi quyền' }, operation);
        if (!await accountIsCurrent(mutationAccount)) {
          Toast.info('Tài khoản đã thay đổi. Dữ liệu chia sẻ sẽ được tải lại cho tài khoản hiện tại.');
          return;
        }
        Toast.success('Đã thu hồi quyền thành công.');
        patchLocalPermissionAfterSuccess(fileId, permId);
        rebuildGroupsFromCanonicalState();
        updateSelectedCount();
      } else if (result.skipped) {
        await failReservedCleanup(operation);
        Toast.warning(inheritedParentRequiredMessage());
        updateSelectedCount();
      } else {
        await failReservedCleanup(operation);
        Toast.error(result.message || 'Không thể thu hồi quyền.');
      }
    });
  });
}

function updateSelectedCount() {
  const checked = document.querySelectorAll('.file-checkbox:checked');
  const count = checked.length;
  document.getElementById('sidebarSelectedCount').textContent = `${count} đã chọn`;
  document.getElementById('sidebarRevokeSelected').textContent = `Thu hồi ${count} tệp`;
}

function patchLocalPermissionAfterSuccess(fileId, permissionId) {
  const file = allFiles.find(item => item.id === fileId);
  if (!file) return;
  const permissions = (file.permissions || []).filter(permission => permission.id !== permissionId);
  file.permissions = permissions;
  file.shared = permissions.some(permission => permission.role !== 'owner');
}

function rebuildGroupsFromCanonicalState() {
  const data = processFiles(allFiles);
  renderedEmailData = data;
  renderEmailList(filterEmailGroups(data.emailList, emailSearchQuery));
  renderHero(data);
  renderStats(data);
  if (currentModalEmail) {
    const nextGroup = emailGroups[currentModalEmail];
    currentModalGroup = nextGroup || null;
    if (nextGroup) renderFileList(nextGroup.files);
    else closeSidebar();
  }
}

function inheritedParentRequiredMessage(parentName = '') {
  return parentName
    ? `Quyền này được kế thừa từ thư mục “${parentName}”. Hãy thu hồi quyền chia sẻ của thư mục này để xóa quyền khỏi các tệp bên trong.`
    : 'Chưa thể thu hồi quyền này vì quyền được kế thừa từ thư mục cha. Bạn cần thu hồi quyền chia sẻ ở thư mục cha để quyền này biến mất hoàn toàn.';
}

async function revokeInheritedPermissionFromSidebar({ file, permission, fileName }) {
  let resolved;
  try {
    resolved = await resolveInheritedPermissionSource({ file, permission, files: allFiles, getFilePermissions });
  } catch (_) {
    Toast.warning(inheritedParentRequiredMessage());
    return { ok: false, skipped: true, reason: 'inherited_parent_unresolved' };
  }
  if (resolved?.status !== 'resolved') {
    Toast.warning(inheritedParentRequiredMessage());
    return { ok: false, skipped: true, reason: 'inherited_parent_unresolved' };
  }
  const mutationAccount = accountKey(await getActiveAccount());
  return handleInheritedPermissionRevoke({
    file,
    permission: resolved.permission,
    getFileMetadata,
    getFilePermissions,
    revokePermission,
    removeCachedPermission,
    requireCleanupMutation,
    canManageSharing: canCurrentAccountManageSharing,
    toast: Toast,
    onSuccess: async ({ parent, parentPermission, childPermission, operation }) => {
      await logAction({ type: 'revoke', fileId: parent.id, fileName: parent.name || fileName, actionLabel: 'Thu hồi quyền thư mục cha' }, operation);
      if (!await accountIsCurrent(mutationAccount)) {
        Toast.info('Tài khoản đã thay đổi. Dữ liệu chia sẻ sẽ được tải lại cho tài khoản hiện tại.');
        return;
      }
      patchLocalPermissionAfterSuccess(parent.id, parentPermission.id);
      patchLocalPermissionAfterSuccess(file.id, childPermission.id);
      rebuildGroupsFromCanonicalState();
    }
  });
}

function closeSidebar() {
  document.getElementById('fileSidebar').classList.remove('active');
  document.body.style.overflow = '';
  currentModalEmail = null;
  currentModalGroup = null;
}

function showRevokeSummary(result) {
  if (result?.accountChanged) {
    Toast.info('Tài khoản đã thay đổi. Dữ liệu chia sẻ sẽ được tải lại cho tài khoản hiện tại.');
    return;
  }
  const success = result.success || 0;
  const skipped = result.skipped || 0;
  const failed = result.failed || 0;
  const blocked = result.blocked || 0;
  const parts = [];
  if (success > 0) parts.push(`Đã thu hồi ${success} quyền`);
  if (skipped > 0) parts.push(`Còn ${skipped} quyền kế thừa chưa thể thu hồi trực tiếp. Hãy thu hồi quyền chia sẻ ở thư mục cha để quyền biến mất hoàn toàn`);
  if (failed > 0) parts.push(`${failed} quyền không thể thu hồi do thiếu quyền`);
  if (blocked > 0) parts.push(`${blocked} tệp mới vượt giới hạn dọn dẹp`);
  const msg = parts.join('. ') || 'Không có quyền nào được xử lý.';
  if (failed > 0 || skipped > 0 || blocked > 0) {
    Toast.warning(msg);
  } else {
    Toast.success(msg);
  }
}

async function revokeAllForEmail(email, onProgress, operation) {
  const group = emailGroups[email];
  if (!group) return null;
  const mutationAccount = accountKey(await getActiveAccount());

  const files = [...group.files];
  let result = { success: 0, skipped: 0, failed: 0, blocked: 0 };
  const loggedActions = [];
  let processed = 0;
  onProgress?.(processed, files.length);

  for (const { file, permission, inherited } of files) {
    if (!operation.allowedFileIds.includes(file.id)) { result.blocked++; continue; }
    const res = await revokePermissionSafe(file.id, permission.id, { inherited });
    if (res.ok) { result.success++; loggedActions.push({ type: 'revoke', fileId: file.id, permissionId: permission.id, fileName: file.name, fileSize: file.size, actionLabel: 'Thu hồi quyền' }); }
    else if (res.skipped) result.skipped++;
    else result.failed++;
    processed++;
    onProgress?.(processed, files.length);
  }
  if (loggedActions.length) await logActionsBulk(loggedActions, operation);
  else await failReservedCleanup(operation);
  if (!await accountIsCurrent(mutationAccount)) return { ...result, accountChanged: true };

  // revokePermissionSafe patches IndexedDB/AppState only after Drive DELETE
  // succeeds. Mirror those successes into this page's canonical file list,
  // then derive groups again. Skipped inherited permissions stay visible.
  for (const action of loggedActions) patchLocalPermissionAfterSuccess(action.fileId, action.permissionId);
  rebuildGroupsFromCanonicalState();

  return result;
}

async function loadSharedData() {
  try {
    const activeAccount = await getActiveAccount();
    const accountEmail = String(activeAccount?.email || '').trim().toLowerCase();
    if (emailSearchAccount && emailSearchAccount !== accountEmail) {
      emailSearchQuery = '';
      const searchInput = document.getElementById('shared-email-search');
      if (searchInput) searchInput.value = '';
    }
    emailSearchAccount = accountEmail;
    activeDomainMode = getEmailSharedDomainMode(activeAccount?.email);
    userDomain = activeDomainMode.domain || '';
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

  const data = processFiles(allFiles);
  renderAll(data);
}

function exportToCSV(data) {
  const rows = [];
  rows.push('Email,Tên hiển thị,Ngoài tổ chức,Số tệp,Xem,Chỉnh sửa');

  for (const g of data.emailList) {
    rows.push([
      `"${g.email}"`,
      `"${g.displayName}"`,
      g.isExternal ? 'Có' : 'Không',
      g.stats.total,
      g.stats.view,
      g.stats.edit
    ].join(','));
  }

  const csv = rows.join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `shared-emails-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function openBulkRevokeModal() {
  populateFolderChoices();
  resetBulkRevokeModal();
  updateFolderScopeVisibility();
  document.getElementById('bulkRevokeModal').classList.remove('hidden');
}

function closeBulkRevokeModal() {
  resetBulkRevokeModal();
  document.getElementById('bulkRevokeModal').classList.add('hidden');
}
window.closeBulkRevokeModal = closeBulkRevokeModal;

function folderPath(folder, byId, seen = new Set()) {
  if (!folder || seen.has(folder.id)) return folder?.name || 'My Drive';
  seen.add(folder.id);
  const parent = (folder.parents || []).map(id => byId.get(id)).find(Boolean);
  return parent ? `${folderPath(parent, byId, seen)} > ${folder.name}` : `My Drive > ${folder.name}`;
}

function populateFolderChoices(query = '') {
  const select = document.getElementById('folderScopeSelect');
  const menu = document.getElementById('folderScopeMenu');
  if (!select || !menu) return;
  const folders = allFiles.filter(file => file.mimeType === 'application/vnd.google-apps.folder' && !file.trashed);
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  folderChoices = folders.map(folder => ({ id: folder.id, name: folder.name || 'Không tên', path: folderPath(folder, byId) }))
    .sort((a, b) => a.path.localeCompare(b.path, 'vi'));
  const selectedId = select.dataset.folderId || '';
  if (selectedId && !folderChoices.some(folder => folder.id === selectedId)) clearFolderSelection();
  menu.innerHTML = folderChoices.map(folder => `<button class="folder-selector-option" type="button" role="option" data-folder-id="${escapeHtml(folder.id)}" aria-selected="${folder.id === selectedId}">${escapeHtml(folder.path.replaceAll(' > ', ' › '))}</button>`).join('') || '<div class="folder-selector-option">Không có thư mục khả dụng</div>';
  select.disabled = folderChoices.length === 0;
}

function updateFolderScopeVisibility() {
  const scope = document.querySelector('input[name="scope"]:checked')?.value;
  const isFolder = scope === 'folder';
  const fields = document.getElementById('folderScopeFields');
  if (fields) fields.classList.toggle('hidden', !isFolder);
  const emailFields = document.getElementById('emailScopeFields');
  if (emailFields) emailFields.classList.toggle('hidden', scope !== 'email');
  document.querySelectorAll('#bulkRevokeModal .option').forEach(option => option.classList.toggle('is-selected', option.querySelector('input')?.checked));
  document.getElementById('folderScopeMenu')?.classList.add('hidden');
  document.getElementById('folderScopeSelect')?.setAttribute('aria-expanded', 'false');
  if (isFolder) populateFolderChoices();
  updateBulkRevokeSubmitState();
}

function getValidatedEmails() {
  const raw = document.getElementById('emailScopeInput')?.value || '';
  const values = raw.split(/[\n,]/).map(email => email.trim().toLowerCase()).filter(Boolean);
  const emails = [...new Set(values)];
  const invalid = emails.filter(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  return { emails, invalid };
}

function setScopeValidation(id, message = '') {
  const field = document.getElementById(id);
  if (!field) return;
  field.textContent = message;
  field.classList.toggle('hidden', !message);
}

function clearFolderSelection() {
  const select = document.getElementById('folderScopeSelect');
  if (!select) return;
  select.dataset.folderId = '';
  select.querySelector('span').textContent = 'Chọn thư mục';
}

function selectFolder(folderId) {
  const folder = folderChoices.find(item => item.id === folderId);
  if (!folder) return;
  const select = document.getElementById('folderScopeSelect');
  select.dataset.folderId = folder.id;
  select.querySelector('span').textContent = folder.path.replaceAll(' > ', ' › ');
  document.getElementById('folderScopeMenu').classList.add('hidden');
  select.setAttribute('aria-expanded', 'false');
  setScopeValidation('folderScopeValidation');
  updateBulkRevokeSubmitState();
}

function updateBulkRevokeSubmitState() {
  const scope = document.querySelector('input[name="scope"]:checked')?.value;
  const button = document.getElementById('btnConfirmRevoke');
  if (!button) return;
  let valid = scope === 'all';
  if (scope === 'folder') {
    const folderId = document.getElementById('folderScopeSelect')?.dataset.folderId || '';
    valid = folderChoices.some(folder => folder.id === folderId);
    setScopeValidation('folderScopeValidation', valid ? '' : 'Vui lòng chọn một thư mục còn truy cập được.');
  } else if (scope === 'email') {
    const { emails, invalid } = getValidatedEmails();
    valid = emails.length > 0 && invalid.length === 0;
    setScopeValidation('emailScopeValidation', !emails.length ? 'Vui lòng nhập ít nhất một email.' : invalid.length ? `Email không hợp lệ: ${invalid.join(', ')}` : '');
  } else {
    setScopeValidation('folderScopeValidation');
    setScopeValidation('emailScopeValidation');
  }
  button.disabled = !valid;
}

function resetBulkRevokeModal() {
  const allScope = document.querySelector('input[name="scope"][value="all"]');
  if (allScope) allScope.checked = true;
  clearFolderSelection();
  const menu = document.getElementById('folderScopeMenu');
  if (menu) menu.classList.add('hidden');
  const emailInput = document.getElementById('emailScopeInput');
  if (emailInput) emailInput.value = '';
  setScopeValidation('folderScopeValidation');
  setScopeValidation('emailScopeValidation');
  const description = document.getElementById('allScopeDescription');
  if (description) description.textContent = `Thu hồi mọi liên kết công khai trên toàn Drive (${new Intl.NumberFormat('vi-VN').format(emailGroups['anyone-with-link']?.stats.total || 0)} file).`;
}

async function confirmBulkRevoke() {
  const scope = document.querySelector('input[name="scope"]:checked').value;
  const btn = document.getElementById('btnConfirmRevoke');
  btn.disabled = true;
  btn.textContent = 'Đang xử lý...';

  try {
    let result = { success: 0, skipped: 0, failed: 0, blocked: 0 };
    if (scope === 'all') {
      const operation = await requireCleanupMutation((emailGroups['anyone-with-link']?.files || []).map(({ file }) => file.id));
      if (!operation) return;
      result = await revokeAllPublicLinks(operation);
    } else if (scope === 'folder') {
      const folderId = document.getElementById('folderScopeSelect')?.dataset.folderId;
      if (!folderId || !folderChoices.some(folder => folder.id === folderId)) {
        Toast.warning('Vui lòng chọn một thư mục còn truy cập được.');
        return;
      }
      const scopedIds = collectFolderTreeItemIds(folderId, allFiles);
      const targetIds = (emailGroups['anyone-with-link']?.files || []).filter(({ file }) => scopedIds.has(file?.id) && !file?.trashed).map(({ file }) => file.id);
      const operation = await requireCleanupMutation(targetIds);
      if (!operation) return;
      result = await revokeByFolder(folderId, operation);
    } else if (scope === 'email') {
      const { emails: values, invalid } = getValidatedEmails();
      if (!values.length || invalid.length) {
        updateBulkRevokeSubmitState();
        return;
      }
      const targetIds = values.flatMap(email => (emailGroups[email]?.files || []).map(({ file }) => file.id));
      const operation = await requireCleanupMutation(targetIds);
      if (!operation) return;
      result = await revokeByEmails(values, operation);
    }

    closeBulkRevokeModal();
    showRevokeSummary(result);
    await loadSharedData();
  } catch (e) {
    Toast.error('Lỗi: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Thu hồi quyền';
  }
}

async function revokeAllPublicLinks(operation) {
  let result = { success: 0, skipped: 0, failed: 0, blocked: 0 };
  const loggedActions = [];
  const group = emailGroups['anyone-with-link'];
  if (!group) return result;

  for (const { file, permission, inherited } of group.files) {
    if (!operation.allowedFileIds.includes(file.id)) { result.blocked++; continue; }
    const res = await revokePermissionSafe(file.id, permission.id, { inherited });
    if (res.ok) { result.success++; loggedActions.push({ type: 'revoke', fileId: file.id, fileName: file.name, fileSize: file.size, actionLabel: 'Thu hồi quyền' }); }
    else if (res.skipped) result.skipped++;
    else result.failed++;
  }
  if (loggedActions.length) await logActionsBulk(loggedActions, operation);
  else await failReservedCleanup(operation);
  return result;
}

async function revokeByFolder(folderId, operation) {
  let result = { success: 0, skipped: 0, failed: 0, blocked: 0 };
  const loggedActions = [];
  const group = emailGroups['anyone-with-link'];
  if (!group) { await failReservedCleanup(operation); return result; }
  const scopedItemIds = collectFolderTreeItemIds(folderId, allFiles);
  if (!scopedItemIds.size) {
    Toast.warning('Thư mục không còn tồn tại hoặc bạn không thể truy cập.');
    await failReservedCleanup(operation); return result;
  }
  // A file can appear through duplicate cached references or multiple public
  // permissions. Process each concrete permission at most once.
  const seenPermissions = new Set();
  const targets = group.files.filter(({ file, permission }) => {
    if (file?.trashed || !scopedItemIds.has(file?.id)) return false;
    const key = `${file.id}:${permission?.id || ''}`;
    if (seenPermissions.has(key)) return false;
    seenPermissions.add(key);
    return true;
  });
  if (targets.length === 0) {
    Toast.info('Không tìm thấy file công khai trong thư mục này');
    await failReservedCleanup(operation); return result;
  }
  for (const { file, permission, inherited } of targets) {
    if (!operation.allowedFileIds.includes(file.id)) { result.blocked++; continue; }
    const res = await revokePermissionSafe(file.id, permission.id, { inherited });
    if (res.ok) { result.success++; loggedActions.push({ type: 'revoke', fileId: file.id, fileName: file.name, fileSize: file.size, actionLabel: 'Thu hồi quyền' }); }
    else if (res.skipped) result.skipped++;
    else result.failed++;
  }
  if (loggedActions.length) await logActionsBulk(loggedActions, operation);
  else await failReservedCleanup(operation);
  return result;
}

async function revokeByEmails(emails, operation) {
  let result = { success: 0, skipped: 0, failed: 0, blocked: 0 };
  const loggedActions = [];
  const mutationAccount = accountKey(await getActiveAccount());
  for (const email of emails) {
    const group = emailGroups[email];
    if (!group) continue;
    for (const { file, permission, inherited } of group.files) {
      if (!operation.allowedFileIds.includes(file.id)) { result.blocked++; continue; }
      const res = await revokePermissionSafe(file.id, permission.id, { inherited });
      if (res.ok) { result.success++; loggedActions.push({ type: 'revoke', fileId: file.id, permissionId: permission.id, fileName: file.name, fileSize: file.size, actionLabel: 'Thu hồi quyền' }); }
      else if (res.skipped) result.skipped++;
      else result.failed++;
    }
  }
  if (loggedActions.length) await logActionsBulk(loggedActions, operation);
  else await failReservedCleanup(operation);
  if (!await accountIsCurrent(mutationAccount)) return { ...result, accountChanged: true };
  for (const action of loggedActions) patchLocalPermissionAfterSuccess(action.fileId, action.permissionId);
  rebuildGroupsFromCanonicalState();
  return result;
}

let _mounted = false;

export async function mount() {
  if (_mounted) return;
  _mounted = true;

  initProfile().catch(error => console.warn('[email-shared] profile refresh failed', { code: error?.code || 'UNKNOWN' }));
  try {
    await getAuthTokenSilently();
  } catch (_) {
    document.getElementById('shared-empty').style.display = 'block';
    return;
  }

  await loadSharedData();

  document.getElementById('shared-email-search')?.addEventListener('input', event => {
    applyEmailSearch(event.currentTarget.value);
  });

  document.getElementById('btnExportReport').addEventListener('click', async () => {
    const data = processFiles(allFiles);
    exportToCSV(data);
    Toast.success('Đã xuất báo cáo thành công');
  });

  document.getElementById('btnBulkRevoke').addEventListener('click', () => {
    openBulkRevokeModal();
  });
  document.getElementById('btnHeroRevoke')?.addEventListener('click', () => {
    openBulkRevokeModal();
  });
  document.getElementById('btnConfirmRevoke').addEventListener('click', confirmBulkRevoke);
  document.getElementById('bulkModalClose').addEventListener('click', closeBulkRevokeModal);
  document.getElementById('bulkModalCancel').addEventListener('click', closeBulkRevokeModal);
  document.querySelectorAll('input[name="scope"]').forEach(input => input.addEventListener('change', updateFolderScopeVisibility));
  document.getElementById('folderScopeSelect')?.addEventListener('click', () => {
    const menu = document.getElementById('folderScopeMenu');
    if (!menu || document.getElementById('folderScopeSelect').disabled) return;
    const isOpen = !menu.classList.toggle('hidden');
    document.getElementById('folderScopeSelect').setAttribute('aria-expanded', String(isOpen));
  });
  document.getElementById('folderScopeMenu')?.addEventListener('click', (event) => {
    const option = event.target.closest('[data-folder-id]');
    if (option) selectFolder(option.dataset.folderId);
  });
  document.getElementById('emailScopeInput')?.addEventListener('input', updateBulkRevokeSubmitState);
  document.getElementById('bulkRevokeModal')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeBulkRevokeModal();
  });

  document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
  document.getElementById('sidebarCloseBtn').addEventListener('click', closeSidebar);

  document.getElementById('sidebarRevokeAll').addEventListener('click', async () => {
    if (!currentModalEmail) return;
    const group = emailGroups[currentModalEmail];
    if (!group) return;
    const label = currentModalEmail === 'anyone-with-link' ? 'tệp công khai' : currentModalEmail;
    if (!confirm(`Thu hồi toàn bộ quyền của ${label}?`)) return;
    const btn = document.getElementById('sidebarRevokeAll');
    const operation = await requireCleanupMutation(group.files.map(({ file }) => file.id));
    if (!operation) return;
    btn.disabled = true;
    const result = await revokeAllForEmail(currentModalEmail, (processed, total) => {
      btn.textContent = `Đang thu hồi ${processed}/${total} — ${Math.round(processed / total * 100)}%`;
    }, operation);
    btn.disabled = false;
    btn.textContent = 'Thu hồi toàn bộ';
    closeSidebar();
    if (result) showRevokeSummary(result);
  });

  document.getElementById('sidebarRevokeSelected').addEventListener('click', async () => {
    const checked = document.querySelectorAll('.file-checkbox:checked');
    if (checked.length === 0) return;
    if (!confirm(`Thu hồi ${checked.length} quyền đã chọn?`)) return;
    const operation = await requireCleanupMutation([...checked].map(item => item.dataset.fileid));
    if (!operation) return;
    const btn = document.getElementById('sidebarRevokeSelected');
    btn.disabled = true;
    btn.textContent = 'Đang xử lý...';
    let result = { success: 0, skipped: 0, failed: 0 };
    const successfulActions = [];
    const mutationAccount = accountKey(await getActiveAccount());
    for (const cb of checked) {
      const fileId = cb.dataset.fileid;
      const permId = cb.dataset.permid;
      const inherited = cb.dataset.inherited === '1';
      if (!operation.allowedFileIds.includes(fileId)) { result.blocked++; continue; }
      const res = await revokePermissionSafe(fileId, permId, { inherited });
      if (res.ok) {
        result.success++;
        const file = allFiles.find(item => item.id === fileId);
        successfulActions.push({ type: 'revoke', fileId, permissionId: permId, fileName: file?.name, fileSize: file?.size, actionLabel: 'Thu hồi quyền' });
      } else if (res.skipped) {
        result.skipped++;
      } else {
        result.failed++;
      }
    }
    btn.disabled = false;
    if (!await accountIsCurrent(mutationAccount)) {
      if (successfulActions.length) await logActionsBulk(successfulActions, operation);
      else await failReservedCleanup(operation);
      showRevokeSummary({ ...result, accountChanged: true });
      return;
    }
    if (successfulActions.length) await logActionsBulk(successfulActions, operation);
    else await failReservedCleanup(operation);
    for (const action of successfulActions) patchLocalPermissionAfterSuccess(action.fileId, action.permissionId);
    rebuildGroupsFromCanonicalState();
    updateSelectedCount();
    showRevokeSummary(result);
  });
}

export async function onShow() {}
export async function onHide() {}

// Standalone (không qua shell) → tự khởi động
if (!window.WistorixRouter) {
  document.addEventListener('DOMContentLoaded', () => { mount(); });
}
