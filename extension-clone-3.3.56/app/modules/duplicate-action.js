const isComparable = file => file && !file.trashed &&
  file.mimeType !== 'application/vnd.google-apps.folder' && !(file.mimeType || '').includes('shortcut');

export function getDuplicateComparison(files, sourceFileId) {
  const source = (files || []).find(file => file.id === sourceFileId);
  if (!source?.md5Checksum) return { group: [], original: null, duplicates: [] };
  const group = (files || []).filter(file => isComparable(file) && areSameFileFormat(file, source) && file.md5Checksum === source.md5Checksum)
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdTime || '');
      const rightTime = Date.parse(right.createdTime || '');
      const leftValid = Number.isFinite(leftTime);
      const rightValid = Number.isFinite(rightTime);
      if (leftValid && rightValid && leftTime !== rightTime) return leftTime - rightTime;
      if (leftValid !== rightValid) return leftValid ? -1 : 1;
      return String(left.id || '').localeCompare(String(right.id || ''));
    });
  return { group, original: group[0] || null, duplicates: group.slice(1) };
}

function ensureModal() {
  let modal = document.getElementById('duplicateModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'duplicateModal'; modal.className = 'wix-modal-overlay'; modal.style.display = 'none';
  modal.innerHTML = `<div class="wix-modal wix-modal--duplicate"><div class="wix-modal__header"><div class="wix-modal__header-left"><div class="wix-modal__header-icon wix-modal__header-icon--purple"><i class="fas fa-copy"></i></div><div><h3 class="wix-modal__title">So sánh bản trùng</h3><p class="wix-modal__subtitle" id="duplicate-modal-subtitle">—</p></div></div><button class="wix-modal__close" id="btnCloseDuplicateModal">&times;</button></div><div class="wix-modal__body"><div class="duplicate-alert"><i class="fas fa-info-circle"></i> Đối chiếu theo nội dung & dung lượng (mã băm dữ liệu) — các bản dưới đây trùng khớp 100%, không xét tên file. Giữ 1 bản, xóa các bản còn lại để tiết kiệm dung lượng.</div><div id="duplicate-cards-list"></div><div class="duplicate-footer-info"><i class="fas fa-info-circle"></i> Bản bị xóa sẽ chuyển vào Thùng rác của Google Drive — khôi phục được trong ~30 ngày, không xóa vĩnh viễn.</div></div><div class="wix-modal__footer"><span class="duplicate-remaining" id="duplicate-remaining">—</span><button class="wix-btn wix-btn--primary wix-btn--sm" id="btnCloseDuplicateFooter">Xong</button></div></div>`;
  document.body.appendChild(modal);
  return modal;
}

export function openDuplicateActionModal(options) {
  const modal = ensureModal();
  const list = modal.querySelector('#duplicate-cards-list');
  const subtitle = modal.querySelector('#duplicate-modal-subtitle');
  const remaining = modal.querySelector('#duplicate-remaining');
  const t = options.t || ((_key, fallback) => fallback);
  const close = () => { modal.style.display = 'none'; };
  const canManageDuplicate = options.canManageDuplicate || canCurrentAccountManageSharing;
  const sourceFile = options.getFiles().find(file => file.id === options.sourceFileId);
  if (!canManageDuplicate(sourceFile)) {
    options.toast?.error('Bạn không có quyền xử lý bản trùng của tệp này.');
    return;
  }
  modal.querySelector('#btnCloseDuplicateModal').onclick = close;
  modal.querySelector('#btnCloseDuplicateFooter').onclick = close;
  modal.style.display = 'flex';

  const render = () => {
    const comparison = getDuplicateComparison(options.getFiles(), options.sourceFileId);
    if (!comparison.original || comparison.group.length < 2) {
      subtitle.textContent = options.fileName || '';
      list.innerHTML = `<div style="text-align:center;padding:30px;color:#10b981;"><i class="fas fa-check-circle"></i> Không tìm thấy bản trùng nào cho file này.</div>`;
      remaining.textContent = t('dupe.remaining', 'Còn {n} bản').replace('{n}', comparison.group.length || 1);
      return;
    }
    subtitle.textContent = `${options.fileName || comparison.original.name} (+${comparison.duplicates.length} bản trùng)`;
    remaining.textContent = t('dupe.remaining', 'Còn {n} bản').replace('{n}', comparison.group.length);
    const resolvePath = createFilePathResolver(options.getFiles());
    list.innerHTML = comparison.group.map(file => {
      const original = file.id === comparison.original.id;
      const name = options.escapeHtml(file.name || 'Untitled');
      const path = options.escapeHtml(resolvePath(file));
      const canDelete = !original && canManageDuplicate(file);
      return `<div class="duplicate-card${original ? ' duplicate-card--original' : ''}"><div class="duplicate-card-top">${original ? `<span class="duplicate-card-badge">${t('dupe.originalLabel', 'Bản gốc')}</span>` : ''}<span class="duplicate-card-size">${options.formatBytes(parseInt(file.size || 0))}</span></div><div class="duplicate-card-body">${options.renderIcon(file)}<div class="duplicate-card-info"><div class="duplicate-card-name" title="${name}">${name}</div><div class="duplicate-card-meta">${options.formatDate(file.createdTime)} · ${file.ownedByMe ? t('misc.me', 'Tôi') : '—'}</div><div class="duplicate-card-path" title="${path}">Đường dẫn: ${path}</div></div></div>${canDelete ? `<button class="duplicate-card-delete" data-file-id="${file.id}" data-file-name="${name}"><i class="fas fa-trash"></i> ${t('dupe.deleteBtn', 'Xóa bản sao')}</button>` : ''}</div>`;
    }).join('');
    list.querySelectorAll('.duplicate-card-delete').forEach(button => button.onclick = event => {
      event.stopPropagation();
      const candidateId = button.dataset.fileId;
      const candidateName = button.dataset.fileName;
      close();
      options.confirmAction(t('delete.confirm', 'Chuyển "{n}" vào thùng rác?').replace('{n}', candidateName), async () => {
        const fresh = getDuplicateComparison(options.getFiles(), options.sourceFileId);
        const candidate = fresh.duplicates.find(file => file.id === candidateId);
        if (!candidate || !canManageDuplicate(candidate)) return;
        const operation = await options.requireCleanupMutation(candidateId);
        if (!operation) return;
        try {
          if (!canManageDuplicate(options.getFiles().find(item => item.id === candidateId))) return;
          await options.deleteFile(candidateId);
          const file = options.getFiles().find(item => item.id === candidateId);
          if (file) file.trashed = true;
          await options.logAction({ type: 'delete_duplicate', fileId: candidateId, fileName: file?.name || candidateName, fileSize: file?.size, actionLabel: 'Xóa bản trùng' }, operation);
          await options.onMutationSuccess?.(file);
          options.toast.success(t('delete.success', 'Đã chuyển "{n}" vào thùng rác.').replace('{n}', candidateName));
        } catch (error) { await import('./actions.js').then(({ failReservedCleanup }) => failReservedCleanup(operation)); options.toast.error(t('delete.error', 'Không thể xóa file: ') + error.message); }
      });
    });
  };
  render();
}
import { canCurrentAccountManageSharing } from './drive.js';
import { areSameFileFormat } from './duplicate-format.js';
import { createFilePathResolver } from './file-path.js';
