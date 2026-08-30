const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

export const getPermissionRoleLabel = role => ({
  reader: 'Người xem', writer: 'Người chỉnh sửa', commenter: 'Người nhận xét', owner: 'Chủ sở hữu'
}[role] || role || 'Không xác định');

export function openActionConfirm(message, onConfirm) {
  let overlay = document.getElementById('wistorix-action-confirm-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'wistorix-action-confirm-modal';
    overlay.className = 'wix-modal-overlay';
    overlay.style.zIndex = '100002';
    overlay.innerHTML = `<div class="wix-modal"><h4 class="wix-modal__title"><i class="fas fa-exclamation-triangle" style="color:#e74a3b;"></i> <span>Xác nhận hành động</span></h4><p class="wix-modal__confirm-msg" data-confirm-message></p><div style="text-align:right; margin-top:16px; display:flex; gap:8px; justify-content:flex-end;"><button type="button" class="wix-btn wix-btn--ghost wix-btn--sm" data-confirm-cancel>Hủy</button><button type="button" class="wix-btn wix-btn--danger wix-btn--sm" data-confirm-ok>Xác nhận</button></div></div>`;
    document.body.appendChild(overlay);
  }
  let resolveChoice;
  const close = choice => { overlay.style.display = 'none'; resolveChoice?.(choice); resolveChoice = null; };
  overlay.querySelector('[data-confirm-message]').textContent = message;
  overlay.querySelector('[data-confirm-cancel]').onclick = () => close(false);
  overlay.onclick = event => { if (event.target === overlay) close(false); };
  overlay.querySelector('[data-confirm-ok]').onclick = () => { close(true); void onConfirm?.(); };
  overlay.style.display = 'flex';
  return new Promise(resolve => { resolveChoice = resolve; });
}

export function getInheritedParentId(permission) {
  const detail = permission?.permissionDetails?.find(item => typeof item?.inheritedFrom === 'string' && item.inheritedFrom);
  return detail?.inheritedFrom || null;
}

export function isInheritedPermission(permission) {
  return permission?.inherited === true || permission?.permissionDetails?.some(detail =>
    detail?.inherited === true || (typeof detail?.inheritedFrom === 'string' && detail.inheritedFrom)
  ) === true;
}

export function findMatchingInheritedParentPermission(childPermission, parentPermissions) {
  const identity = permission => {
    if (permission.type === 'anyone') return 'anyone';
    if (permission.type === 'domain') return `domain:${permission.domain || ''}`;
    return `${permission.type || ''}:${String(permission.emailAddress || '').trim().toLowerCase()}`;
  };
  const matches = (parentPermissions || []).filter(permission =>
    permission.role !== 'owner' &&
    permission.type === childPermission.type &&
    permission.role === childPermission.role &&
    (typeof childPermission.allowFileDiscovery !== 'boolean' || permission.allowFileDiscovery === childPermission.allowFileDiscovery) &&
    identity(permission) === identity(childPermission)
  );
  return matches.length === 1 ? matches[0] : null;
}

export function openInheritedPermissionParentModal({ file, parent, permission }) {
  return new Promise(resolve => {
    const name = permission.type === 'anyone' ? 'Công khai' : permission.type === 'domain'
      ? `Tên miền ${permission.domain || ''}` : permission.emailAddress || permission.displayName || 'Không xác định';
    const icon = permission.type === 'anyone' ? 'fa-globe' : permission.type === 'domain'
      ? 'fa-building' : permission.type === 'group' ? 'fa-users' : 'fa-user';
    const fileName = file?.name || 'Tệp không tên';
    const parentName = parent?.name || 'thư mục cha';
    const warningTarget = parent?.name ? `&quot;${escapeHtml(parent.name)}&quot;` : 'thư mục cha';
    const overlay = document.createElement('div');
    overlay.className = 'wix-modal-overlay';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '100003';
    overlay.innerHTML = `<div class="wix-modal wix-modal--inherited-permission" role="dialog" aria-modal="true" aria-labelledby="inherited-parent-title"><header class="inherited-permission-modal__header"><div class="inherited-permission-modal__heading"><div class="inherited-permission-modal__icon"><i class="fas fa-folder"></i></div><div><h3 id="inherited-parent-title">Quyền được kế thừa từ thư mục cha</h3><p>Quyền này được cấp thông qua thư mục chứa tệp.</p></div></div><button type="button" class="inherited-permission-modal__close" data-inherited-cancel aria-label="Đóng">&times;</button></header><div class="inherited-permission-modal__body"><section class="inherited-permission-modal__summary"><div class="inherited-permission-modal__field"><span class="inherited-permission-modal__label">Tệp</span><span class="inherited-permission-modal__value" title="${escapeHtml(fileName)}"><i class="fas fa-file"></i><span>${escapeHtml(fileName)}</span></span></div><div class="inherited-permission-modal__field"><span class="inherited-permission-modal__label">Nguồn cấp quyền</span><span class="inherited-permission-modal__value inherited-permission-modal__value--parent" title="${escapeHtml(parentName)}"><i class="fas fa-folder"></i><span>${escapeHtml(parentName)}</span></span></div><div class="inherited-permission-modal__field"><span class="inherited-permission-modal__label">Quyền hiện tại</span><span class="inherited-permission-modal__permission"><span class="inherited-permission-modal__principal"><i class="fas ${icon}"></i><span>${escapeHtml(name)}</span></span><span class="inherited-permission-modal__role">${escapeHtml(getPermissionRoleLabel(permission.role))}</span></span></div></section><section class="inherited-permission-modal__warning"><i class="fas fa-exclamation-triangle" aria-hidden="true"></i><div><strong>Có thể ảnh hưởng đến nội dung khác</strong><p>Thu hồi quyền trên ${warningTarget} có thể ảnh hưởng đến các tệp và thư mục khác đang kế thừa cùng quyền.</p></div></section></div><footer class="inherited-permission-modal__footer"><button type="button" class="wix-btn wix-btn--ghost wix-btn--sm" data-inherited-cancel>Hủy</button><button type="button" class="wix-btn wix-btn--danger wix-btn--sm" data-inherited-confirm><i class="fas fa-lock"></i> Thu hồi quyền thư mục cha</button></footer></div>`;
    const close = choice => { overlay.remove(); resolve(choice); };
    overlay.querySelectorAll('[data-inherited-cancel]').forEach(button => { button.onclick = () => close(false); });
    overlay.querySelector('[data-inherited-confirm]').onclick = () => close(true);
    overlay.onclick = event => { if (event.target === overlay) close(false); };
    document.body.appendChild(overlay);
  });
}

export async function handleInheritedPermissionRevoke({ file, permission, getFileMetadata, getFilePermissions, revokePermission, removeCachedPermission, requireCleanupMutation, canManageSharing, onSuccess, toast }) {
  const parentId = getInheritedParentId(permission);
  if (!permission || !parentId) {
    toast.warning('Quyền được kế thừa nhưng không xác định được thư mục nguồn.');
    return { ok: false, reason: 'unresolved_parent' };
  }
  let parent;
  try { parent = await getFileMetadata(parentId); }
  catch (error) { toast.error(error.message); return { ok: false, reason: 'parent_lookup_failed' }; }
  if (!canManageSharing?.(parent)) {
    toast.error(`Không thể thay đổi quyền kế thừa tại "${parent.name || 'thư mục cha'}". Bạn không có quyền thay đổi quyền chia sẻ của thư mục này.`);
    return { ok: false, reason: 'parent_not_manageable' };
  }
  let parentPermission;
  try { parentPermission = findMatchingInheritedParentPermission(permission, await getFilePermissions(parent.id)); }
  catch (error) { toast.error('Không thể tải quyền của thư mục cha: ' + error.message); return { ok: false, reason: 'parent_permissions_failed' }; }
  if (!parentPermission) {
    toast.warning('Không xác định được permission tương ứng trên thư mục cha.');
    return { ok: false, reason: 'parent_permission_unresolved' };
  }
  if (!await openInheritedPermissionParentModal({ file, parent, permission })) return { ok: false, cancelled: true };
  const operation = canManageSharing?.(parent) ? await requireCleanupMutation(parent.id) : null;
  if (!operation) return { ok: false, reason: 'not_allowed' };
  try {
    await revokePermission(parent.id, parentPermission.id);
    await removeCachedPermission?.(file.id, permission.id);
    await onSuccess?.({ parent, parentPermission, childPermission: permission, operation });
    toast.success(`Đã thu hồi quyền chia sẻ từ thư mục “${parent.name || 'thư mục cha'}”.`);
    return { ok: true, parent, parentPermission };
  } catch (error) {
    await import('./actions.js').then(({ failReservedCleanup }) => failReservedCleanup(operation));
    toast.error('Không thể thu hồi quyền thư mục cha: ' + error.message);
    return { ok: false, reason: 'parent_revoke_failed' };
  }
}

export function openOwnershipTransferModal(files) {
  return new Promise(resolve => {
    const selected = Array.isArray(files) ? files : [];
    const isBulk = selected.length > 1;
    const owners = [...new Set(selected.map(file => file.owners?.[0]?.emailAddress).filter(Boolean))];
    const fileLabel = isBulk ? `${selected.length} file đã chọn` : (selected[0]?.name || '—');
    const ownerLabel = owners.length === 1 ? owners[0] : (owners.length ? 'Nhiều chủ sở hữu' : 'Không xác định');
    const overlay = document.createElement('div');
    overlay.className = 'wix-modal-overlay';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '100001';
    overlay.innerHTML = `<div class="wix-modal ownership-transfer-modal" role="dialog" aria-modal="true" aria-labelledby="transfer-modal-title" style="width:min(520px,calc(100vw - 32px));padding:0;overflow:hidden;"><div class="ownership-transfer-modal__header" style="display:flex;align-items:flex-start;gap:12px;padding:20px 22px;border-bottom:1px solid #e5e7eb;"><div class="ownership-transfer-modal__icon" style="color:#7c3aed;background:#f3e8ff;border-radius:10px;padding:9px 11px;"><i class="fas fa-exchange-alt"></i></div><div class="ownership-transfer-modal__text" style="flex:1"><h4 id="transfer-modal-title" style="margin:0 0 4px;">Chuyển quyền sở hữu</h4><p class="ownership-transfer-modal__subtitle" style="margin:0;color:#64748b;font-size:13px;">Chuyển quyền sở hữu: ${escapeHtml(fileLabel)}</p></div><button type="button" class="ownership-transfer-modal__close" data-transfer-close aria-label="Đóng" style="border:0;background:transparent;font-size:22px;line-height:1;color:#64748b;cursor:pointer;">×</button></div><form data-transfer-form style="padding:20px 22px;display:grid;gap:15px;"><label style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:.04em;">FILE SẼ CHUYỂN<input readonly value="${escapeHtml(fileLabel)}" style="display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;border:1px solid #dbe3ef;border-radius:7px;background:#f8fafc;color:#334155;"></label><label style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:.04em;">CHỦ SỞ HỮU HIỆN TẠI<input readonly value="${escapeHtml(ownerLabel)}" style="display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;border:1px solid #dbe3ef;border-radius:7px;background:#f8fafc;color:#334155;"></label><label style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:.04em;">EMAIL CHỦ SỞ HỮU MỚI<input data-transfer-email type="email" placeholder="vd: quanly@company.com" autocomplete="email" style="display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;border:1px solid #cbd5e1;border-radius:7px;"></label><div style="padding:10px 12px;border-radius:7px;background:#eef6ff;color:#475569;font-size:12px;line-height:1.45;">⚠ Sau khi chuyển, bạn trở thành người chỉnh sửa. Chủ sở hữu mới nên cùng tổ chức Google Workspace để nhận quyền ngay.</div><p data-transfer-error style="margin:0;color:#dc2626;font-size:12px;display:none;"></p><div style="display:flex;justify-content:flex-end;gap:8px;padding-top:4px;"><button type="button" data-transfer-close class="wix-btn wix-btn--ghost wix-btn--sm">Hủy</button><button type="submit" class="wix-btn wix-btn--primary wix-btn--sm">Chuyển quyền</button></div></form></div>`;
    const close = () => { overlay.remove(); resolve(null); };
    overlay.querySelectorAll('[data-transfer-close]').forEach(button => button.addEventListener('click', close));
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    const input = overlay.querySelector('[data-transfer-email]');
    const error = overlay.querySelector('[data-transfer-error]');
    overlay.querySelector('[data-transfer-form]').addEventListener('submit', event => {
      event.preventDefault();
      const email = input.value.trim().toLowerCase();
      if (!EMAIL_RE.test(email)) { error.textContent = 'Vui lòng nhập email hợp lệ.'; error.style.display = 'block'; input.focus(); return; }
      if (owners.some(owner => owner.trim().toLowerCase() === email)) { error.textContent = 'Email mới phải khác chủ sở hữu hiện tại.'; error.style.display = 'block'; input.focus(); return; }
      overlay.remove(); resolve(email);
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => input.focus());
  });
}

export async function openOwnershipRequestModal({ files, getFileOwner, submitOwnershipRequest, ownershipRequestMessage, toast }) {
  const selected = Array.isArray(files) ? files.filter(file => file && !file.trashed && !file.ownedByMe) : [];
  if (!selected.length) { toast.warning('Chỉ có thể yêu cầu sở hữu với tệp đang được chia sẻ cho bạn.'); return; }
  const ownerGroups = new Map();
  for (const file of selected) {
    let ownerEmail = file.owners?.find(owner => EMAIL_RE.test(String(owner?.emailAddress || '').trim()))?.emailAddress || '';
    if (!ownerEmail) { try { ownerEmail = (await getFileOwner(file.id))?.emailAddress || ''; } catch (_) {} }
    ownerEmail = ownerEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(ownerEmail)) { toast.error('Không xác định được email chủ sở hữu hiện tại.'); return; }
    if (!ownerGroups.has(ownerEmail)) ownerGroups.set(ownerEmail, []);
    ownerGroups.get(ownerEmail).push(file);
  }
  if (ownerGroups.size !== 1) { toast.warning('Các file đã chọn có nhiều chủ sở hữu. Hãy chọn các file cùng một chủ sở hữu.'); return; }
  const [ownerEmail, ownerFiles] = [...ownerGroups.entries()][0];
  const fileLabel = ownerFiles.length > 1 ? `${ownerFiles.length} file đã chọn` : ownerFiles[0].name || '—';
  const overlay = document.createElement('div');
  overlay.className = 'wix-modal-overlay ownership-request-overlay';
  overlay.innerHTML = `<div class="wix-modal ownership-request-modal" role="dialog" aria-modal="true" aria-labelledby="ownership-request-title"><header class="ownership-request-modal__header"><div class="ownership-request-modal__heading"><span class="ownership-request-modal__icon"><i class="fas fa-envelope"></i></span><div><h4 id="ownership-request-title">Yêu cầu chuyển giao quyền</h4><p>Yêu cầu chuyển quyền: ${escapeHtml(fileLabel)}</p></div></div><button type="button" class="ownership-request-modal__close" data-request-close aria-label="Đóng">×</button></header><form class="ownership-request-modal__body" data-request-form><label class="ownership-request-modal__label">GỬI TỚI (CHỦ SỞ HỮU HIỆN TẠI)<input readonly value="${escapeHtml(ownerEmail)}" aria-label="Chủ sở hữu hiện tại"></label><fieldset class="ownership-request-modal__methods"><legend class="ownership-request-modal__label">PHƯƠNG THỨC GỬI</legend><label class="ownership-request-modal__method is-selected"><input type="radio" name="ownership-request-method" value="email" checked><span class="ownership-request-modal__method-icon"><i class="fas fa-envelope"></i></span><span><strong>Gửi email</strong><small>Email kèm liên kết chấp nhận chuyển quyền.</small></span></label><label class="ownership-request-modal__method is-unavailable" title="Chưa có hệ thống thông báo Wistorix backend."><input type="radio" name="ownership-request-method" value="notification" disabled><span class="ownership-request-modal__method-icon ownership-request-modal__method-icon--warning"><i class="fas fa-bell"></i></span><span><strong>Thông báo trong Wistorix</strong><small>Tính năng đang bổ sung.</small></span></label></fieldset><label class="ownership-request-modal__label">LỜI NHẮN (TÙY CHỌN)<textarea data-request-message maxlength="2000" placeholder="Chào bạn, mình cần tiếp quản các file này để quản lý..."></textarea></label><p class="ownership-request-modal__error" data-request-error hidden></p><footer class="ownership-request-modal__footer"><button type="button" class="wix-btn wix-btn--ghost wix-btn--sm" data-request-close>Hủy</button><button type="submit" class="wix-btn wix-btn--primary wix-btn--sm" data-request-submit><i class="fas fa-envelope"></i> Gửi yêu cầu</button></footer></form></div>`;
  const close = () => overlay.remove();
  overlay.querySelectorAll('[data-request-close]').forEach(button => button.addEventListener('click', close));
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  let submitting = false;
  overlay.querySelector('[data-request-form]').addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    const error = overlay.querySelector('[data-request-error]');
    const submit = overlay.querySelector('[data-request-submit]');
    submitting = true; submit.disabled = true; error.hidden = true;
    try {
      const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await submitOwnershipRequest({ fileIds: ownerFiles.map(file => file.id), message: overlay.querySelector('[data-request-message]').value, requestId });
      close(); toast.success('Đã gửi yêu cầu chuyển quyền sở hữu. Chủ sở hữu sẽ nhận email.');
    } catch (err) {
      error.textContent = ownershipRequestMessage(err.code) || err.message || 'Không thể gửi yêu cầu. Vui lòng thử lại.';
      error.hidden = false;
    } finally { submit.disabled = false; submitting = false; }
  });
  document.body.appendChild(overlay);
  overlay.querySelector('[data-request-message]').focus();
}

export async function openSharePermissionsModal({ file, getFilePermissions, getFileOwner, getFileMetadata, revokePermission, removeCachedPermission, requireCleanupMutation, onPermissionRevoked, onPermissionsRevoked, onInheritedPermissionRevoked, canManageSharing, toast, revokeAllOnOpen = false, getInheritedParentName, canManageInheritedPermission, allowInheritedPermissionManagement = false }) {
  const overlay = document.createElement('div');
  overlay.className = 'wix-modal-overlay';
  overlay.style.display = 'flex';
  overlay.innerHTML = `<div class="wix-modal wix-modal--share-v2"><div class="wix-modal__header"><div class="wix-modal__header-left"><div class="wix-modal__header-icon"><i class="fas fa-share-alt"></i></div><div><h3 class="wix-modal__title">Đang chia sẻ với</h3><p class="wix-modal__subtitle">${escapeHtml(file.name || '—')}</p></div></div><button type="button" class="wix-modal__close" data-share-close>&times;</button></div><div class="wix-modal__body"><div data-share-list></div><p class="share-permission-inherited-note" data-share-inherited-note hidden><i class="fas fa-info-circle" aria-hidden="true"></i><span>Kế thừa: Quyền này được nhận từ thư mục cha, không được cấp trực tiếp cho thư mục này.</span></p></div><div class="wix-modal__footer"><button type="button" class="wix-btn wix-btn--ghost wix-btn--sm" data-share-close>Đóng</button><button type="button" class="wix-btn wix-btn--danger wix-btn--sm" data-share-revoke-all><i class="fas fa-lock"></i> Thu hồi tất cả</button></div></div>`;
  document.body.appendChild(overlay);
  const list = overlay.querySelector('[data-share-list]');
  const inheritedNote = overlay.querySelector('[data-share-inherited-note]');
  const allButton = overlay.querySelector('[data-share-revoke-all]');
  const close = () => overlay.remove();
  overlay.querySelectorAll('[data-share-close]').forEach(button => button.onclick = close);
  overlay.onclick = event => { if (event.target === overlay) close(); };
  let permissions = [];
  const canManageDirect = () => canManageSharing?.() === true;
  const revocable = permission => permission.role !== 'owner' && permission.id && !getInheritedParentId(permission) && !(permission.permissionDetails?.some(detail => detail.inherited === true)) && !permission.inherited;
  const inheritedResolvable = permission => permission.role !== 'owner' && permission.id && Boolean(getInheritedParentId(permission));
  const inheritedActionable = permission => inheritedResolvable(permission) && canManageInheritedPermission?.(permission) !== false;
  const render = () => {
    const shared = permissions.filter(permission => permission.role !== 'owner');
    if (!shared.length) {
      list.innerHTML = '<div style="text-align:center;padding:20px;color:#888;"><i class="fas fa-lock"></i> File này không có quyền chia sẻ nào để thu hồi.</div>';
      inheritedNote.hidden = true;
      allButton.disabled = true;
      return;
    }
    allButton.disabled = !shared.some(permission => (canManageDirect() && revocable(permission)) || inheritedActionable(permission));
    inheritedNote.hidden = !shared.some(isInheritedPermission);
    list.innerHTML = shared.map(permission => {
      const name = permission.type === 'anyone' ? 'Công khai' : permission.type === 'domain' ? `Tên miền ${permission.domain || ''}` : permission.emailAddress || permission.displayName || 'Không xác định';
      const role = getPermissionRoleLabel(permission.role);
      const inherited = !revocable(permission);
      const parentId = getInheritedParentId(permission);
      const parentName = parentId ? getInheritedParentName?.(parentId) : '';
      const inheritedLabel = parentName ? `Kế thừa từ "${escapeHtml(parentName)}"` : 'Kế thừa';
      const inheritedAction = inherited && parentId && getFileMetadata && inheritedActionable(permission)
        ? `<button type="button" class="share-permission-revoke" data-inherited-permission-id="${escapeHtml(permission.id)}"><i class="fas fa-folder"></i> Thu hồi</button>` : '';
      const inheritedBlocked = inherited && parentId && canManageInheritedPermission?.(permission) === false
        ? `<span class="perm-inherited-tag" title="Quyền này được quản lý bởi thư mục ${escapeHtml(parentName || 'cha')}. Bạn không có quyền thay đổi quyền chia sẻ của thư mục đó."><i class="fas fa-ban"></i> Không thể thu hồi tại đây</span>` : '';
      return `<div class="share-permission-item"><div class="share-permission-avatar"><i class="fas fa-user"></i></div><div class="share-permission-info"><div class="share-permission-name">${escapeHtml(name)}</div>${permission.emailAddress ? `<div class="share-permission-email">${escapeHtml(permission.emailAddress)}</div>` : ''}</div><span class="share-permission-role">${escapeHtml(role)}</span>${inherited ? `<span class="perm-inherited-tag"><i class="fas fa-link"></i> ${inheritedLabel}</span>` + inheritedAction + inheritedBlocked : canManageDirect() ? `<button type="button" class="share-permission-revoke" data-permission-id="${escapeHtml(permission.id)}" data-permission-name="${escapeHtml(name)}"><i class="fas fa-times"></i> Gỡ</button>` : ''}</div>`;
    }).join('');
    list.querySelectorAll('[data-permission-id]').forEach(button => button.onclick = async () => {
      close();
      if (!await openActionConfirm(`Thu hồi quyền chia sẻ của ${button.dataset.permissionName}?`)) return;
      if (!canManageSharing?.()) { toast.error('Bạn không có quyền ngừng chia sẻ tệp này.'); return; }
      const operation = await requireCleanupMutation(file.id);
      if (!operation) return;
      button.disabled = true;
      try {
        await revokePermission(file.id, button.dataset.permissionId);
        const permission = permissions.find(item => item.id === button.dataset.permissionId);
        permissions = permissions.filter(item => item.id !== button.dataset.permissionId);
        await onPermissionRevoked(permission, operation);
        toast.success(`Đã thu hồi quyền chia sẻ của ${button.dataset.permissionName}.`);
        render();
      } catch (error) { await import('./actions.js').then(({ failReservedCleanup }) => failReservedCleanup(operation)); toast.error('Không thể thu hồi quyền: ' + error.message); button.disabled = false; }
    });
    list.querySelectorAll('[data-inherited-permission-id]').forEach(button => button.onclick = async () => {
      const permission = permissions.find(item => item.id === button.dataset.inheritedPermissionId);
      close();
      await handleInheritedPermissionRevoke({ file, permission, getFileMetadata, getFilePermissions, revokePermission, removeCachedPermission, requireCleanupMutation, canManageSharing, onSuccess: onInheritedPermissionRevoked, toast });
    });
  };
  list.innerHTML = '<div style="text-align:center;padding:20px;color:#888;"><i class="fas fa-spinner fa-spin"></i> Đang tải quyền chia sẻ...</div>';
  try {
    if (!canManageDirect() && !allowInheritedPermissionManagement) {
      const owner = await getFileOwner?.(file.id);
      const ownerName = owner?.displayName || owner?.emailAddress || 'Không xác định';
      const ownerEmail = owner?.emailAddress ? `<div class="share-permission-email">${escapeHtml(owner.emailAddress)}</div>` : '';
      list.innerHTML = `<div class="share-permission-item"><div class="share-permission-avatar"><i class="fas fa-user"></i></div><div class="share-permission-info"><div class="share-permission-name">${escapeHtml(ownerName)}</div>${ownerEmail}</div><span class="share-permission-role">Chủ sở hữu</span></div>`;
      allButton.style.display = 'none';
      return;
    }
    permissions = await getFilePermissions(file.id) || [];
    render();
  }
  catch (error) { list.innerHTML = `<div style="text-align:center;padding:20px;color:#dc2626;">Không thể tải quyền chia sẻ: ${escapeHtml(error.message)}</div>`; allButton.disabled = true; }
  allButton.onclick = async () => {
    const targets = canManageDirect() ? permissions.filter(revocable) : [];
    const inheritedTargets = permissions.filter(inheritedActionable);
    if (!targets.length && inheritedTargets.length === 1) {
      close();
      await handleInheritedPermissionRevoke({ file, permission: inheritedTargets[0], getFileMetadata, getFilePermissions, revokePermission, removeCachedPermission, requireCleanupMutation, canManageSharing, onSuccess: onInheritedPermissionRevoked, toast });
      return;
    }
    if (!targets.length && inheritedTargets.length) {
      toast.info('Các quyền kế thừa cần được thu hồi từng quyền để xác nhận thư mục cha.');
      return;
    }
    close();
    if (!await openActionConfirm(`Thu hồi toàn bộ ${targets.length} quyền chia sẻ của file này?`)) return;
    if (!canManageSharing?.()) { toast.error('Bạn không có quyền ngừng chia sẻ tệp này.'); return; }
    const operation = await requireCleanupMutation(file.id);
    if (!operation) return;
    allButton.disabled = true;
    let revoked = 0;
    const revokedPermissions = [];
    for (const permission of targets) {
      if (!canManageSharing?.()) break;
      try { await revokePermission(file.id, permission.id); permissions = permissions.filter(item => item.id !== permission.id); revokedPermissions.push(permission); revoked++; } catch (_) {}
    }
    if (revoked) { await onPermissionsRevoked?.(revokedPermissions, operation); toast.success(inheritedTargets.length ? `Đã thu hồi ${revoked} quyền trực tiếp. Quyền kế thừa cần thu hồi từng quyền.` : `Đã thu hồi ${revoked} quyền chia sẻ.`); render(); }
    else { await import('./actions.js').then(({ failReservedCleanup }) => failReservedCleanup(operation)); toast.error('Không thể thu hồi quyền chia sẻ nào của tệp này.'); allButton.disabled = false; }
  };
  if (revokeAllOnOpen && !allButton.disabled) await allButton.onclick();
}
