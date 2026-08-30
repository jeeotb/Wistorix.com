/**
 * Wistorix Dashboard — Phiên bản chuyên nghiệp
 * Cấu trúc: FileAnalyzer | UIController | DuplicateDetector
 *
 * FIXES APPLIED:
 *  [FIX 1] updateDocumentMap: tách _renderSidebarTree ra khỏi điều kiện !listEl
 *           → sidebar tree luôn được render sau khi scan
 *  [FIX 2] Card "File công khai": thêm f.ownedByMe vào cả updateStats & _applyFilterExtended
 *           → chỉ đếm file công khai do mình sở hữu
 *  [FIX 3] STALE_THRESHOLD_DAYS đổi thành `let`, đọc/ghi từ chrome.storage.sync
 *           → setting "Số ngày cập nhật gần đây" hoạt động realtime
 *
 * CHANGES v2.1:
 *  [YC1] fmt() — Intl.NumberFormat, áp dụng thống nhất cho tất cả số động
 *
 * CHANGES v2.2 — Trash System:
 *  [TRASH-FIX] scanDrive không còn lọc trashed=false → card Thùng rác đọc đúng
 *  [TRASH-1]   _syncKPIAfterChange() — cập nhật 8 KPI cards ngay sau mỗi thao tác
 *  [TRASH-2]   handleDeleteClick()   — sau trash: gọi _syncKPIAfterChange + _applyFull
 *  [TRASH-3]   handleRestoreClick()  — Khôi phục file từ Trash, cập nhật cards
 *  [TRASH-4]   handlePermanentDeleteClick() — Xóa vĩnh viễn với confirm dialog
 *  [TRASH-5]   _buildRow(): file trashed → render Khôi phục + Xóa vĩnh viễn
 *                           file bình thường → render Vào thùng rác
 *  [TRASH-6]   BulkActionBar._handleDelete() → gọi _syncKPIAfterChange sau bulk
 *  [TRASH-7]   updateStats(): countPublic thêm !f.trashed để không đếm file đã trash
 *  [TRASH-8]   i18n keys mới: action.restore, restore.*, action.deletePermanent,
 *              perm.delete.*, bulk.restore*, bulk.restoreConfirm/Success/Fail
 */
import { getAuthToken, getAuthTokenSilently } from './modules/auth.js';
import { scanDrive, loadFilesFromCache, deleteFile, restoreFile, permanentlyDeleteFile, getFilePermissions, getFileOwner, getFileMetadata, removeCachedPermission, revokePermission, getStartPageToken, transferOwnership, isConsentRequiredError, canCurrentAccountManageSharing, fetchGoogleApiWithAuthRetry } from './modules/drive.js';
import { formatBytes, formatDate, getDisplayTimestamps } from './modules/utils.js';

window.WistorixDisplayTimestamps = getDisplayTimestamps;
import { SmartDownloader } from './modules/download.js';
import { trackEvent } from './src/analytics.js';
import { createPaymentLink, validateLicense, getLicenseInfo, saveLicenseInfo, clearLicenseInfo, calculateDaysRemaining, isLifetime, isExpired, isNearExpiry, getCloudFunctionBase } from './modules/payos.js';
import { initProfile } from './modules/profile.js';
import { calculateSecurityScore, classifyRiskScore } from './modules/security-score.js';
import { failReservedCleanup, logAction, logActionsBulk, requireCleanupCredit } from './modules/actions.js';
import { getActiveAccountId, getActiveAccount } from './modules/account-manager.js';
import { computeSharingMetrics, computeStorageMetrics, isPublicFile } from './modules/dashboard-metrics.js';
import { openDuplicateActionModal } from './modules/duplicate-action.js';
import { activateReferralAfterFirstScan } from './modules/referral.js';
import { ownershipRequestMessage, submitOwnershipRequest } from './modules/ownership-request.js';
import { getInheritedParentId, handleInheritedPermissionRevoke, openOwnershipRequestModal as openSharedOwnershipRequestModal, openOwnershipTransferModal as openSharedOwnershipTransferModal } from './modules/action-modals.js';
import { resolveInheritedPermissionSource } from './modules/inherited-permission-source.js';
import { getSharingDisplay } from './modules/sharing-display.js';
import { PreviewController } from './modules/quick-preview.js';
import { sortAnalysisFiles } from './modules/analysis-table-sort.js';
import { getDuplicateGroupingKey } from './modules/duplicate-format.js';
import { createDuplicateIndex } from './modules/duplicate-index.js';
import { shouldOpenDashboardRowPreview } from './modules/dashboard-row-event.js';
import { matchesFileTypeFilter, populateFileTypeFilter } from './modules/file-type-filter.js';

/* ================================================================
   HELPER: safeStorage — chrome.storage with localStorage fallback
   ================================================================ */
const safeStorage = {
    get(keys) {
        return new Promise(resolve => {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
                chrome.storage.sync.get(keys, data => resolve(data));
            } else {
                const result = {};
                const arr = Array.isArray(keys) ? keys : [keys];
                arr.forEach(k => {
                    try { result[k] = JSON.parse(localStorage.getItem('ws_' + k)); } catch(e) { result[k] = null; }
                });
                resolve(result);
            }
        });
    },
    set(obj) {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.set(obj);
        } else {
            Object.entries(obj).forEach(([k, v]) => {
                try { localStorage.setItem('ws_' + k, JSON.stringify(v)); } catch(e) {}
            });
        }
    }
};

/* ================================================================
   HELPER: escapeHtml
   ================================================================ */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/* ================================================================
   HELPER: fmt — Format số có dấu phân cách hàng nghìn
   ================================================================ */
const fmt = (n) => new Intl.NumberFormat('en-US').format(Number(n) || 0);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Ownership transfer deliberately uses an extension modal instead of browser
// prompt/confirm APIs.  It supports the same recipient for a safe bulk batch.
function legacyOpenOwnershipTransferModal(files) {
    return new Promise((resolve) => {
        const selected = Array.isArray(files) ? files : [];
        const isBulk = selected.length > 1;
        const owners = [...new Set(selected.map(f => f.owners?.[0]?.emailAddress).filter(Boolean))];
        const fileLabel = isBulk ? `${selected.length} file đã chọn` : (selected[0]?.name || '—');
        const ownerLabel = owners.length === 1 ? owners[0] : (owners.length ? 'Nhiều chủ sở hữu' : 'Không xác định');
        const overlay = document.createElement('div');
        overlay.className = 'wix-modal-overlay';
        overlay.style.display = 'flex';
        overlay.style.zIndex = '100001';
        overlay.innerHTML = `
            <div class="wix-modal" role="dialog" aria-modal="true" aria-labelledby="transfer-modal-title" style="width:min(520px,calc(100vw - 32px));padding:0;overflow:hidden;">
                <div style="display:flex;align-items:flex-start;gap:12px;padding:20px 22px;border-bottom:1px solid #e5e7eb;">
                    <div style="color:#7c3aed;background:#f3e8ff;border-radius:10px;padding:9px 11px;"><i class="fas fa-exchange-alt"></i></div>
                    <div style="flex:1"><h4 id="transfer-modal-title" style="margin:0 0 4px;">Chuyển quyền sở hữu</h4><p style="margin:0;color:#64748b;font-size:13px;">Chuyển quyền sở hữu: ${escapeHtml(fileLabel)}</p></div>
                    <button type="button" data-transfer-close aria-label="Đóng" style="border:0;background:transparent;font-size:22px;line-height:1;color:#64748b;cursor:pointer;">×</button>
                </div>
                <form data-transfer-form style="padding:20px 22px;display:grid;gap:15px;">
                    <label style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:.04em;">FILE SẼ CHUYỂN<input readonly value="${escapeHtml(fileLabel)}" style="display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;border:1px solid #dbe3ef;border-radius:7px;background:#f8fafc;color:#334155;"></label>
                    <label style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:.04em;">CHỦ SỞ HỮU HIỆN TẠI<input readonly value="${escapeHtml(ownerLabel)}" style="display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;border:1px solid #dbe3ef;border-radius:7px;background:#f8fafc;color:#334155;"></label>
                    <label style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:.04em;">EMAIL CHỦ SỞ HỮU MỚI<input data-transfer-email type="email" placeholder="vd: quanly@company.com" autocomplete="email" style="display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;border:1px solid #cbd5e1;border-radius:7px;"></label>
                    <div style="padding:10px 12px;border-radius:7px;background:#eef6ff;color:#475569;font-size:12px;line-height:1.45;">⚠ Sau khi chuyển, bạn trở thành người chỉnh sửa. Chủ sở hữu mới nên cùng tổ chức Google Workspace để nhận quyền ngay.</div>
                    <p data-transfer-error style="margin:0;color:#dc2626;font-size:12px;display:none;"></p>
                    <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:4px;">
                        <button type="button" data-transfer-close class="wix-btn wix-btn--ghost wix-btn--sm">Hủy</button>
                        <button type="submit" class="wix-btn wix-btn--primary wix-btn--sm">Chuyển quyền</button>
                    </div>
                </form>
            </div>`;
        const close = () => { overlay.remove(); resolve(null); };
        overlay.querySelectorAll('[data-transfer-close]').forEach(btn => btn.addEventListener('click', close));
        overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
        const input = overlay.querySelector('[data-transfer-email]');
        const error = overlay.querySelector('[data-transfer-error]');
        overlay.querySelector('[data-transfer-form]').addEventListener('submit', (event) => {
            event.preventDefault();
            const email = input.value.trim().toLowerCase();
            if (!EMAIL_RE.test(email)) {
                error.textContent = 'Vui lòng nhập email hợp lệ.';
                error.style.display = 'block';
                input.focus();
                return;
            }
            if (owners.some(owner => owner.trim().toLowerCase() === email)) {
                error.textContent = 'Email mới phải khác chủ sở hữu hiện tại.';
                error.style.display = 'block';
                input.focus();
                return;
            }
            overlay.remove();
            resolve(email);
        });
        document.body.appendChild(overlay);
        requestAnimationFrame(() => input.focus());
    });
}

// Request is email-only; ownership transfer remains owner-initiated in Drive.
async function legacyOpenOwnershipRequestModal(files) {
    const selected = Array.isArray(files) ? files.filter(file => file && !file.trashed && !file.ownedByMe) : [];
    if (!selected.length) {
        Toast.warning('Chỉ có thể yêu cầu sở hữu với tệp đang được chia sẻ cho bạn.');
        return;
    }

    const ownerGroups = new Map();
    for (const file of selected) {
        let ownerEmail = file.owners?.find(owner => EMAIL_RE.test(String(owner?.emailAddress || '').trim()))?.emailAddress || '';
        if (!ownerEmail) {
            try { ownerEmail = (await getFileOwner(file.id))?.emailAddress || ''; } catch (_) {}
        }
        ownerEmail = ownerEmail.trim().toLowerCase();
        if (!EMAIL_RE.test(ownerEmail)) {
            Toast.error('Không xác định được email chủ sở hữu hiện tại.');
            return;
        }
        if (!ownerGroups.has(ownerEmail)) ownerGroups.set(ownerEmail, []);
        ownerGroups.get(ownerEmail).push(file);
    }

    if (ownerGroups.size !== 1) {
        Toast.warning('Các file đã chọn có nhiều chủ sở hữu. Hãy chọn các file cùng một chủ sở hữu.');
        return;
    }

    const [ownerEmail, ownerFiles] = [...ownerGroups.entries()][0];
    const fileLabel = ownerFiles.length > 1 ? `${ownerFiles.length} file đã chọn` : ownerFiles[0].name || '—';
    const overlay = document.createElement('div');
    overlay.className = 'wix-modal-overlay ownership-request-overlay';
    overlay.innerHTML = `
        <div class="wix-modal ownership-request-modal" role="dialog" aria-modal="true" aria-labelledby="ownership-request-title">
            <header class="ownership-request-modal__header">
                <div class="ownership-request-modal__heading"><span class="ownership-request-modal__icon"><i class="fas fa-envelope"></i></span><div><h4 id="ownership-request-title">Yêu cầu chuyển giao quyền</h4><p>Yêu cầu chuyển quyền: ${escapeHtml(fileLabel)}</p></div></div>
                <button type="button" class="ownership-request-modal__close" data-request-close aria-label="Đóng">×</button>
            </header>
            <form class="ownership-request-modal__body" data-request-form>
                <label class="ownership-request-modal__label">GỬI TỚI (CHỦ SỞ HỮU HIỆN TẠI)<input readonly value="${escapeHtml(ownerEmail)}" aria-label="Chủ sở hữu hiện tại"></label>
                <fieldset class="ownership-request-modal__methods"><legend class="ownership-request-modal__label">PHƯƠNG THỨC GỬI</legend>
                    <label class="ownership-request-modal__method is-selected"><input type="radio" name="ownership-request-method" value="email" checked><span class="ownership-request-modal__method-icon"><i class="fas fa-envelope"></i></span><span><strong>Gửi email</strong><small>Email kèm liên kết chấp nhận chuyển quyền.</small></span></label>
                    <label class="ownership-request-modal__method is-unavailable" title="Chưa có hệ thống thông báo Wistorix backend."><input type="radio" name="ownership-request-method" value="notification" disabled><span class="ownership-request-modal__method-icon ownership-request-modal__method-icon--warning"><i class="fas fa-bell"></i></span><span><strong>Thông báo trong Wistorix</strong><small>Chưa có hệ thống thông báo Wistorix backend.</small></span></label>
                </fieldset>
                <label class="ownership-request-modal__label">LỜI NHẮN (TÙY CHỌN)<textarea data-request-message maxlength="2000" placeholder="Chào bạn, mình cần tiếp quản các file này để quản lý..."></textarea></label>
                <p class="ownership-request-modal__error" data-request-error hidden></p>
                <footer class="ownership-request-modal__footer"><button type="button" class="wix-btn wix-btn--ghost wix-btn--sm" data-request-close>Hủy</button><button type="submit" class="wix-btn wix-btn--primary wix-btn--sm" data-request-submit><i class="fas fa-envelope"></i> Gửi yêu cầu</button></footer>
            </form>
        </div>`;

    const close = () => overlay.remove();
    overlay.querySelectorAll('[data-request-close]').forEach(button => button.addEventListener('click', close));
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    let submitting = false;
    let fallbackOpened = false;
    overlay.querySelector('[data-request-form]').addEventListener('submit', async event => {
        event.preventDefault();
        if (submitting) return;
        const error = overlay.querySelector('[data-request-error]');
        const submit = overlay.querySelector('[data-request-submit]');
        submitting = true;
        submit.disabled = true;
        error.hidden = true;
        try {
            const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            await submitOwnershipRequest({ fileIds: ownerFiles.map(file => file.id), message: overlay.querySelector('[data-request-message]').value, requestId });
            close();
            Toast.success('Đã gửi yêu cầu chuyển quyền sở hữu. Chủ sở hữu sẽ nhận email.');
        } catch (err) {
            error.textContent = ownershipRequestMessage(err.code) || err.message || 'Không thể gửi yêu cầu. Vui lòng thử lại.';
            error.hidden = false;
        } finally {
            submit.disabled = false;
            submitting = false;
        }
    });
    document.body.appendChild(overlay);
    overlay.querySelector('[data-request-message]').focus();
}


function openOwnershipTransferModal(files) {
    return openSharedOwnershipTransferModal(files);
}

function openOwnershipRequestModal(files) {
    return openSharedOwnershipRequestModal({
        files, getFileOwner, submitOwnershipRequest, ownershipRequestMessage, toast: Toast
    });
}

// ============================================================
// MODULE: I18n — Internationalization
// ============================================================
const I18n = {
    _lang: 'vi',

    _dict: {
        vi: {
            // Nav
            'nav.dashboard':           'Dashboard',
            'nav.settings':            'Cài đặt',
            'nav.label.menu':          'MENU',
            'nav.label.drive':         'GOOGLE DRIVE',
            'nav.empty':               'Chưa có dữ liệu',
            'nav.footer':              'Chrome Extension v2.0',
            // Header
            'header.title':            'Quản lý &amp; Bảo mật Drive',
            'header.sub':              'Phân tích và giám sát toàn bộ tệp Google Drive của bạn',
            'btn.export':              'Xuất báo cáo',
            'btn.analyze':             'Phân tích Drive',
            // KPI cards
            'kpi.totalFiles.label':    'Tổng số files',
            'kpi.totalFiles.sub':      'Tổng số file hiện có trong Google Drive',
            'kpi.issues.label':        'Files nằm ngoài thư mục',
            'kpi.issues.sub':          'File không được tổ chức trong thư mục',
            'kpi.storage.label':       'Dung lượng đã sử dụng',
            'kpi.storage.sub':         'Bấm để xem files của tôi',
            'kpi.stale.label':         'Cập nhật gần đây',
            'kpi.dupes.label':         'Files trùng lặp',
            'kpi.dupes.sub':           'Các file bị trùng nội dung',
            'kpi.public.label':        'Files công khai',
            'kpi.public.sub':          'Có thể truy cập bởi mọi người có liên kết',
            'kpi.public.risk':         'Rủi ro bảo mật',
            'kpi.empty.label':         'File / Folder rỗng',
            'kpi.empty.sub':           'Không chứa dữ liệu hoặc có kích thước 0 byte',
            'kpi.orphan.label':        'File mồ côi',
            'kpi.orphan.sub':          'File không thuộc thư mục nào (orphan files)',
            'kpi.trash.label':         'File trong thùng rác',
            'kpi.trash.sub':           'Có thể xóa vĩnh viễn để giải phóng dung lượng',
            // Chips
            'chip.status':             'TRẠNG THÁI',
            'chip.public':             'Công khai',
            'chip.private':            'Riêng tư',
            'chip.internal':           'Nội bộ',
            'chip.shared':             'Shared',
            'chip.type':               'LOẠI FILE',
            'chip.image':              'Ảnh',
            'chip.video':              'Video',
            'chip.pdf':                'PDF',
            'chip.doc':                'Docs',
            'chip.zip':                'Zip',
            'chip.other':              'Khác',
            'chip.size':               'DUNG LƯỢNG',
            'chip.time':               'THỜI GIAN',
            'chip.special':            'ĐẶC BIỆT',
            'chip.mine':               'Owned by me',
            'chip.sharedWithMe':       'Shared with me',
            'chip.dupes':              'Duplicate files',
            'chip.orphan':             'Orphan files',
            // Table headers
            'th.name':                 'TÊN FILE',
            'th.path':                 'ĐƯỜNG DẪN',
            'th.status':               'TRẠNG THÁI',
            'th.owner':                'CHỦ SỞ HỮU',
            'th.shared':               'CHIA SẺ VỚI',
            'th.size':                 'KÍCH THƯỚC',
            'th.created':              'NGÀY TẠO',
            'th.modified':             'NGÀY SỬA',
            'th.rec':                  'KHUYẾN NGHỊ',
            'th.actions':              'HÀNH ĐỘNG',
            // Actions
            'action.view':             'Xem',
            'action.download':         'Tải',
            'action.permissions':      'Quyền',
            'action.delete':           'Vào thùng rác',
            'action.revoke':           'Thu hồi',
            'action.restore':          'Khôi phục',
            'action.deletePermanent':  'Xóa vĩnh viễn',
            // Badges
            'badge.public':            'Công khai',
            'badge.private':           'Riêng tư',
            'badge.internal':          'Nội bộ',
            'badge.action':            'Cần xử lý',
            'badge.trash':             'Thùng rác',
            // Roles
            'role.reader':             'Người xem',
            'role.writer':             'Người chỉnh sửa',
            'role.commenter':          'Người bình luận',
            // Recommendations
            'rec.safe':                'An toàn',
            'rec.delete':              'Nên xóa',
            'rec.urgent':              'Cần xử lý ngay',
            'rec.organize':            'Cần tổ chức',
            'rec.checkPerm':           'Kiểm tra quyền',
            'rec.requestEdit':         'Xin quyền sửa',
            'rec.archive':             'Nên sao lưu',
            'rec.contactAdmin':        'Liên hệ admin',
            // Toast
            'toast.scanSuccess':       'Phân tích Drive thành công!',
            'toast.scanError':         'Không thể phân tích: Bạn cần cấp quyền đăng nhập Google.',
            'toast.scanNetworkError':  'Lỗi kết nối khi quét Drive. Vui lòng thử lại.',
            'toast.scanRateLimit':     'Google Drive đang giới hạn số yêu cầu (rate limit). Vui lòng chờ vài phút rồi thử lại.',
            'toast.scanScope':         'Quyền truy cập không đủ. Bạn cần cấp thêm quyền cho Drive để quét dữ liệu.',
            'toast.deleteSuccess':     'Đã chuyển vào thùng rác thành công!',
            'toast.revokeSuccess':     'Đã thu hồi quyền thành công!',
            'toast.exportSuccess':     'Báo cáo đã được tạo và mở trên Google Sheets!',
            'toast.settingsSaved':     'Cấu hình đã được lưu thành công!',
            'toast.minInterval':       'Chu kỳ quét tối thiểu là 1 phút!',
            'toast.noData':            'Vui lòng phân tích Drive trước khi xuất báo cáo!',
            'toast.noAuth':            'Không thể xác thực. Vui lòng đăng nhập lại.',
            // Empty states
            'empty.loading':           'Đang phân tích Drive...',
            'empty.clean':             'Drive của bạn sạch 🎉',
            'empty.issues':            'Phát hiện file cần xử lý',
            'empty.init':              'Bấm <strong>Phân tích Drive</strong> để bắt đầu',
            // Share modal
            'modal.notShared':         'Chưa chia sẻ với ai',
            'modal.noOwner':           'Không tìm thấy thông tin chủ sở hữu',
            'modal.public':            '🌐 Bất kỳ ai (Công khai)',
            'modal.domain':            '🏢 Toàn bộ domain: ',
            'modal.group':             '👥 Nhóm: ',
            'modal.unknown':           'Không xác định',
            'modal.noEmail':           'Không rõ',
            'modal.title.noFile':      'Tên file',
            'modal.owner.label':       '👑 Chủ sở hữu:',
            'modal.sharedWith':        '👥 Đang chia sẻ với',
            'modal.sharedUnit':        'người/nhóm',
            'modal.riskHigh':          '🔴 Rủi ro cao — Công khai với bất kỳ ai',
            'modal.adviceHigh':        '💡 <strong>Đề xuất:</strong> Thu hồi quyền công khai nếu không cần thiết.',
            'modal.riskMedium':        '🟡 Nội bộ — Chia sẻ trong tổ chức',
            'modal.adviceMedium':      '💡 <strong>Đề xuất:</strong> Xem xét lại nếu tài liệu chứa thông tin nhạy cảm.',
            'modal.riskSelective':     '🟢 Kiểm soát được — Chia sẻ có chọn lọc',
            'modal.riskPrivate':       '🟢 Riêng tư — Chưa chia sẻ',
            'modal.riskSharedWithMe':  '🟢 File được chia sẻ với bạn',
            'modal.shareLoading':      'Đang tải...',
            'modal.shareError':        'Không thể tải thông tin: ',
            // Scan buttons state
            'btn.connecting':          'Đang kết nối...',
            'btn.analyzing':           'Đang phân tích...',
            'btn.exporting':           'Đang xuất...',
            // Path / misc
            'path.myDrive':            'My Drive',
            'shared.publicLabel':      '🌐 Công khai',
            'misc.me':                 'Tôi',
            'misc.none':               '—',
            'misc.more':               'thêm',
            // Settings
            'settings.title':          'Cài đặt Extension',
            'settings.sub':            'Tùy chỉnh hành vi quét và tự động hóa',
            'settings.scan.title':     'Cấu hình Quét & Hiển thị',
            'settings.auto.title':     'Tự động hóa',
            'settings.save':           'Lưu cấu hình',
            'settings.lang.label':     'Ngôn ngữ hiển thị:',
            'settings.lang.vi':        'Tiếng Việt',
            'settings.lang.en':        'English',
            'settings.lang.desc':      'Thay đổi ngay lập tức.',
            'settings.auto.toggle':    'Bật phân tích Drive tự động',
            'settings.auto.toggleDesc':'Tự động quét và gửi cảnh báo',
            'settings.auto.period':    'Chu kỳ phân tích:',
            'settings.recentDays.label':'Số ngày tính "Cập nhật gần đây":',
            'settings.recentDays.desc':'Card cập nhật ngay khi chọn.',
            'settings.folderSort.label':'Sắp xếp cây thư mục theo:',
            'settings.folderSort.desc':'Áp dụng sau khi bấm Lưu cấu hình.',
            'settings.folderSort.alpha':'Tên (A→Z)',
            'settings.folderSort.sizeDesc':'Dung lượng (Lớn → Nhỏ)',
            'settings.folderSort.sizeAsc':'Dung lượng (Nhỏ → Lớn)',
            'settings.scanUnit.min':   'Phút',
            'settings.scanUnit.hour':  'Giờ',
            'settings.scanUnit.day':   'Ngày',
            'settings.autoInfo':       'Khi bật, Wistorix sẽ tự động phân tích Drive và gửi cảnh báo rủi ro.',
            'settings.recentDays.30':  '30 ngày',
            'settings.recentDays.90':  '90 ngày',
            'settings.recentDays.180': '180 ngày',
            'settings.recentDays.365': '1 năm',
            'settings.unsaved':        'Chưa lưu',
            // KPI card title tooltips
            'kpi.totalFiles.title':    'Xem tất cả file đã quét',
            'kpi.issues.title':        'File nằm trực tiếp trong My Drive (không trong thư mục con)',
            'kpi.storage.title':       'Bấm để xem file của tôi',
            'kpi.stale.title':         'File không được cập nhật trong thời gian cấu hình',
            'kpi.dupes.title':         'File có cùng nội dung',
            'kpi.public.title':        'File đang chia sẻ công khai',
            'kpi.empty.title':         'Thư mục không có nội dung',
            'kpi.orphan.title':        'File không thuộc thư mục nào',
            'kpi.trash.title':         'File đang ở thùng rác',
            // Storage
            'storage.loading':         'Đang tải...',
            'storage.unlimited':       'Dung lượng không giới hạn',
            'storage.usedPct':         'Đã sử dụng {n}% dung lượng lưu trữ',
            'storage.free':            'Còn {n} trống',
            'storage.clickMine':       'Bấm để xem files của tôi',
            // Kept for panel breakdown usage
            'chart.image':             'Ảnh',
            'chart.video':             'Video',
            'chart.doc':               'Tài liệu',
            'chart.other':             'Khác',
            // Card export
            'kpi.export.files':        'Tải {n} files',
            'kpi.export.groups':       'Tải {n} nhóm',
            'kpi.export.btn':          'Tải danh sách',
            'kpi.export.empty':        'Không có dữ liệu để tải.',
            // Permission revoke
            'perm.revoke.title':       'Thu hồi quyền truy cập',
            'perm.revoke.btn':         'Thu hồi',
            'perm.revoke.confirm':     'Thu hồi quyền của "{n}"?\nHọ sẽ không thể truy cập file này nữa.',
            'perm.revoke.success':     'Đã thu hồi quyền của "{n}"',
            'perm.revoke.error':       'Không thể thu hồi: ',

            // Inherited permissions
            'perm.inherited.label':    'Kế thừa',
            'perm.inherited.tooltip':  'Quyền này được kế thừa từ thư mục cha và không thể thu hồi trực tiếp.',
            'perm.inherited.error':    'Quyền này được kế thừa từ thư mục cha — không thể thu hồi trực tiếp. Hãy thay đổi quyền ở thư mục gốc.',
            'perm.sharedDrive.error':  'File nằm trong Shared Drive — không thể thu hồi quyền từ đây. Hãy quản lý qua Google Drive.',
            // Delete → Trash
            'delete.confirm':          'Chuyển "{n}" vào thùng rác?\nBạn có thể khôi phục bất cứ lúc nào từ Google Drive.',
            'delete.success':          'Đã chuyển "{n}" vào thùng rác!',
            'delete.error':            'Không thể chuyển file vào thùng rác: ',
            // Restore from Trash
            'restore.confirm':         'Khôi phục "{n}" về Google Drive?\nFile sẽ trở lại trạng thái bình thường.',
            'restore.success':         'Đã khôi phục "{n}" thành công!',
            'restore.error':           'Không thể khôi phục file: ',
            // Permanently delete
            'perm.delete.confirm':     'Bạn có chắc muốn xóa vĩnh viễn "{n}"?\nHành động này không thể hoàn tác và file sẽ biến mất khỏi Google Drive.',
            'perm.delete.success':     'Đã xóa vĩnh viễn "{n}"!',
            'perm.delete.error':       'Không thể xóa vĩnh viễn: ',
            // Bulk actions
            'bulk.revoke':             'Thu hồi quyền',
            'bulk.revokeConfirm':      'Thu hồi toàn bộ quyền chia sẻ của {n} file đã chọn?\nHành động này sẽ xóa tất cả quyền truy cập (public, domain, email).',
            'bulk.revokeSuccess':      'Đã thu hồi quyền {n} file thành công!',
            'bulk.revokeFail':         'Không thể thu hồi quyền {n} file.',
            'bulk.selected':           '{n} file đã chọn',
            'bulk.download':           'Tải xuống',
            'bulk.delete':             'Vào thùng rác',
            'bulk.deselect':           'Bỏ chọn',
            'bulk.confirmDelete':      'Chuyển {n} file đã chọn vào thùng rác?\nBạn có thể khôi phục từ Google Drive Thùng rác.',
            'bulk.deleteSuccess':      'Đã chuyển {n} file vào thùng rác!',
            'bulk.deleteFail':         'Không thể chuyển {n} file vào thùng rác.',
            'bulk.restore':            'Khôi phục',
            'bulk.restoreConfirm':     'Khôi phục {n} file đã chọn khỏi thùng rác?',
            'bulk.restoreSuccess':     'Đã khôi phục {n} file thành công!',
            'bulk.restoreFail':        'Không thể khôi phục {n} file.',
            'bulk.noDownloadable':     'Không có file nào có thể tải xuống.',
            // Dupes
            'toast.dupesFound':        'Phát hiện {groups} nhóm file trùng lặp ({files} file)',
            'toast.noDupes':           'Không có file trùng lặp nào!',
            // Filter labels
            'filter.all':              'Tất cả file',
            'filter.issues':           'Files nằm ngoài thư mục',
            'filter.mine':             'File của tôi',
            'filter.stale':            'File cũ (>{n} ngày)',
            'filter.dupes':            'File trùng lặp',
            'filter.public':           'File công khai',
            'filter.empty':            'File / Folder rỗng',
            'filter.orphan':           'File mồ côi',
            'filter.trash':            'File trong thùng rác',
            // KPI dynamic
            'kpi.stale.label':         'Không cập nhật gần đây',
            'kpi.stale.subDays':       'Cũ {n}+ ngày',
            'kpi.dupes.groups':        '{n} nhóm',
            // Pagination
            'page.prev':               '‹ Trước',
            'page.next':               'Sau ›',
            // Search
            'search.placeholder':      'Tìm kiếm file...',
            // Table card
            'table.title':             'Danh sách tệp tin',
            'btn.resetFilters':        'Tất cả',
            // File type dropdown
            'filetype.all':            'Tất cả loại',
            'filetype.image':          'Hình ảnh',
            'filetype.video':          'Video',
            'filetype.audio':          'Audio',
            'filetype.document':       'Tài liệu',
            'filetype.spreadsheet':    'Bảng tính',
            'filetype.presentation':   'Trình chiếu',
            'filetype.pdf':            'PDF',
            'filetype.zip':            'File nén',
            'filetype.folder':         'Thư mục',
            // Shared tag
            'shared.publicTag':        '🌐 Công khai',
            // Export CSV
            'export.noData':           'Vui lòng phân tích Drive trước khi xuất báo cáo!',
            'export.error':            'Không thể xuất báo cáo: ',
            'export.csv.header':       'Tên File,Trạng thái,Mức độ,Khuyến nghị,Dung lượng (bytes),Kích thước,Loại,Ngày tạo,Link',
            'export.severity.high':    'Rủi ro cao',
            'export.severity.medium':  'Cảnh báo',
            'export.severity.low':     'An toàn',
            // Confirm modal
            'confirm.title':           'Xác nhận hành động',
            'confirm.default':         'Bạn có chắc muốn thực hiện hành động này?',
            'confirm.ok':              'Xác nhận',
            'confirm.cancel':          'Hủy',
            // Time chips
            'chip.time7':              '7 ngày',
            'chip.time30':             '30 ngày',
            'chip.time90':             '90 ngày',
            'chip.timeCustom':         'Tùy chỉnh',
            // Download modal
            'dl.title':                'Tải an toàn',
            'dl.downloaded':           'Đã tải:',
            'dl.threads':              'Luồng:',
            'dl.cancel':               'Hủy tải',
            'dl.preparing':            '⏳ Đang chuẩn bị tải...',
            'dl.inProgress':           '⬇️ Đang tải xuống...',
            'dl.complete':             '✅ Tải hoàn tất!',
            'dl.completePct':          '100% — Hoàn tất',
            'dl.bulkComplete':         '✅ Đã tải {n} file!',
            'dl.failed':               '❌ Tải thất bại',
            'dl.error':                'Lỗi',
            'dl.error403':             'Không có quyền tải file này (lỗi 403).',
            'dl.preparing.bulk':       '⏳ Đang chuẩn bị...',

            // Tabs
            'tab.overview':            'Tổng quan',
            'tab.filelist':            'Phân tích chi tiết',

            // Security score
            'security.title':          'Điểm bảo mật Drive',
            'security.bad':            'Rủi ro cao',
            'security.good':           'An toàn',
            'security.improve':        'Cần cải thiện',
            'security.excellent':      'Tuyệt vời',
            'security.desc':           '{n} vấn đề đang kéo điểm xuống. Xử lý hết để đạt tối đa 100 — quét lần cuối {time}.',
            'security.descClean':      'Tất cả vấn đề đã được xử lý. Drive của bạn an toàn!',
            'security.how':            'Cách tính điểm này →',

            // Scan time
            'scan.label':              'Quét lần cuối:',
            'scan.rescan':             'Quét lại',
            'scan.today':              'hôm nay, {time}',

            // Alert summary
            'alert.riskTitle':         '{n} vấn đề cần xử lý ngay',
            'alert.riskSub':           'Phát hiện trong lần quét gần nhất · Hôm nay lúc {time}',
            'alert.cleanTitle':        'Drive của bạn hoàn toàn sạch!',
            'alert.cleanDesc':         'Tất cả 3 vấn đề đã được xử lý · Không còn rủi ro bảo mật · Dữ liệu được bảo vệ tối đa',
            'alert.issue.publicTitle': 'Files đang công khai',
            'alert.issue.publicDesc':  'Bất kỳ ai có liên kết đều có thể truy cập',
            'alert.issue.staleTitle':  'File cũ',
            'alert.issue.staleDesc':   'Files cũ chiếm dung lượng không cần thiết',
            'alert.issue.dupesTitle':  'Files trùng lặp',
            'alert.issue.dupesDesc':   'Đang lãng phí dung lượng Drive',
            'alert.btn.revoke':        'Thu hồi quyền',
            'alert.btn.cleanup':       'Dọn dẹp',
            'alert.btn.deleteDupes':   'Xóa bản sao',

            // Section labels
            'section.needAction':      'CẦN XỬ LÝ',
            'section.issueCount':      '{n} vấn đề phát hiện',
            'section.driveInfo':       'THÔNG TIN DRIVE',

            // Risk cards
            'risk.high':               'Rủi ro cao',
            'risk.review':             'Cần xem lại',
            'risk.waste':              'Lãng phí',
            'risk.resolved':           'Đã xử lý',
            'risk.publicLabel':        'Files công khai',
            'risk.publicSub':          'Có thể truy cập bởi bất kỳ ai có liên kết',
            'risk.staleLabel':         'Cũ {n}+ ngày',
            'risk.staleSub':           'Files lâu không sử dụng, có thể dọn dẹp',
            'risk.dupesLabel':         'Files trùng lặp',
            'risk.dupesSub':           'Các file bị trùng nội dung, chiếm dung lượng thừa',
            'risk.dupesGroups':        '{n} nhóm',

            // Info badges
            'info.normal':             'Bình thường',
            'info.ok':                 'Ổn',
            'info.noData':             'Không có dữ liệu',

            // Action section
            'action.sectionTitle':     'Bước tiếp theo — Xử lý các vấn đề phát hiện',
            'action.revokeTitle':      'Thu hồi quyền công khai',
            'action.revokeDesc':       '{n} file đang lộ ra ngoài — cần xử lý ngay để bảo vệ dữ liệu.',
            'action.revokeBtn':        'Xử lý ngay →',
            'action.cleanTitle':       'Dọn dẹp file cũ 180+ ngày',
            'action.cleanDesc':        '{n} file không còn sử dụng — giải phóng dung lượng Drive.',
            'action.cleanBtn':         'Dọn dẹp →',
            'action.dupesTitle':       'Xóa bản sao trùng lặp',
            'action.dupesDesc':        '{n} nhóm file trùng — tiết kiệm dung lượng ngay lập tức.',
            'action.dupesBtn':         'Xóa bản sao →',

            // Alert banner
            'banner.publicText':       'Files đang công khai — cần thu hồi quyền từng file',
            'banner.viewAll':          'Xem tất cả',

            // Table
            'th.access':               'QUYỀN TRUY CẬP',
            'access.public':           'Bất kỳ ai có liên kết',
            'access.domain':           'Nội bộ tổ chức',
            'access.shared':           'Chia sẻ email',
            'access.private':          'Riêng tư',
            'access.sharedPlus':       'Bất kỳ ai + {n} email',

            // Panel
            'panel.selected':          'Danh mục đã chọn',
            'panel.breakdown':         'PHÂN LOẠI',
            'panel.sampleFiles':       'FILE TIÊU BIỂU',
            'panel.viewAll':           'Xem tất cả',
            'panel.downloadAll':       'Tải toàn bộ danh sách',

            // Risk card buttons
            'risk.btn.revoke':         'Thu hồi quyền',
            'risk.btn.cleanup':        'Dọn dẹp hàng loạt',
            'risk.btn.deleteDupes':    'Xóa bản sao',

            // Info card button
            'info.btn.download':       'Tải danh sách',
            'info.btn.analyze':        'Phân tích chi tiết',
            'info.btn.organize':       'Tự động sắp xếp',
            'info.btn.deleteEmpty':    'Xóa tất cả rỗng',

            // Scan flow
            'scan.start.subtitle':     'Kết nối thành công — sẵn sàng quét Drive của bạn',
            'scan.start.btn':          'QUÉT DỮ LIỆU NGAY',
            'scan.start.meta':         '~60 giây · An toàn',
            'scan.progress.title':     'Đang phân tích Google Drive của bạn...',
            'scan.progress.pctUnit':   '% HOÀN THÀNH',
            'scan.progress.public':    'File công khai',
            'scan.progress.stale':     'File 180+ ngày',
            'scan.progress.dupes':     'File trùng lặp',
            'scan.progress.scanning':  'Đang quét metadata...',
            'scan.progress.hint':      '+{n} files rủi ro vừa được phát hiện',
            'scan.result.title':       'Kết quả phân tích · {n} files',
            'scan.result.riskLabel':   'RISK SCORE',
            'scan.result.high':        'Rủi ro cao',
            'scan.result.medium':      'Rủi ro trung bình',
            'scan.result.low':         'An toàn',
            'scan.result.public':      'công khai',
            'scan.result.stale':       'cũ {n}+ ngày',
            'scan.result.dupes':       'trùng lặp',
            'scan.result.actionBtn':   'Xem Dashboard để xử lý →',
            'scan.result.footer':      'Xử lý xong có thể đạt Risk Score 100 🏆',

            // New action buttons
            'action.transferOwnership':'Chuyển quyền sở hữu',
            'action.requestOwnership': 'Xin quyền sở hữu',
            'action.stopSharing':      'Ngừng chia sẻ',
            'action.compareDuplicates':'So sánh bản trùng',
            // Share V2 modal
            'shareV2.title':           'Đang chia sẻ với',
            'shareV2.revokeAll':       'Thu hồi tất cả',
            'shareV2.revokeAllConfirm':'Thu hồi tất cả quyền chia sẻ của file này?\nHành động này sẽ xóa toàn bộ quyền truy cập.',
            'shareV2.revokeAllSuccess':'Đã thu hồi tất cả quyền chia sẻ!',
            'shareV2.noPermission':    'Chưa chia sẻ với ai',
            // Duplicate modal
            'dupe.title':              'So sánh bản trùng',
            'dupe.subtitle':           'Các file có nội dung trùng khớp 100%',
            'dupe.alert':              'Đối chiếu theo nội dung & dung lượng (mã băm dữ liệu) — các bản dưới đây trùng khớp 100%, không xét tên file. Giữ 1 bản, xóa các bản còn lại để tiết kiệm dung lượng.',
            'dupe.footerInfo':         'Bản bị xóa sẽ chuyển vào Thùng rác của Google Drive — khôi phục được trong ~30 ngày, không xóa vĩnh viễn.',
            'dupe.remaining':          'Còn {n} bản · xóa bản thừa, giữ lại bản bạn muốn',
            'dupe.keepLabel':          'Giữ lại',
            'dupe.originalLabel':      'Bản gốc',
            'dupe.deleteBtn':          'Xóa bản này',
            'dupe.lastOriginalWarn':   'Phải giữ ít nhất 1 bản gốc',
            // Transfer modal
            'transfer.title':          'Chuyển quyền sở hữu',
            'transfer.desc':           'Nhập email của người dùng mới để chuyển quyền sở hữu file này.',
            'transfer.emailLabel':     'Email người nhận',
            'transfer.emailPlaceholder':'Nhập địa chỉ email...',
            'transfer.btn':            'Chuyển quyền',
            'transfer.success':        'Đã chuyển quyền sở hữu thành công!',
            'transfer.error':          'Không thể chuyển quyền sở hữu: ',
            'transfer.invalidEmail':   'Vui lòng nhập email hợp lệ',
            'transfer.notOwner':       'Bạn không có quyền chuyển quyền sở hữu tệp này.',
            'transfer.alreadyOwner':   'Email này đã là chủ sở hữu của tệp.',
            'transfer.pending':        'Đã gửi lời mời chuyển quyền sở hữu tới email này. Người nhận cần mở email và chấp nhận quyền sở hữu trước khi hoàn tất.',
            'transfer.pendingAgain':   'Lời mời chuyển quyền sở hữu đã được gửi trước đó. Người nhận cần chấp nhận quyền sở hữu trong email để hoàn tất.',
            'transfer.consentPolicy':  'Google Drive yêu cầu người nhận xác nhận quyền sở hữu trước. Hãy yêu cầu người nhận kiểm tra email và chấp nhận lời mời.',
            'transfer.domainPolicy':   'Không thể chuyển quyền sở hữu cho email này do chính sách Google Drive hoặc giới hạn domain.',
            'transfer.sharedDrive':    'File nằm trong Shared Drive, không hỗ trợ chuyển quyền sở hữu.',
            'transfer.trashed':        'Không thể chuyển quyền sở hữu file trong Thùng rác.',
            // Request ownership modal
            'request.title':           'Xin quyền sở hữu',
            'request.desc':            'Bạn không sở hữu file này. Gửi yêu cầu xin quyền sở hữu (cần chủ sở hữu xác nhận).',
            'request.btn':             'Gửi yêu cầu',
            'request.success':         'Đã gửi yêu cầu xin quyền sở hữu!',
            'request.error':           'Không thể gửi yêu cầu: ',
            // Progress circle labels
            'progress.public':         'Công khai',
            'progress.stale':          'File cũ',
            'progress.dupes':          'Trùng lặp',
            // Deduction labels
            'deduction.public':        'Công khai',
            'deduction.stale':         'File cũ',
            'deduction.dupes':         'Trùng lặp',
            'deduction.fixBtn':        'Xử lý hết → +',
            'deduction.fixBtnSuffix':  ' điểm',
            // Demo toggle
            'demo.risk':               'Có rủi ro',
            'demo.clean':              'Drive sạch',
            // Auth screen
            'auth.title':              'Quản lý Drive',
            'auth.titleAccent':        'thông minh hơn',
            'auth.desc':               'Phát hiện file rủi ro, trùng lặp và dung lượng lãng phí trong Google Drive — chỉ trong 60 giây.',
            'auth.feat.scan':          'Quét toàn bộ Drive',
            'auth.feat.risk':          'Phát hiện rủi ro',
            'auth.feat.oneclick':      'Xử lý 1 click',
            'auth.feat.privacy':       'Không đọc nội dung',
            'auth.btn':                'Tiếp tục với Google',
            'auth.btnLoading':         'Đang kết nối...',
            'auth.privacy':            'Chỉ đọc metadata · Không lưu nội dung',
            'auth.privacyLink':        'Chính sách bảo mật',
            'auth.error':              'Không thể kết nối với Google. Vui lòng thử lại.',
        },

        en: {
            // Nav
            'nav.dashboard':           'Dashboard',
            'nav.settings':            'Settings',
            'nav.label.menu':          'MENU',
            'nav.label.drive':         'GOOGLE DRIVE',
            'nav.empty':               'No data yet',
            'nav.footer':              'Chrome Extension v2.0',
            // Header
            'header.title':            'Drive Management &amp; Security',
            'header.sub':              'Analyze and monitor all your Google Drive files',
            'btn.export':              'Export report',
            'btn.analyze':             'Analyze Drive',
            // KPI cards
            'kpi.totalFiles.label':    'Total files',
            'kpi.totalFiles.sub':      'Total files in your Google Drive',
            'kpi.issues.label':        'Files outside folders',
            'kpi.issues.sub':          'Files not organized in folders',
            'kpi.storage.label':       'Storage used',
            'kpi.storage.sub':         'Click to view my files',
            'kpi.stale.label':         'Recently updated',
            'kpi.dupes.label':         'Duplicate files',
            'kpi.dupes.sub':           'Files with duplicate content',
            'kpi.public.label':        'Public files',
            'kpi.public.sub':          'Accessible by anyone with the link',
            'kpi.public.risk':         'Security risk',
            'kpi.empty.label':         'Empty files / folders',
            'kpi.empty.sub':           'Contains no data or zero bytes',
            'kpi.orphan.label':        'Orphan files',
            'kpi.orphan.sub':          'Files not belonging to any folder',
            'kpi.trash.label':         'Files in trash',
            'kpi.trash.sub':           'Can be permanently deleted to free storage',
            // Chips
            'chip.status':             'STATUS',
            'chip.public':             'Public',
            'chip.private':            'Private',
            'chip.internal':           'Internal',
            'chip.shared':             'Shared',
            'chip.type':               'FILE TYPE',
            'chip.image':              'Image',
            'chip.video':              'Video',
            'chip.pdf':                'PDF',
            'chip.doc':                'Docs',
            'chip.zip':                'Zip',
            'chip.other':              'Other',
            'chip.size':               'SIZE',
            'chip.time':               'TIME',
            'chip.special':            'SPECIAL',
            'chip.mine':               'Owned by me',
            'chip.sharedWithMe':       'Shared with me',
            'chip.dupes':              'Duplicate files',
            'chip.orphan':             'Orphan files',
            // Table headers
            'th.name':                 'FILE NAME',
            'th.path':                 'PATH',
            'th.status':               'STATUS',
            'th.owner':                'OWNER',
            'th.shared':               'SHARED WITH',
            'th.size':                 'SIZE',
            'th.created':              'CREATED',
            'th.modified':             'MODIFIED',
            'th.rec':                  'RECOMMENDATION',
            'th.actions':              'ACTIONS',
            // Actions
            'action.view':             'View',
            'action.download':         'Download',
            'action.permissions':      'Permissions',
            'action.delete':           'Move to Trash',
            'action.revoke':           'Revoke',
            'action.restore':          'Restore',
            'action.deletePermanent':  'Delete permanently',
            // Badges
            'badge.public':            'Public',
            'badge.private':           'Private',
            'badge.internal':          'Internal',
            'badge.action':            'Action needed',
            'badge.trash':             'Trash',
            // Roles
            'role.reader':             'Viewer',
            'role.writer':             'Editor',
            'role.commenter':          'Commenter',
            // Recommendations
            'rec.safe':                'Safe',
            'rec.delete':              'Should delete',
            'rec.urgent':              'Urgent action',
            'rec.organize':            'Needs organizing',
            'rec.checkPerm':           'Check permissions',
            'rec.requestEdit':         'Request edit access',
            'rec.archive':             'Should archive',
            'rec.contactAdmin':        'Contact admin',
            // Toast
            'toast.scanSuccess':       'Drive analysis complete!',
            'toast.scanError':         'Cannot analyze: Please grant Google login permission.',
            'toast.scanNetworkError':  'Connection error while scanning Drive. Please try again.',
            'toast.scanRateLimit':     'Google Drive is rate-limiting requests. Please wait a few minutes and try again.',
            'toast.scanScope':         'Insufficient permissions. Please grant additional Drive permissions to scan your data.',
            'toast.deleteSuccess':     'Moved to trash successfully!',
            'toast.revokeSuccess':     'Permission revoked successfully!',
            'toast.exportSuccess':     'Report created and opened in Google Sheets!',
            'toast.settingsSaved':     'Settings saved successfully!',
            'toast.minInterval':       'Minimum scan interval is 1 minute!',
            'toast.noData':            'Please analyze Drive before exporting!',
            'toast.noAuth':            'Cannot authenticate. Please sign in again.',
            // Empty states
            'empty.loading':           'Analyzing Drive...',
            'empty.clean':             'Your Drive is clean 🎉',
            'empty.issues':            'Files requiring attention found',
            'empty.init':              'Click <strong>Analyze Drive</strong> to get started',
            // Share modal
            'modal.notShared':         'Not shared with anyone',
            'modal.noOwner':           'Owner information not found',
            'modal.public':            '🌐 Anyone (Public)',
            'modal.domain':            '🏢 Entire domain: ',
            'modal.group':             '👥 Group: ',
            'modal.unknown':           'Unknown',
            'modal.noEmail':           'Unknown',
            'modal.title.noFile':      'File name',
            'modal.owner.label':       '👑 Owner:',
            'modal.sharedWith':        '👥 Shared with',
            'modal.sharedUnit':        'people/groups',
            'modal.riskHigh':          '🔴 High risk — Public to anyone',
            'modal.adviceHigh':        '💡 <strong>Suggestion:</strong> Revoke public access if not needed.',
            'modal.riskMedium':        '🟡 Internal — Shared within organization',
            'modal.adviceMedium':      '💡 <strong>Suggestion:</strong> Review if the document contains sensitive information.',
            'modal.riskSelective':     '🟢 Controlled — Selectively shared',
            'modal.riskPrivate':       '🟢 Private — Not shared',
            'modal.riskSharedWithMe':  '🟢 File shared with you',
            'modal.shareLoading':      'Loading...',
            'modal.shareError':        'Cannot load information: ',
            // Scan buttons state
            'btn.connecting':          'Connecting...',
            'btn.analyzing':           'Analyzing...',
            'btn.exporting':           'Exporting...',
            // Path / misc
            'path.myDrive':            'My Drive',
            'shared.publicLabel':      '🌐 Public',
            'misc.me':                 'Me',
            'misc.none':               '—',
            'misc.more':               'more',
            // Settings
            'settings.title':          'Extension Settings',
            'settings.sub':            'Customize scan behavior and automation',
            'settings.scan.title':     'Scan & Display Configuration',
            'settings.auto.title':     'Automation',
            'settings.save':           'Save settings',
            'settings.lang.label':     'Display language:',
            'settings.lang.vi':        'Tiếng Việt',
            'settings.lang.en':        'English',
            'settings.lang.desc':      'Changes immediately.',
            'settings.auto.toggle':    'Enable automatic Drive analysis',
            'settings.auto.toggleDesc':'Auto-scan and send risk alerts',
            'settings.auto.period':    'Scan interval:',
            'settings.recentDays.label':'Days to consider "recently updated":',
            'settings.recentDays.desc':'Card updates immediately on selection.',
            'settings.folderSort.label':'Sort folder tree by:',
            'settings.folderSort.desc':'Applied after clicking Save Settings.',
            'settings.folderSort.alpha':'Name (A→Z)',
            'settings.folderSort.sizeDesc':'Size (Largest → Smallest)',
            'settings.folderSort.sizeAsc':'Size (Smallest → Largest)',
            'settings.scanUnit.min':   'Minutes',
            'settings.scanUnit.hour':  'Hours',
            'settings.scanUnit.day':   'Days',
            'settings.autoInfo':       'When enabled, Wistorix will automatically analyze Drive and send risk alerts.',
            'settings.recentDays.30':  '30 days',
            'settings.recentDays.90':  '90 days',
            'settings.recentDays.180': '180 days',
            'settings.recentDays.365': '1 year',
            'settings.unsaved':        'Unsaved',
            // KPI card title tooltips
            'kpi.totalFiles.title':    'View all scanned files',
            'kpi.issues.title':        'Files directly in My Drive root (not in any subfolder)',
            'kpi.storage.title':       'Click to view my files',
            'kpi.stale.title':         'Files not updated within the configured period',
            'kpi.dupes.title':         'Files with identical content',
            'kpi.public.title':        'Files shared publicly',
            'kpi.empty.title':         'Folders with no content',
            'kpi.orphan.title':        'Files not belonging to any folder',
            'kpi.trash.title':         'Files currently in trash',
            // Storage
            'storage.loading':         'Loading...',
            'storage.unlimited':       'Unlimited storage',
            'storage.usedPct':         'Used {n}% of storage',
            'storage.free':            '{n} free',
            'storage.clickMine':       'Click to view my files',
            // Kept for panel breakdown usage
            'chart.image':             'Images',
            'chart.video':             'Video',
            'chart.doc':               'Documents',
            'chart.other':             'Other',
            // Card export
            'kpi.export.files':        'Download {n} files',
            'kpi.export.groups':       'Download {n} groups',
            'kpi.export.btn':          'Download list',
            'kpi.export.empty':        'No data to download.',
            // Permission revoke
            'perm.revoke.title':       'Revoke access',
            'perm.revoke.btn':         'Revoke',
            'perm.revoke.confirm':     'Revoke access for "{n}"?\nThey will no longer be able to access this file.',
            'perm.revoke.success':     'Access revoked for "{n}"',
            'perm.revoke.error':       'Cannot revoke: ',

            // Inherited permissions
            'perm.inherited.label':    'Inherited',
            'perm.inherited.tooltip':  'This permission is inherited from a parent folder and cannot be revoked directly.',
            'perm.inherited.error':    'This permission is inherited from a parent folder — cannot revoke directly. Change permissions at the source folder.',
            'perm.sharedDrive.error':  'File is in a Shared Drive — cannot revoke from here. Manage via Google Drive.',
            // Delete → Trash
            'delete.confirm':          'Move "{n}" to trash?\nYou can restore it anytime from Google Drive.',
            'delete.success':          'Moved "{n}" to trash!',
            'delete.error':            'Cannot move file to trash: ',
            // Restore from Trash
            'restore.confirm':         'Restore "{n}" to Google Drive?\nThe file will return to its normal state.',
            'restore.success':         'Restored "{n}" successfully!',
            'restore.error':           'Cannot restore file: ',
            // Permanently delete
            'perm.delete.confirm':     'Are you sure you want to permanently delete "{n}"?\nThis action cannot be undone and the file will be gone from Google Drive.',
            'perm.delete.success':     'Permanently deleted "{n}"!',
            'perm.delete.error':       'Cannot permanently delete: ',
            // Bulk actions
            'bulk.revoke':             'Revoke access',
            'bulk.revokeConfirm':      'Revoke all sharing permissions for {n} selected files?\nThis removes public, domain, and email access.',
            'bulk.revokeSuccess':      'Access revoked for {n} files!',
            'bulk.revokeFail':         'Failed to revoke access for {n} files.',
            'bulk.selected':           '{n} files selected',
            'bulk.download':           'Download',
            'bulk.delete':             'Move to Trash',
            'bulk.deselect':           'Clear selection',
            'bulk.confirmDelete':      'Move {n} selected files to trash?\nYou can restore them from Google Drive Trash.',
            'bulk.deleteSuccess':      'Moved {n} files to trash!',
            'bulk.deleteFail':         'Could not move {n} files to trash.',
            'bulk.restore':            'Restore',
            'bulk.restoreConfirm':     'Restore {n} selected files from trash?',
            'bulk.restoreSuccess':     'Restored {n} files successfully!',
            'bulk.restoreFail':        'Could not restore {n} files.',
            'bulk.noDownloadable':     'No downloadable files selected.',
            // Dupes
            'toast.dupesFound':        'Found {groups} groups of duplicate files ({files} files)',
            'toast.noDupes':           'No duplicate files found!',
            // Filter labels
            'filter.all':              'All files',
            'filter.issues':           'Files outside folders',
            'filter.mine':             'My files',
            'filter.stale':            'Old files (>{n} days)',
            'filter.dupes':            'Duplicate files',
            'filter.public':           'Public files',
            'filter.empty':            'Empty files / folders',
            'filter.orphan':           'Orphan files',
            'filter.trash':            'Files in trash',
            // KPI dynamic
            'kpi.stale.label':         'Not recently updated',
            'kpi.stale.subDays':       'Stale {n}+ days',
            'kpi.dupes.groups':        '{n} groups',
            // Pagination
            'page.prev':               '‹ Prev',
            'page.next':               'Next ›',
            // Search
            'search.placeholder':      'Search files...',
            // Table card
            'table.title':             'File list',
            'btn.resetFilters':        'All',
            // File type dropdown
            'filetype.all':            'All types',
            'filetype.image':          'Images',
            'filetype.video':          'Video',
            'filetype.audio':          'Audio',
            'filetype.document':       'Documents',
            'filetype.spreadsheet':    'Spreadsheets',
            'filetype.presentation':   'Presentations',
            'filetype.pdf':            'PDF',
            'filetype.zip':            'Archives',
            'filetype.folder':         'Folders',
            // Shared tag
            'shared.publicTag':        '🌐 Public',
            // Export CSV
            'export.noData':           'Please analyze Drive before exporting!',
            'export.error':            'Cannot export report: ',
            'export.csv.header':       'File Name,Status,Severity,Recommendation,Size (bytes),Formatted Size,Type,Created,Link',
            'export.severity.high':    'High risk',
            'export.severity.medium':  'Warning',
            'export.severity.low':     'Safe',
            // Confirm modal
            'confirm.title':           'Confirm action',
            'confirm.default':         'Are you sure you want to perform this action?',
            'confirm.ok':              'Confirm',
            'confirm.cancel':          'Cancel',
            // Time chips
            'chip.time7':              '7 days',
            'chip.time30':             '30 days',
            'chip.time90':             '90 days',
            'chip.timeCustom':         'Custom',
            // Download modal
            'dl.title':                'Safe Download',
            'dl.downloaded':           'Downloaded:',
            'dl.threads':              'Threads:',
            'dl.cancel':               'Cancel download',
            'dl.preparing':            '⏳ Preparing download...',
            'dl.inProgress':           '⬇️ Downloading...',
            'dl.complete':             '✅ Download complete!',
            'dl.completePct':          '100% — Done',
            'dl.bulkComplete':         '✅ Downloaded {n} files!',
            'dl.failed':               '❌ Download failed',
            'dl.error':                'Error',
            'dl.error403':             'No permission to download this file (error 403).',
            'dl.preparing.bulk':       '⏳ Preparing...',

            // Tabs
            'tab.overview':            'Overview',
            'tab.filelist':            'Detailed Analysis',

            // Security score
            'security.title':          'Drive Security Score',
            'security.bad':            'High risk',
            'security.good':           'Safe',
            'security.improve':        'Needs improvement',
            'security.excellent':      'Excellent',
            'security.desc':           '{n} issues are pulling your score down. Fix them all to reach 100 — last scan {time}.',
            'security.descClean':      'All issues resolved. Your Drive is safe!',
            'security.how':            'How is this calculated →',

            // Scan time
            'scan.label':              'Last scan:',
            'scan.rescan':             'Rescan',
            'scan.today':              'today, {time}',

            // Alert summary
            'alert.riskTitle':         '{n} issues need attention',
            'alert.riskSub':           'Detected in latest scan · Today at {time}',
            'alert.cleanTitle':        'Your Drive is completely clean!',
            'alert.cleanDesc':         'All 3 issues resolved · No security risks · Data fully protected',
            'alert.issue.publicTitle': 'Public files',
            'alert.issue.publicDesc':  'Anyone with the link can access',
            'alert.issue.staleTitle':  'Not updated 180+ days',
            'alert.issue.staleDesc':   'Old files taking up storage space',
            'alert.issue.dupesTitle':  'Duplicate files',
            'alert.issue.dupesDesc':   'Wasting Drive storage',
            'alert.btn.revoke':        'Revoke access',
            'alert.btn.cleanup':       'Clean up',
            'alert.btn.deleteDupes':   'Delete dupes',

            // Section labels
            'section.needAction':      'NEEDS ACTION',
            'section.issueCount':      '{n} issues detected',
            'section.driveInfo':       'DRIVE INFO',

            // Risk cards
            'risk.high':               'High risk',
            'risk.review':             'Needs review',
            'risk.waste':              'Waste',
            'risk.resolved':           'Resolved',
            'risk.publicLabel':        'Public files',
            'risk.publicSub':          'Accessible by anyone with the link',
            'risk.staleLabel':         'Stale {n}+ days',
            'risk.staleSub':           'Unused files, can be cleaned up',
            'risk.dupesLabel':         'Duplicate files',
            'risk.dupesSub':           'Files with duplicate content, wasting storage',
            'risk.dupesGroups':        '{n} groups',

            // Info badges
            'info.normal':             'Normal',
            'info.ok':                 'OK',
            'info.noData':             'No data',

            // Action section
            'action.sectionTitle':     'Next steps — Handle detected issues',
            'action.revokeTitle':      'Revoke public access',
            'action.revokeDesc':       '{n} files exposed — take action now to protect data.',
            'action.revokeBtn':        'Take action →',
            'action.cleanTitle':       'Clean up old files (180+ days)',
            'action.cleanDesc':        '{n} unused files — free up Drive storage.',
            'action.cleanBtn':         'Clean up →',
            'action.dupesTitle':       'Delete duplicate files',
            'action.dupesDesc':        '{n} duplicate groups — save storage instantly.',
            'action.dupesBtn':         'Delete dupes →',

            // Alert banner
            'banner.publicText':       'Files are public — revoke access for each file',
            'banner.viewAll':          'View all',

            // Table
            'th.access':               'ACCESS',
            'access.public':           'Anyone with link',
            'access.domain':           'Organization internal',
            'access.shared':           'Shared via email',
            'access.private':          'Private',
            'access.sharedPlus':       'Anyone + {n} email',

            // Panel
            'panel.selected':          'Selected category',
            'panel.breakdown':         'BREAKDOWN',
            'panel.sampleFiles':       'SAMPLE FILES',
            'panel.viewAll':           'View all',
            'panel.downloadAll':       'Download full list',

            // Risk card buttons
            'risk.btn.revoke':         'Revoke access',
            'risk.btn.cleanup':        'Bulk clean up',
            'risk.btn.deleteDupes':    'Delete dupes',

            // Info card button
            'info.btn.download':       'Download list',
            'info.btn.analyze':        'Analyze details',
            'info.btn.organize':       'Auto organize',
            'info.btn.deleteEmpty':    'Delete all empty',

            // Scan flow
            'scan.start.subtitle':     'Connected — ready to scan your Drive',
            'scan.start.btn':          'SCAN NOW',
            'scan.start.meta':         '~60 seconds · Safe',
            'scan.progress.title':     'Analyzing your Google Drive...',
            'scan.progress.pctUnit':   '% COMPLETE',
            'scan.progress.public':    'Public files',
            'scan.progress.stale':     '180+ day files',
            'scan.progress.dupes':     'Duplicate files',
            'scan.progress.scanning':  'Scanning metadata...',
            'scan.progress.hint':      '+{n} risky files detected',
            'scan.result.title':       'Analysis result · {n} files',
            'scan.result.riskLabel':   'RISK SCORE',
            'scan.result.high':        'High risk',
            'scan.result.medium':      'Medium risk',
            'scan.result.low':         'Safe',
            'scan.result.public':      'public',
            'scan.result.stale':       '{n}+ day old',
            'scan.result.dupes':       'duplicates',
            'scan.result.actionBtn':   'View Dashboard to manage →',
            'scan.result.footer':      'Fix issues to reach Risk Score 100 🏆',

            // New action buttons
            'action.transferOwnership':'Transfer ownership',
            'action.requestOwnership': 'Request ownership',
            'action.stopSharing':      'Stop sharing',
            'action.compareDuplicates':'Compare duplicates',
            // Share V2 modal
            'shareV2.title':           'Sharing with',
            'shareV2.revokeAll':       'Revoke all',
            'shareV2.revokeAllConfirm':'Revoke all sharing permissions for this file?\nThis will remove all access.',
            'shareV2.revokeAllSuccess':'All sharing permissions revoked!',
            'shareV2.noPermission':    'Not shared with anyone',
            // Duplicate modal
            'dupe.title':              'Compare duplicates',
            'dupe.subtitle':           'Files with 100% matching content',
            'dupe.alert':              'Matched by content & size (hash) — files below are 100% identical, regardless of name. Keep 1 copy, delete the rest to save space.',
            'dupe.footerInfo':         'Deleted files go to Google Drive Trash — recoverable for ~30 days, not permanently deleted.',
            'dupe.remaining':          '{n} copies · delete extras, keep the one you want',
            'dupe.keepLabel':          'Keep',
            'dupe.originalLabel':      'Original',
            'dupe.deleteBtn':          'Delete this copy',
            'dupe.lastOriginalWarn':    'Must keep at least 1 original',
            // Transfer modal
            'transfer.title':          'Transfer ownership',
            'transfer.desc':           'Enter the email of the new owner to transfer ownership of this file.',
            'transfer.emailLabel':     'Recipient email',
            'transfer.emailPlaceholder':'Enter email address...',
            'transfer.btn':            'Transfer',
            'transfer.success':        'Ownership transferred successfully!',
            'transfer.error':          'Cannot transfer ownership: ',
            'transfer.invalidEmail':   'Please enter a valid email',
            'transfer.notOwner':       'You do not have permission to transfer ownership of this file.',
            'transfer.alreadyOwner':   'This email is already the owner of the file.',
            'transfer.pending':        'Ownership transfer invitation sent to this email. The recipient needs to open the email and accept ownership to complete the transfer.',
            'transfer.pendingAgain':   'An ownership transfer invitation was already sent. The recipient needs to accept ownership in their email to complete the transfer.',
            'transfer.consentPolicy':  'Google Drive requires the recipient to confirm ownership. Ask the recipient to check their email and accept the invitation.',
            'transfer.domainPolicy':   'Cannot transfer ownership to this email due to Google Drive policy or domain restrictions.',
            'transfer.sharedDrive':    'File is in a Shared Drive, which does not support ownership transfer.',
            'transfer.trashed':        'Cannot transfer ownership of a file in Trash.',
            // Request ownership modal
            'request.title':           'Request ownership',
            'request.desc':            'You do not own this file. Send a request to the owner for ownership (requires owner approval).',
            'request.btn':             'Send request',
            'request.success':         'Ownership request sent!',
            'request.error':           'Cannot send request: ',
            // Progress circle labels
            'progress.public':         'Public',
            'progress.stale':          '180+ days stale',
            'progress.dupes':          'Duplicates',
            // Deduction labels
            'deduction.public':        'Public',
            'deduction.stale':         '180+ days stale',
            'deduction.dupes':         'Duplicates',
            'deduction.fixBtn':        'Fix all → +',
            'deduction.fixBtnSuffix':  ' points',
            // Demo toggle
            'demo.risk':               'Has risks',
            'demo.clean':              'Clean drive',
            // Auth screen
            'auth.title':              'Manage Drive',
            'auth.titleAccent':        'smarter',
            'auth.desc':               'Detect risky files, duplicates and wasted storage in Google Drive — in just 60 seconds.',
            'auth.feat.scan':          'Full Drive scan',
            'auth.feat.risk':          'Risk detection',
            'auth.feat.oneclick':      'One-click fix',
            'auth.feat.privacy':       'No content reading',
            'auth.btn':                'Continue with Google',
            'auth.btnLoading':         'Connecting...',
            'auth.privacy':            'Reads metadata only · No content stored',
            'auth.privacyLink':        'Privacy policy',
            'auth.error':              'Could not connect to Google. Please try again.',
        },
    },

    t(key) {
        const lang = this._dict[this._lang] || this._dict['vi'];
        const vi   = this._dict['vi'];
        return lang[key] !== undefined ? lang[key] : (vi[key] !== undefined ? vi[key] : key);
    },

    apply() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            el.textContent = this.t(el.dataset.i18n);
        });
        document.querySelectorAll('[data-i18n-html]').forEach(el => {
            el.innerHTML = this.t(el.dataset.i18nHtml);
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            el.placeholder = this.t(el.dataset.i18nPlaceholder);
        });
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            el.title = this.t(el.dataset.i18nTitle);
        });
        const staleCardSub = document.getElementById('stale-card-sub');
        if (staleCardSub) {
            staleCardSub.textContent = this.t('kpi.stale.subDays')
                .replace('{n}', typeof STALE_THRESHOLD_DAYS !== 'undefined' ? STALE_THRESHOLD_DAYS : 180);
        }
        const statSave = document.getElementById('stat-potential-save');
        if (statSave && statSave.dataset.i18n === 'storage.loading') {
            statSave.textContent = this.t('storage.loading');
        }
    },

    setLang(lang) {
        if (!this._dict[lang]) return;
        this._lang = lang;
        safeStorage.set({ language: lang });
        this.apply();
        if (typeof UIController !== 'undefined' && UIController.allScannedFiles.length) {
            UIController._reRenderDynamic();
        }
        const _staleCardSub = document.getElementById('stale-card-sub');
        if (_staleCardSub) {
            _staleCardSub.textContent = this.t('kpi.stale.subDays')
                .replace('{n}', typeof STALE_THRESHOLD_DAYS !== 'undefined' ? STALE_THRESHOLD_DAYS : 180);
        }
        if (typeof BulkActionBar !== 'undefined') {
            BulkActionBar.update();
        }
    },

    async init() {
        return new Promise(resolve => {
            safeStorage.get(['language']).then(data => {
                this._lang = data.language || 'vi';
                this.apply();
                resolve();
            });
        });
    },
};


// ============================================================
// MODULE 1: FileAnalyzer
// ============================================================
let STALE_THRESHOLD_DAYS = 180;

function isStaleFile(file, thresholdDays = STALE_THRESHOLD_DAYS) {
    const modifiedTime = new Date(file.modifiedTime).getTime();
    if (!Number.isFinite(modifiedTime)) return false;
    return Date.now() - modifiedTime >= thresholdDays * 86400000;
}

async function loadStaleThreshold() {
    const data = await safeStorage.get(['recentDays']);
    const savedDays = Number.parseInt(data.recentDays, 10);
    STALE_THRESHOLD_DAYS = savedDays > 0 ? savedDays : 180;
}

function refreshStaleUIFromCachedFiles() {
    const staleSub = document.getElementById('stale-card-sub');
    if (staleSub) staleSub.textContent = I18n.t('kpi.stale.subDays').replace('{n}', STALE_THRESHOLD_DAYS);
    const riskLabel = document.getElementById('risk-label-stale');
    if (riskLabel) riskLabel.textContent = I18n.t('risk.staleLabel').replace('{n}', STALE_THRESHOLD_DAYS);
    if (!UIController?.allScannedFiles?.length) return;
    UIController.updateStats(UIController.allScannedFiles);
    UIController._updateProgressCircles();
    if (UIController.currentFilterType === 'stale') UIController._applyFull();
}

if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'sync' || !changes.recentDays) return;
        const savedDays = Number.parseInt(changes.recentDays.newValue, 10);
        STALE_THRESHOLD_DAYS = savedDays > 0 ? savedDays : 180;
        refreshStaleUIFromCachedFiles();
    });
}

const FileAnalyzer = {
    _REC_SAFE: 'rec.safe',
    analyze(file) {
        const labels = [];
        let severity = 'low';
        if (!file) {
            return { severity: 'low', labels: [{ icon: '⚪', key: 'nodata' }], recommendedAction: null };
        }
        if (file.trashed) { labels.push({ icon: '🔴', key: 'trashed' }); severity = 'high'; }
        const permissions = file.permissions || [];
        const isPublic = permissions.some(p => p.type === 'anyone');
        const isDomain = permissions.some(p => p.type === 'domain');
        if (isPublic)       { labels.push({ icon: '🔴', key: 'public' }); severity = 'high'; }
        else if (isDomain)  { labels.push({ icon: '🟡', key: 'domain' }); if (severity !== 'high') severity = 'medium'; }
        else if (file.ownedByMe && permissions.length <= 1) { labels.push({ icon: '🟢', key: 'private' }); }
        if (file.capabilities && typeof file.capabilities.canDownload !== 'undefined' && !file.capabilities.canDownload) {
            labels.push({ icon: '🟡', key: 'restricted' });
            if (severity !== 'high') severity = 'medium';
        }
        if (file.ownedByMe && file.capabilities && typeof file.capabilities.canEdit !== 'undefined' && !file.capabilities.canEdit) {
            labels.push({ icon: '🟡', key: 'readonly' });
            if (severity !== 'high') severity = 'medium';
        }
        if (file.contentRestrictions && file.contentRestrictions.readOnly) {
            labels.push({ icon: '🔴', key: 'blocked' }); severity = 'high';
        }
        if ((!file.parents || file.parents.length === 0) && !file.trashed && !file.shared && file.ownedByMe) {
            labels.push({ icon: '🟡', key: 'orphan' });
            if (severity !== 'high') severity = 'medium';
        }
        if (!file.trashed) {
            if (isStaleFile(file)) {
                const ageDays = Math.floor((Date.now() - new Date(file.modifiedTime).getTime()) / 86400000);
                labels.push({ icon: '🟡', key: 'stale', ageDays });
                if (severity !== 'high') severity = 'medium';
            }
        }
        if (labels.length === 0) { labels.push({ icon: '🟢', key: 'safe' }); }
        const recommendedAction = this._getRecommendation(severity, labels, file);
        return { severity, labels, recommendedAction };
    },

    _getRecommendation(severity, labels, file) {
        const keys = labels.map(l => l.key);
        if (keys.includes('trashed'))    return 'rec.delete';
        if (keys.includes('public'))     return 'rec.urgent';
        if (keys.includes('blocked'))    return 'rec.contactAdmin';
        if (keys.includes('orphan'))     return 'rec.organize';
        if (keys.includes('restricted')) return 'rec.checkPerm';
        if (keys.includes('readonly'))   return 'rec.requestEdit';
        if (keys.includes('stale'))      return 'rec.archive';
        return FileAnalyzer._REC_SAFE;
    },

    isStorageCounted(file) {
        if (!file || file.trashed || file.ownedByMe !== true) return false;
        if (file.driveId || file.teamDriveId) return false;

        const mimeType = (file.mimeType || '').toLowerCase();
        if (!mimeType) return false;
        if (mimeType.includes('folder')) return false;
        if (mimeType === 'application/vnd.google-apps.shortcut' || file.shortcutDetails) return false;
        if (
            mimeType.includes('application/vnd.google-apps.document') ||
            mimeType.includes('application/vnd.google-apps.spreadsheet') ||
            mimeType.includes('application/vnd.google-apps.presentation') ||
            mimeType.includes('application/vnd.google-apps.form') ||
            mimeType.includes('application/vnd.google-apps.site') ||
            mimeType.includes('application/vnd.google-apps.drawing')
        ) return false;

        const size = Number(file.size || 0);
        return Number.isFinite(size) && size > 0;
    },

    calcMyDriveSize(files) {
        return files.reduce((acc, f) => this.isStorageCounted(f) ? acc + Number(f.size || 0) : acc, 0);
    },

    sortBySeverity(files) {
        const order = { high: 0, medium: 1, low: 2 };
        return [...files].sort((a, b) => {
            const sA = order[this.analyze(a).severity];
            const sB = order[this.analyze(b).severity];
            if (sA !== sB) return sA - sB;
            return parseInt(b.size || 0) - parseInt(a.size || 0);
        });
    }
};


// ============================================================
// MODULE 2: Toast
// ============================================================
const Toast = {
    _container: null,
    _getContainer() {
        if (!this._container) {
            this._container = document.createElement('div');
            this._container.id = 'toast-container';
            this._container.style.cssText = `position:fixed;top:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:10px;pointer-events:none;`;
            document.body.appendChild(this._container);
        }
        return this._container;
    },
    show(message, type = 'info', duration = 3500) {
        const colors = {
            success: { bg: '#10b981', icon: '✅' },
            error:   { bg: '#e74a3b', icon: '❌' },
            warning: { bg: '#f59e0b', icon: '⚠️' },
            info:    { bg: '#0052CD', icon: 'ℹ️' }
        };
        const { bg, icon } = colors[type] || colors.info;
        const el = document.createElement('div');
        el.style.cssText = `background:${bg};color:#fff;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,0.18);pointer-events:all;opacity:0;transition:opacity 0.3s,transform 0.3s;transform:translateX(30px);max-width:320px;word-break:break-word;display:flex;align-items:center;gap:8px;font-family:'Manrope',sans-serif;`;
        el.innerHTML = `<span>${icon}</span><span>${message}</span>`;
        this._getContainer().appendChild(el);
        requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(0)'; });
        setTimeout(() => {
            el.style.opacity = '0'; el.style.transform = 'translateX(30px)';
            setTimeout(() => el.remove(), 350);
        }, duration);
    },
    success: (msg) => Toast.show(msg, 'success'),
    error:   (msg) => Toast.show(msg, 'error'),
    warning: (msg) => Toast.show(msg, 'warning'),
    info:    (msg) => Toast.show(msg, 'info'),
};


// ============================================================
// ConfirmController
// ============================================================
const ConfirmController = (() => {
    let onConfirmCallback = null;
    const modal     = document.getElementById('confirm-modal');
    const messageEl = document.getElementById('confirm-message');
    const btnOk     = document.getElementById('btn-confirm-ok');
    const btnCancel = document.getElementById('btn-confirm-cancel');

    function open(message, onConfirm) {
        messageEl.innerText = message;
        onConfirmCallback = onConfirm;
        modal.style.display = 'flex';
    }
    function close() { modal.style.display = 'none'; onConfirmCallback = null; }

    btnOk.addEventListener('click',     () => { if (onConfirmCallback) onConfirmCallback(); close(); });
    btnCancel.addEventListener('click', close);
    return { open };
})();


// ============================================================
// EmptyState
// ============================================================
const EmptyState = (() => {
    const container    = document.getElementById("empty-state");
    const img          = document.getElementById("empty-img");
    const text         = document.getElementById("empty-text");
    const illustration = document.getElementById("empty-illustration");
    let lottieInstance = null;
    const assetUrl = (p) => chrome.runtime.getURL(p);

    function show(type) {
        container.style.display = "flex";
        if (lottieInstance) { lottieInstance.destroy(); lottieInstance = null; }
        if (type === "loading") {
            illustration.style.display = "block"; img.style.display = "none";
            if (typeof lottie !== 'undefined') {
                lottieInstance = lottie.loadAnimation({
                    container: illustration, renderer: "svg", loop: true, autoplay: true,
                    path: assetUrl("assets/UI/loading/Material_wave_loading.json")
                });
            } else { illustration.innerHTML = ""; }
            text.innerText = I18n.t('empty.loading');
        } else if (type === "init") {
            illustration.innerHTML = ""; illustration.style.display = "none"; img.style.display = "block";
            img.src = assetUrl("assets/UI/states/undraw_folder_files.svg");
            text.innerHTML = I18n.t('empty.init');
        } else if (type === "clean") {
            illustration.innerHTML = ""; illustration.style.display = "none"; img.style.display = "block";
            img.src = assetUrl("assets/UI/states/undraw_no_data.svg");
            text.innerText = I18n.t('empty.clean');
        } else if (type === "issues") {
            illustration.innerHTML = ""; illustration.style.display = "none"; img.style.display = "block";
            img.src = assetUrl("assets/UI/states/undraw_warning.svg");
            text.innerText = I18n.t('empty.issues');
        }
    }
    function hide() { container.style.display = "none"; }
    return { show, hide };
})();


// ============================================================
// MODULE 3B: ScanFlowController
// Manages the 3 scan screens: start → progress → result → dashboard
// ============================================================
const ScanFlowController = {
    _views: null,
    _isFirstScan: true,   // true = no cache → show result screen; false = rescan → skip result
    _currentView: null,
    _scanFiles: null,      // files from current scan session
    _scanStats: null,      // canonical score result for the completed scan

    init() {
        this._views = {
            scanStart:    document.getElementById('view-scan-start'),
            scanProgress: document.getElementById('view-scan-progress'),
            scanResult:   document.getElementById('view-scan-result'),
            dashboard:    document.getElementById('view-dashboard'),
        };
        this._bindScanStart();
        this._bindResultAction();
    },

    // ── Show a specific scan view ────────────────────────────
    _showView(viewName) {
        const viewIdMap = {
            scanStart:    'view-scan-start',
            scanProgress: 'view-scan-progress',
            scanResult:   'view-scan-result',
            dashboard:    'view-dashboard',
        };
        // Hide all content views except settings (handled by nav)
        ['scanStart', 'scanProgress', 'scanResult', 'dashboard'].forEach(k => {
            if (this._views[k]) this._views[k].style.display = (k === viewName) ? 'flex' : 'none';
        });
        this._currentView = viewName;
        // Keep UIController nav tracker in sync
        if (viewIdMap[viewName] && UIController._lastDashSubView !== undefined) {
            UIController._lastDashSubView = viewIdMap[viewName];
        }
    },

    // ── Entry point: decide what to show on page load ────────
    async autoStart() {
        let cachedFiles = [];
        let hasCompletedScan = false;
        try {
            cachedFiles = await loadFilesFromCache();
            if (cachedFiles.length > 0 && cachedFiles.some(file => file?.timestampCacheVersion !== 1)) {
                cachedFiles = await scanDrive(true);
            }
            const accountId = await getActiveAccountId();
            const scanKey = 'lastScanTime::' + (accountId || 'default');
            const scanState = await chrome.storage.local.get(scanKey);
            hasCompletedScan = Boolean(scanState[scanKey]);
        } catch (err) {
            console.warn('Không thể khôi phục trạng thái scan:', err);
        }
        if (hasCompletedScan) {
            // Has valid cache → show dashboard directly
            this._isFirstScan = false;
            this._showView('dashboard');
            UIController.setDataset(cachedFiles || []);
            if (window.WistorixAppState) {
                window.WistorixAppState.filesCache = cachedFiles || [];
                window.WistorixAppState.filesCacheLoaded = true;
            }
            await UIController.updateStats(cachedFiles);
            UIController.applyFilter('all');
            UIController._lastScanTime = new Date();
            UIController._renderScanTime();
            EmptyState.hide();
        } else {
            // No cache → show scan-start screen
            this._isFirstScan = true;
            this._showView('scanStart');
        }
    },

    // ── Bind the big blue "QUÉT DỮ LIỆU NGAY" button ────────
    _bindScanStart() {
        const btn = document.getElementById('btn-scan-start');
        if (!btn) return;
        btn.addEventListener('click', () => {
            this._isFirstScan = true;
            this._startScan();
        });
    },

    // ── Bind "Xem Dashboard để xử lý" button on result screen ─
    _bindResultAction() {
        const btn = document.getElementById('btn-view-dashboard');
        if (!btn) return;
        btn.addEventListener('click', () => {
            this._transitionToDashboard();
        });
    },

    // ── Called from dashboard "Phân tích Drive" / "Quét lại" ──
    rescan() {
        this._isFirstScan = false;
        return this._startScan();
    },

    // ── Start the actual scan ────────────────────────────────
    async _startScan() {
        // Chống scan song song: nếu đang có scan chạy thì bỏ qua yêu cầu mới
        if (this._isScanning) {
            console.warn('⏳ Đang có một lần quét đang chạy — bỏ qua yêu cầu quét mới.');
            return;
        }

        // ── Step 1: Ensure auth token BEFORE showing progress ────
        try {
            await getAuthToken();
        } catch (authErr) {
            console.error('Auth error:', authErr);
            // Auth failed → show auth overlay so user can re-authorize
            const authOverlay = document.getElementById('view-auth');
            const wrapper     = document.getElementById('wrapper');
            if (authOverlay) authOverlay.style.display = 'flex';
            if (wrapper) wrapper.style.display = 'none';
            Toast.error(I18n.t('toast.scanError'));
            return;
        }

        this._isScanning = true;
        const btnRescan = document.getElementById('btn-rescan');
        if (btnRescan) btnRescan.disabled = true;

        // Auth OK → show progress view
        this._showView('scanProgress');
        this._resetProgressUI();

        const now = Date.now();

        // Running stats computed incrementally
        let countPublic = 0;
        let countStale = 0;
        let allFiles = [];
        let riskFilesFound = 0;

        // ── Step 2: Run scan with progress ───────────────────
        try {
            try { trackEvent('scan_started'); } catch (_) { /* analytics optional */ }

            const files = await scanDrive(true, (info) => {
                try {
                    // ── onProgress callback (wrapped in try-catch) ──
                    // Progress THẬT: 100% chỉ khi info.done (đã lấy hết pages từ API).
                    // Trong lúc phân trang, tiến trình tăng dần theo số page, không nhảy 100%.
                    const pct = info.done
                        ? 100
                        : Math.min(95, Math.round(10 + (info.pageIndex / (info.pageIndex + 2)) * 85));

                    this._updateRing(pct);

                    const counterEl = document.getElementById('scan-counter');
                    if (counterEl) counterEl.textContent = `${fmt(info.current)} / ${fmt(info.total)}`;

                    if (info.latestFiles && info.latestFiles.length > 0) {
                        this._updateFileList(info.latestFiles);
                    }

                    for (const f of (info.latestFiles || [])) {
                        if (!f.trashed && f.ownedByMe) {
                            const perms = f.permissions || [];
                            const isPublic = perms.some(p => p.type === 'anyone' || p.type === 'domain');
                            if (isPublic) countPublic++;
                        }
                        if (!f.trashed) {
                            if (isStaleFile(f)) countStale++;
                        }
                        if (!f.trashed) {
                            const isPublicFile = (f.permissions || []).some(p => p.type === 'anyone' || p.type === 'domain');
                            const stale = isStaleFile(f);
                            if (isPublicFile || stale) riskFilesFound++;
                        }
                    }

                    const elPub   = document.getElementById('scan-stat-public');
                    const elStale = document.getElementById('scan-stat-stale');
                    if (elPub)   elPub.textContent = fmt(countPublic);
                    if (elStale) elStale.textContent = fmt(countStale);

                    if (riskFilesFound > 0) {
                        const hint = document.getElementById('scan-hint');
                        if (hint) hint.textContent = `+${fmt(riskFilesFound)} files rủi ro vừa được phát hiện`;
                    }
                } catch (cbErr) {
                    console.warn('Progress callback error:', cbErr);
                    // Don't throw — let scan continue
                }
            });

            // ── Step 3: Process results ──────────────────────
            allFiles = files;
            this._scanFiles = files;
            if (window.WistorixAppState) {
                window.WistorixAppState.filesCache = files;
                window.WistorixAppState.filesCacheLoaded = true;
            }

            // Compute final stats (including dupes)
            let dupeCount = 0;
            try {
                dupeCount = DuplicateDetector.findDuplicates(files).length;
            } catch (_) { /* DuplicateDetector might not be ready */ }
            const elDupes = document.getElementById('scan-stat-dupes');
            if (elDupes) elDupes.textContent = fmt(dupeCount);

            // Recount public & stale from full dataset for accuracy
            countPublic = 0; countStale = 0;
            for (const f of files) {
                if (!f.trashed && f.ownedByMe) {
                    const perms = f.permissions || [];
                    if (perms.some(p => p.type === 'anyone' || p.type === 'domain')) countPublic++;
                }
                if (!f.trashed) {
                    if (isStaleFile(f)) countStale++;
                }
            }

            this._scanStats = calculateSecurityScore(files, {
                isStale: isStaleFile,
                countDuplicateGroups: DuplicateDetector.countGroups,
            });

            // Scan + metrics đã hoàn tất → ring mới đạt 100%
            this._updateRing(100);
            const counterEl = document.getElementById('scan-counter');
            if (counterEl) counterEl.textContent = `${fmt(files.length)} / ${fmt(files.length)}`;

            try {
                trackEvent('scan_completed', {
                    file_count: files.length,
                    stale_count: countStale,
                    duplicate_count: dupeCount
                });
            } catch (_) { /* analytics optional */ }

            // Referral activation is deliberately after scanDrive resolved
            // successfully, never at install/login/scan-start.  Backend owns
            // the first-scan marker and idempotent credit reward; an outage
            // must not turn a successful Drive scan into a failed one.
            activateReferralAfterFirstScan()
                .then(result => {
                    if (result?.status === 'REWARDED') {
                        window.dispatchEvent(new CustomEvent('wistorix:cleanup-credits-changed'));
                    }
                })
                .catch(error => console.warn('Referral activation deferred:', error?.message || error));

            // Brief pause at 100% for visual satisfaction
            await new Promise(r => setTimeout(r, 800));

            if (this._isFirstScan) {
                this._showResultScreen();
            } else {
                this._transitionToDashboard();
            }

            getStartPageToken().catch(err => console.warn("Không thể lưu startPageToken:", err));

        } catch (scanErr) {
            console.error('Scan error:', scanErr);
            try { trackEvent('api_error', { error_type: 'scan_failure', error_message: (scanErr.message || '').substring(0, 100) }); } catch (_) {}

            const status  = Number(scanErr.status);
            const reason  = String(scanErr.reason || '').toLowerCase();
            const errMsg  = String(scanErr.message || '').toLowerCase();
            const isAuth  = status === 401
                || reason.includes('invalid_grant') || reason.includes('auth') || reason.includes('token')
                || errMsg.includes('401') || errMsg.includes('xác thực') || errMsg.includes('không lấy được token')
                || errMsg.includes('authorization') || errMsg.includes('not been granted');
            const isRate  = status === 429
                || reason.includes('ratelimit') || reason.includes('rate limit') || reason.includes('quota') || reason.includes('userratelimitexceeded');
            const isScope = status === 403 && !isRate;
            const isNet   = status === 0
                || reason.includes('network') || reason.includes('dns') || reason.includes('internet')
                || errMsg.includes('failed to fetch') || errMsg.includes('network') || errMsg.includes('kết nối');

            const showAuthOverlay = () => {
                const authOverlay = document.getElementById('view-auth');
                const wrapper     = document.getElementById('wrapper');
                if (authOverlay) authOverlay.style.display = 'flex';
                if (wrapper) wrapper.style.display = 'none';
            };
            const backToDashboard = () => {
                // Giữ data cũ hiển thị nhưng KHÔNG báo thành công giả
                if (UIController.allScannedFiles.length > 0) {
                    this._showView('dashboard');
                } else {
                    this._showView('scanStart');
                }
            };

            if (isAuth) {
                Toast.error(I18n.t('toast.scanError'));
                showAuthOverlay();
            } else if (isRate) {
                Toast.error(I18n.t('toast.scanRateLimit'));
                backToDashboard();
            } else if (isScope) {
                Toast.error(I18n.t('toast.scanScope'));
                showAuthOverlay();
            } else if (isNet) {
                Toast.error(I18n.t('toast.scanNetworkError'));
                backToDashboard();
            } else {
                Toast.error(`Lỗi quét Drive: ${scanErr.message}`);
                backToDashboard();
            }
        } finally {
            this._isScanning = false;
            if (btnRescan) btnRescan.disabled = false;
        }
    },

    // ── Update progress ring ─────────────────────────────────
    _updateRing(pct) {
        const CIRCUMFERENCE = 2 * Math.PI * 88; // ≈ 553
        const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
        const ring = document.getElementById('scan-ring-fill');
        const label = document.getElementById('scan-pct');
        if (ring) ring.style.strokeDashoffset = offset;
        if (label) label.textContent = pct;
    },

    // ── Reset progress UI ────────────────────────────────────
    _resetProgressUI() {
        this._updateRing(0);
        const pctEl = document.getElementById('scan-pct');
        if (pctEl) pctEl.textContent = '0';
        ['scan-stat-public', 'scan-stat-stale', 'scan-stat-dupes'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '0';
        });
        const counter = document.getElementById('scan-counter');
        if (counter) counter.textContent = '0 / 0';
        const fileList = document.getElementById('scan-file-list');
        if (fileList) fileList.innerHTML = '';
        const hint = document.getElementById('scan-hint');
        if (hint) hint.textContent = '';
    },

    // ── Update file list panel with latest files ─────────────
    _updateFileList(latestFiles) {
        const container = document.getElementById('scan-file-list');
        if (!container) return;

        const iconMap = {
            image: 'fas fa-image',
            video: 'fas fa-video',
            audio: 'fas fa-music',
            pdf:   'fas fa-file-pdf',
            doc:   'fas fa-file-word',
            sheet: 'fas fa-file-excel',
            zip:   'fas fa-file-archive',
        };

        function getIcon(file) {
            const mime = (file.mimeType || '').toLowerCase();
            const name = (file.name || '').toLowerCase();
            if (mime.startsWith('image/')) return iconMap.image;
            if (mime.startsWith('video/')) return iconMap.video;
            if (mime.startsWith('audio/')) return iconMap.audio;
            if (mime.includes('pdf')) return iconMap.pdf;
            if (mime.includes('document') || name.endsWith('.docx') || name.endsWith('.doc')) return iconMap.doc;
            if (mime.includes('spreadsheet') || name.endsWith('.xlsx') || name.endsWith('.csv')) return iconMap.sheet;
            if (mime.includes('zip') || mime.includes('compressed') || name.endsWith('.zip') || name.endsWith('.rar')) return iconMap.zip;
            return 'fas fa-file';
        }

        function formatSize(bytes) {
            const b = parseInt(bytes || 0);
            if (b === 0) return '—';
            if (b < 1024) return b + ' B';
            if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
            if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
            return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        }

        // Keep max 5 rows, prepend new ones
        for (const f of latestFiles) {
            const row = document.createElement('div');
            row.className = 'scan-file-row';
            row.innerHTML = `
                <span class="scan-file-row__icon"><i class="${getIcon(f)}"></i></span>
                <span class="scan-file-row__name">${(f.name || 'Untitled').replace(/</g, '&lt;')}</span>
                <span class="scan-file-row__size">${formatSize(f.size)}</span>
            `;
            container.prepend(row);
        }

        // Trim to 5 visible rows
        while (container.children.length > 5) {
            container.removeChild(container.lastChild);
        }
    },

    // ── Show result screen (IMAGE 4) ─────────────────────────
    _showResultScreen() {
        const score = this._scanStats;
        if (!score) return;
        const { counts, riskScore } = score;
        const files = this._scanFiles || [];

        // Populate result view
        document.getElementById('result-file-count').textContent = fmt(files.length);
        document.getElementById('result-public').textContent = fmt(counts.publicCount);
        document.getElementById('result-stale').textContent = fmt(counts.staleCount);
        document.getElementById('result-dupes').textContent = fmt(counts.duplicateGroups);
        const staleLabel = document.getElementById('result-stale-label');
        if (staleLabel) staleLabel.textContent = I18n.t('scan.result.stale').replace('{n}', STALE_THRESHOLD_DAYS);

        // Risk ring
        const CIRCUMFERENCE = 2 * Math.PI * 88;
        const riskFill = document.getElementById('result-ring-fill');
        const scoreEl = document.getElementById('result-score');
        const riskText = document.getElementById('result-risk-text');

        if (scoreEl) scoreEl.textContent = riskScore;

        const riskLevel = classifyRiskScore(riskScore);
        const riskStyle = {
            low: { color: '#4ade80', label: I18n.t('scan.result.low'), className: 'risk-low' },
            medium: { color: '#fbbf24', label: I18n.t('scan.result.medium'), className: 'risk-medium' },
            high: { color: '#f87171', label: I18n.t('scan.result.high'), className: 'risk-high' },
        }[riskLevel];

        if (riskFill) {
            riskFill.style.stroke = riskStyle.color;
            riskFill.style.filter = `drop-shadow(0 0 8px ${riskStyle.color}80)`;
            const fillPct = riskScore / 100;
            const offset = CIRCUMFERENCE - fillPct * CIRCUMFERENCE;
            // Reset then animate
            riskFill.style.strokeDashoffset = CIRCUMFERENCE;
            requestAnimationFrame(() => {
                riskFill.style.strokeDashoffset = offset;
            });
        }

        if (riskText) {
            riskText.textContent = riskStyle.label;
            riskText.className = 'scan-result__risk-text ' + riskStyle.className;
        }

        this._showView('scanResult');
    },

    // ── Transition to dashboard with scan data ───────────────
    async _transitionToDashboard() {
        // First scan only becomes complete when user explicitly leaves result
        // screen via “Xem dashboard”.  Router must restore this state later.
        this._isFirstScan = false;
        const files = this._scanFiles;
        if (!files || files.length === 0) {
            this._showView('dashboard');
            EmptyState.show('clean');
            return;
        }

        this._showView('dashboard');
        UIController.setDataset(files);
        await UIController.updateStats(files);
        UIController.applyFilter('all');
        UIController._lastScanTime = new Date();
        UIController._renderScanTime();
        EmptyState.hide();
        Toast.success(I18n.t('toast.scanSuccess'));
    },
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

// app-router is a classic script, so expose the existing controller rather
// than creating a second scan/navigation state.
window.ScanFlowController = ScanFlowController;


// ============================================================
// MODULE 4: UIController
// ============================================================
const UIController = window.UIController = {
    allScannedFiles:    [],
    currentFilterType:  'all',
    currentDownloader:  null,
    _currentUser:       null,
    _folderMap:         {},
    _fileParentMap:     {},
    _inheritedPermissionSourceCache: new Map(),
    _folderSortMode:    'alpha',
    _selectedFileIds:   new Set(),
    _lastStorageUsed:   null,
    _lastStorageTotal:  0,
    _activeStatusFilter:'all',
    _activeChipFilters: { status: null, type: null, size: null, time: null, special: null },
    _quickFilter:      '',
    _analysisSort:     { key: 'createdTime', direction: 'desc' },
    _duplicateIndex:   null,

    setDataset(files) {
        this.allScannedFiles = Array.isArray(files) ? files : [];
        this._duplicateIndex = null;
    },

    _getDuplicateIndex() {
        if (!this._duplicateIndex) this._duplicateIndex = DuplicateDetector.createIndex(this.allScannedFiles);
        return this._duplicateIndex;
    },

    init() {
        this._cacheElements();
        this._setupNavigation();
        this._setupTabs();
        this._bindActions();
        this._bindShareModal();
        this._bindDownloadModal();
        this._bindFilterBar();
        this._bindSearch();
        this._bindSelectAll();
        this._bindResetFilters();
        this._bindFileTypeFilter();
        this._bindAnalysisSort();
        this._bindSidePanel();
        this._bindShareModalV2();
        this._bindDuplicateModal();
        this._bindFilePreview();
        this._initScoreHelpModal();
        this._bindDeductionsFixBtn();
        this._bindImageFallback();
        this._loadCurrentUser();
        requestAnimationFrame(() => BulkActionBar.init());
    },

    // ── Gửi upgrade_screen_viewed tracking (GA4) ──────────────
    // Gọi khi hiển thị màn hình Upgrade cho người dùng.
    // @param {string} trigger - Nguyên nhân hiển thị: 'file_limit_reached' | 'manual_click'
    showUpgradeScreen(trigger = 'manual_click') {
        if (this._upgradeScreenTracked) return;
        this._upgradeScreenTracked = true;
        try {
            trackEvent('upgrade_screen_viewed', { trigger });
        } catch (_) { /* analytics optional */ }
    },

    _bindImageFallback() {
        // MV3 CSP cấm inline onerror → dùng delegated error handler ở capture phase
        document.addEventListener('error', (event) => {
            const img = event.target;
            if (!(img instanceof HTMLImageElement)) return;
            const fallback = img.dataset.fallbackAvatar;
            if (!fallback) return;
            if (img.src === fallback) return;
            img.src = fallback;
        }, true);
    },

    _cacheElements() {
        this.el = {
            btnRefresh:      document.getElementById('btn-refresh'),
            btnExport:       document.getElementById('btn-export'),
            tableBody:       document.querySelector('#issues-table tbody'),
            listStatus:      document.getElementById('list-status'),
            statTotal:       document.getElementById('stat-total-files'),
            statIssues:      document.getElementById('stat-issues-count'),
            statOptimize:    document.getElementById('stat-potential-save'),
            dlModal:         document.getElementById('download-modal'),
            dlProgressBar:   document.getElementById('dl-progress-bar'),
            dlStatusText:    document.getElementById('dl-status-text'),
            dlStats:         document.getElementById('dl-stats'),
            dlFilename:      document.getElementById('dl-filename'),
            dlThreads:       document.getElementById('dl-threads'),
            btnCancelDl:     document.getElementById('btn-cancel-download'),
            shareModal:      document.getElementById('shareDetailModal'),
            btnCloseModal:   document.getElementById('btnCloseModal'),
            modalFileName:   document.getElementById('modalFileName'),
            modalRiskBadge:  document.getElementById('modalRiskBadge'),
            modalRiskAdvice: document.getElementById('modalRiskAdvice'),
            ownerSection:    document.getElementById('ownerSection'),
            ownerInfo:       document.getElementById('ownerInfo'),
            sharedWithSection: document.getElementById('sharedWithSection'),
            sharedList:      document.getElementById('sharedList'),
            sharedCount:     document.getElementById('sharedCount'),
        };
    },

    _setupNavigation() {
        this._lastDashSubView = 'view-dashboard';
    },

    _setupTabs() {
        const tabBar = document.getElementById('wix-tabs');
        if (!tabBar) return;
        // Tab panels belong to the dashboard shell only.  Fragment routes use
        // the same `wix-tab-panel` class, and are kept mounted by the SPA
        // router; a document-wide selector here hid those cached pages.
        const dashboardRoot = tabBar.closest('#view-dashboard');
        if (!dashboardRoot) return;
        this._currentTab = 'overview';
        tabBar.addEventListener('click', (e) => {
            const btn = e.target.closest('.wix-tab');
            if (!btn) return;
            const tab = btn.dataset.tab;
            if (!tab || tab === this._currentTab) return;
            this._currentTab = tab;
            tabBar.querySelectorAll('.wix-tab').forEach(t => t.classList.remove('wix-tab--active'));
            btn.classList.add('wix-tab--active');
            dashboardRoot.querySelectorAll('.wix-tab-panel').forEach(p => {
                p.classList.remove('wix-tab-panel--active');
                p.style.display = 'none';
            });
            const panel = dashboardRoot.querySelector('#tab-' + tab);
            if (panel) { panel.style.display = 'flex'; panel.classList.add('wix-tab-panel--active'); }
        });
        // Rescan button in scan-time badge
        const btnRescan = document.getElementById('btn-rescan');
        if (btnRescan) btnRescan.addEventListener('click', (e) => { e.preventDefault(); this.runScan(); });

    },

    _switchToTab(tabName) {
        const tabBar = document.getElementById('wix-tabs');
        if (!tabBar) return;
        const btn = tabBar.querySelector(`.wix-tab[data-tab="${tabName}"]`);
        if (btn) btn.click();
    },

    // ── Bind Share Modal V2 ────────────────────────────────────────
    _bindShareModalV2() {
        const modal = document.getElementById('shareDetailModalV2');
        if (!modal) return;
        document.getElementById('btnCloseShareModalV2')?.addEventListener('click', () => modal.style.display = 'none');
        document.getElementById('btnCloseShareModalFooter')?.addEventListener('click', () => modal.style.display = 'none');
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
        // Revoke all button
        document.getElementById('btnRevokeAllShare')?.addEventListener('click', async () => {
            const fileId = this._currentShareFileId;
            if (!fileId) return;
            modal.style.display = 'none';
            ConfirmController.open(I18n.t('shareV2.revokeAllConfirm'), async () => {
                try {
                    const currentFile = this.allScannedFiles.find(file => file.id === fileId);
                    if (!canCurrentAccountManageSharing(currentFile)) {
                        Toast.error('Bạn không có quyền ngừng chia sẻ tệp này.');
                        return;
                    }
                    const permissions = await getFilePermissions(fileId);
                    const revocable = permissions.filter(p => p.role !== 'owner' && !getInheritedParentId(p) && !(p.permissionDetails?.some(d => d.inherited === true)) && !p.inherited);
                    const inheritedTargets = permissions.filter(p => p.role !== 'owner' && getInheritedParentId(p));
                    const unresolvedInherited = permissions.filter(p => p.role !== 'owner' && !getInheritedParentId(p) && (p.inherited || p.permissionDetails?.some(d => d.inherited === true)));
                    if (!revocable.length && inheritedTargets.length === 1) {
                        const child = this.allScannedFiles.find(item => item.id === fileId);
                        await handleInheritedPermissionRevoke({
                            file: child, permission: inheritedTargets[0], getFileMetadata, getFilePermissions, revokePermission, removeCachedPermission,
                            requireCleanupMutation, canManageSharing: canCurrentAccountManageSharing, toast: Toast,
                            onSuccess: async ({ parent, parentPermission, childPermission, operation }) => {
                                const currentParent = this.allScannedFiles.find(item => item.id === parent.id);
                                if (currentParent) {
                                    currentParent.permissions = (currentParent.permissions || []).filter(item => item.id !== parentPermission.id);
                                    currentParent.shared = currentParent.permissions.some(item => item.role !== 'owner');
                                }
                                if (child) {
                                    child.permissions = (child.permissions || []).filter(item => item.id !== childPermission.id);
                                    child.shared = child.permissions.some(item => item.role !== 'owner');
                                }
                                await logAction({ type: 'revoke', fileId: parent.id, fileName: parent.name, actionLabel: 'Thu hồi quyền thư mục cha' }, operation);
                                this._syncKPIAfterChange();
                                this._applyFull();
                            }
                        });
                        return;
                    }
                    if (!revocable.length && inheritedTargets.length) {
                        Toast.info('Các quyền kế thừa cần được thu hồi từng quyền để xác nhận thư mục cha.');
                        return;
                    }
                    if (!revocable.length && unresolvedInherited.length) {
                        const child = this.allScannedFiles.find(item => item.id === fileId);
                        const resolved = await resolveInheritedPermissionSource({
                            file: child, permission: unresolvedInherited[0], files: this.allScannedFiles,
                            path: this._getFilePath(child), getFilePermissions,
                            permissionCache: this._inheritedPermissionSourceCache ||= new Map()
                        });
                        if (resolved.status === 'resolved') {
                            await handleInheritedPermissionRevoke({
                                file: child, permission: resolved.permission, getFileMetadata, getFilePermissions, revokePermission, removeCachedPermission,
                                requireCleanupMutation, canManageSharing: canCurrentAccountManageSharing, toast: Toast,
                            onSuccess: async ({ parent, parentPermission, childPermission, operation }) => {
                                    const currentParent = this.allScannedFiles.find(item => item.id === parent.id);
                                    if (currentParent) {
                                        currentParent.permissions = (currentParent.permissions || []).filter(item => item.id !== parentPermission.id);
                                        currentParent.shared = currentParent.permissions.some(item => item.role !== 'owner');
                                    }
                                    if (child) {
                                        child.permissions = (child.permissions || []).filter(item => item.id !== childPermission.id);
                                        child.shared = child.permissions.some(item => item.role !== 'owner');
                                    }
                                await logAction({ type: 'revoke', fileId: parent.id, fileName: parent.name, actionLabel: 'Thu hồi quyền thư mục cha' }, operation);
                                    this._syncKPIAfterChange();
                                    this._applyFull();
                                }
                            });
                            return;
                        }
                        Toast.warning('Không thể xác định thư mục nguồn của quyền kế thừa. Vui lòng tải lại dữ liệu Drive và thử lại.');
                        return;
                    }
                    const operation = await requireCleanupMutation(fileId);
                    if (!operation) return;
                    let revokedCount = 0;
                    let failedCount = 0;
                    const revokedIds = new Set();
                    for (const perm of revocable) {
                        if (!canCurrentAccountManageSharing(this.allScannedFiles.find(file => file.id === fileId))) { failedCount++; break; }
                        try { await revokePermission(fileId, perm.id); revokedIds.add(perm.id); revokedCount++; } catch (_) { failedCount++; }
                    }
                    if (revokedCount) {
                        const file = this.allScannedFiles.find(f => f.id === fileId);
                        await logAction({ type: 'revoke', fileId, fileName: file?.name || 'Unknown', fileSize: file?.size, actionLabel: 'Thu hồi quyền' }, operation);
                    }
                    // Update cache
                    const fi = this.allScannedFiles.findIndex(f => f.id === fileId);
                    if (fi !== -1 && this.allScannedFiles[fi].permissions) {
                        this.allScannedFiles[fi].permissions = this.allScannedFiles[fi].permissions.filter(p => !revokedIds.has(p.id));
                        this.allScannedFiles[fi].shared = this.allScannedFiles[fi].permissions.some(p => p.role !== 'owner');
                    }
                    this._syncKPIAfterChange();
                    this._applyFull();
                    if (revokedCount) Toast.success(inheritedTargets.length
                        ? `Đã thu hồi ${revokedCount} quyền trực tiếp. Quyền kế thừa cần thu hồi từng quyền để xác nhận thư mục cha.`
                        : failedCount ? `Đã thu hồi ${revokedCount} quyền chia sẻ; ${failedCount} quyền không thể thu hồi.` : I18n.t('shareV2.revokeAllSuccess'));
                    else if (inheritedTargets.length) { await failReservedCleanup(operation); Toast.info('Quyền kế thừa cần được thu hồi từng quyền để xác nhận thư mục cha.'); }
                    else { await failReservedCleanup(operation); Toast.error('Không thể thu hồi quyền chia sẻ nào của tệp này.'); }
                } catch (err) {
                    await failReservedCleanup(operation);
                    Toast.error(I18n.t('perm.revoke.error') + err.message);
                }
            });
        });
    },

    // ── Bind Duplicate Modal ───────────────────────────────────────
    _bindDuplicateModal() {
        const modal = document.getElementById('duplicateModal');
        if (!modal) return;
        document.getElementById('btnCloseDuplicateModal')?.addEventListener('click', () => modal.style.display = 'none');
        document.getElementById('btnCloseDuplicateFooter')?.addEventListener('click', () => modal.style.display = 'none');
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
    },

    // ── Bind Deductions Fix button → navigate to filelist with filter ──
    _bindDeductionsFixBtn() {
        const btn = document.getElementById('deductions-fix-btn');
        if (!btn) return;
        btn.addEventListener('click', () => {
            // Open filelist tab with 'all' filter to show all issues
            this._navigateFromOverviewCard('all');
        });
    },

    async _loadCurrentUser() {
        if (this._currentUser) return this._currentUser;
        try {
            const token = await getAuthTokenSilently();
            if (!token) return null;
            const res   = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) return null;
            const data        = await res.json();
            this._currentUser = data.user || null;
        } catch (_) {
            this._currentUser = null;
        }
        return this._currentUser;
    },

    _bindActions() {
        const { btnRefresh, btnExport } = this.el;
        if (btnRefresh) btnRefresh.addEventListener('click', () => this.runScan());
        if (btnExport)  btnExport.addEventListener('click',  () => this.exportReport());

        // Analysis tab action buttons
        const actionBtnRevoke = document.getElementById('action-btn-revoke');
        const actionBtnClean  = document.getElementById('action-btn-clean');
        const actionBtnDupes  = document.getElementById('action-btn-dupes');
        if (actionBtnRevoke) actionBtnRevoke.addEventListener('click', () => this._navigateFromOverviewCard('public'));
        if (actionBtnClean)  actionBtnClean.addEventListener('click',  () => this._navigateFromOverviewCard('stale'));
        if (actionBtnDupes)  actionBtnDupes.addEventListener('click',  () => this._navigateFromOverviewCard('dupes'));

        // Banner view all — reset to 'all' filter
        const bannerViewAll = document.getElementById('banner-view-all');
        if (bannerViewAll) bannerViewAll.addEventListener('click', () => this.applyFilter('all'));

        // Demo toggle pills — visual toggle only
        const riskPill = document.querySelector('.demo-pill--red');
        const cleanPill = document.querySelector('.demo-pill--green');
        if (riskPill) riskPill.addEventListener('click', () => riskPill.classList.toggle('demo-pill--active'));
        if (cleanPill) cleanPill.addEventListener('click', () => cleanPill.classList.toggle('demo-pill--active'));
    },

    _bindSelectAll() {
        const chkAll = document.getElementById('chk-all');
        if (!chkAll) return;
        chkAll.addEventListener('change', () => {
            const checkboxes = document.querySelectorAll('#issues-tbody .row-chk');
            checkboxes.forEach(c => {
                c.checked = chkAll.checked;
                const fileId = c.dataset.fileId;
                if (!fileId) return;
                if (chkAll.checked) this._selectedFileIds.add(fileId);
                else                this._selectedFileIds.delete(fileId);
            });
            BulkActionBar.update();
        });
        document.addEventListener('change', (e) => {
            if (!e.target.classList.contains('row-chk')) return;
            const fileId = e.target.dataset.fileId;
            if (fileId) {
                if (e.target.checked) this._selectedFileIds.add(fileId);
                else                  this._selectedFileIds.delete(fileId);
            }
            const all = [...document.querySelectorAll('#issues-tbody .row-chk')];
            chkAll.checked = all.length > 0 && all.every(c => c.checked);
            BulkActionBar.update();
        });
    },

    _bindResetFilters() {
        const btn = document.getElementById('btn-reset-filters');
        const menu = document.getElementById('quick-filter-menu');
        if (!btn || !menu || btn._quickFilterBound) return;
        btn._quickFilterBound = true;
        const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
        btn.addEventListener('click', () => {
            menu.hidden = !menu.hidden;
            btn.setAttribute('aria-expanded', String(!menu.hidden));
        });
        menu.addEventListener('click', event => {
            const option = event.target.closest('[data-quick-filter]');
            if (!option) return;
            this._quickFilter = option.dataset.quickFilter || '';
            btn.querySelector('span').textContent = option.textContent;
            this._pagination.currentPage = 1;
            close();
            this._applyFull();
        });
        if (!this._quickFilterDocumentBound) {
            this._quickFilterDocumentBound = true;
            document.addEventListener('click', event => {
                if (!event.target.closest('.quick-filter-control')) close();
            });
            document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
        }
    },

    _bindAnalysisSort() {
        const table = document.getElementById('issues-table');
        if (!table || table._analysisSortBound) return;
        table._analysisSortBound = true;
        table.querySelector('thead')?.addEventListener('click', event => {
            const header = event.target.closest('[data-analysis-sort]');
            if (!header) return;
            const key = header.dataset.analysisSort;
            this._analysisSort.direction = this._analysisSort.key === key && this._analysisSort.direction === 'asc' ? 'desc' : 'asc';
            this._analysisSort.key = key;
            this._pagination.currentPage = 1;
            this._updateAnalysisSortIndicators();
            this._applyFull();
        });
        this._updateAnalysisSortIndicators();
    },

    _updateAnalysisSortIndicators() {
        document.querySelectorAll('[data-analysis-sort]').forEach(header => {
            const icon = header.querySelector('.sort-icon');
            if (!icon) return;
            const active = header.dataset.analysisSort === this._analysisSort.key;
            icon.className = `fas ${active ? (this._analysisSort.direction === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} sort-icon${active ? ' sort-icon--active' : ''}`;
        });
    },

    _bindFilterBar() {
        const chipGroups = document.getElementById('chip-groups');
        if (!chipGroups) return;
        chipGroups.addEventListener('click', (e) => {
            const chip = e.target.closest('.wix-chip');
            if (!chip) return;
            const group = chip.dataset.group;
            const val   = chip.dataset.val;
            if (!group || !val) return;
            const wasActive = chip.classList.contains('is-active');
            chipGroups.querySelectorAll(`.wix-chip[data-group="${group}"]`).forEach(c => c.classList.remove('is-active'));
            if (wasActive) {
                this._activeChipFilters[group] = null;
            } else {
                chip.classList.add('is-active');
                this._activeChipFilters[group] = val;
            }
            this._applyFull();
        });
    },

    _bindSearch() {
        const input = document.getElementById('search-input');
        if (!input) return;
        let timer = null;
        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => this._applyFull(), 250);
        });
    },

    _bindFileTypeFilter() {
        const ftf = document.getElementById('file-type-filter');
        if (!ftf) return;
        populateFileTypeFilter(ftf);
        ftf.addEventListener('change', () => this._applyFull());
    },

    // ── MASTER FILTER ────────────────────────────────────────────
    _applyFull() {
        if (!this.allScannedFiles.length) return;

        let result = this._getBaseForType(this.currentFilterType);

        const statusChip = this._activeChipFilters.status;
        if (statusChip) {
            result = result.filter(f => this._matchesStatusFilter(f, statusChip));
        }

        const typeChip = this._activeChipFilters.type;
        if (typeChip) {
            if (typeChip === 'pdf')      result = result.filter(f => f.mimeType.includes('pdf'));
            else if (typeChip === 'image')    result = result.filter(f => f.mimeType.includes('image'));
            else if (typeChip === 'video')    result = result.filter(f => f.mimeType.includes('video'));
            else if (typeChip === 'document') result = result.filter(f =>
                f.mimeType.includes('document') || f.mimeType.includes('spreadsheet') || f.mimeType.includes('presentation')
            );
            else if (typeChip === 'zip')  result = result.filter(f => f.mimeType.includes('zip') || f.mimeType.includes('archive'));
        }

        const sizeChip = this._activeChipFilters.size;
        if (sizeChip) {
            const MB = 1024 * 1024;
            if (sizeChip === 'lt10')    result = result.filter(f => parseInt(f.size || 0) < 10 * MB);
            if (sizeChip === '10to100') result = result.filter(f => { const s = parseInt(f.size || 0); return s >= 10 * MB && s <= 100 * MB; });
            if (sizeChip === 'gt100')   result = result.filter(f => parseInt(f.size || 0) > 100 * MB);
        }

        const timeChip = this._activeChipFilters.time;
        if (timeChip) {
            const thresholdMs = parseInt(timeChip, 10) * 86400000;
            result = result.filter(f => {
                const activity = new Date(f.modifiedTime || f.createdTime).getTime();
                return Number.isFinite(activity) && Date.now() - activity >= thresholdMs;
            });
        }

        const ftf = document.getElementById('file-type-filter');
        if (ftf && ftf.value) result = result.filter(f => matchesFileTypeFilter(f, ftf.value));

        const q = (document.getElementById('search-input')?.value || '').trim().toLowerCase();
        if (q) result = result.filter(f => (f.name || '').toLowerCase().includes(q));

        result = this._applyQuickFilter(result);

        if (!result || result.length === 0) EmptyState.show('clean');
        else EmptyState.hide();

        this.renderTable(result);
        this._updateFilterLabel(this.currentFilterType, result.length);
        this._updateAlertBanner();
    },

    _matchesStatusFilter(file, status) {
        const perms = file.permissions || [];
        const isPublic = perms.some(p => p.type === 'anyone');
        const isDomain = perms.some(p => p.type === 'domain');
        const isPrivate = !isPublic && !isDomain && (file.ownedByMe && perms.length <= 1);
        if (status === 'public') return isPublic;
        if (status === 'internal') return isDomain;
        if (status === 'private') return isPrivate;
        if (status === 'shared') return !file.ownedByMe;
        return true;
    },

    _applyQuickFilter(files) {
        const filter = this._quickFilter;
        if (!filter) return files;
        if (['public', 'private', 'internal', 'shared'].includes(filter)) {
            return files.filter(file => this._matchesStatusFilter(file, filter));
        }
        const ids = new Set(this._getBaseForType(filter).map(file => file.id));
        return files.filter(file => ids.has(file.id));
    },

    // ── Base set per KPI card type ────────────────────────────────
    _getBaseForType(type) {
        if (type === 'issues') {
            const allFolderIds = new Set();
            this.allScannedFiles.forEach(f => { if (f.mimeType && f.mimeType.includes('folder')) allFolderIds.add(f.id); });
            return this.allScannedFiles.filter(f =>
                f.parents && f.parents.length > 0 &&
                !allFolderIds.has(f.parents[0]) &&
                f.ownedByMe && !f.trashed &&
                f.mimeType && !f.mimeType.includes('folder')
            );
        } else if (type === 'mine') {
            return this.allScannedFiles.filter(f => f.ownedByMe);
        } else if (type === 'stale') {
            return this.allScannedFiles.filter(f => {
                if (f.trashed) return false;
                return isStaleFile(f);
            });
        } else if (type === 'dupes') {
            const duplicateIndex = this._getDuplicateIndex();
            const result = duplicateIndex.duplicateFilesWithGroupIndex;
            const groups = duplicateIndex.groupCount;
            if (result.length > 0) Toast.info(I18n.t('toast.dupesFound').replace('{groups}', fmt(groups)).replace('{files}', fmt(result.length)));
            else Toast.success(I18n.t('toast.noDupes'));
            return result;
        } else if (type === 'public') {
            return this.allScannedFiles.filter(f =>
                f.ownedByMe && !f.trashed && (f.permissions || []).some(p => p.type === 'anyone')
            );
        } else if (type === 'empty') {
            const parentSet = new Set();
            this.allScannedFiles.forEach(f => { if (f.parents) f.parents.forEach(p => parentSet.add(p)); });
            return this.allScannedFiles.filter(f =>
                f.mimeType && f.mimeType.includes('folder') && !f.trashed && !parentSet.has(f.id)
            );
        } else if (type === 'orphan') {
            return this.allScannedFiles.filter(f =>
                (!f.parents || !f.parents.length) && !f.trashed && f.ownedByMe && !f.shared &&
                f.mimeType && !f.mimeType.includes('folder')
            );
        } else if (type === 'trash') {
            return this.allScannedFiles.filter(f => f.trashed);
        }
        return this.allScannedFiles; // 'all'
    },

    _bindShareModal() {
        const { shareModal, btnCloseModal } = this.el;
        if (btnCloseModal) btnCloseModal.addEventListener('click', () => shareModal.style.display = 'none');
        if (shareModal) shareModal.addEventListener('click', (e) => {
            if (e.target.id === 'shareDetailModal') shareModal.style.display = 'none';
        });
    },

    _bindDownloadModal() {
        const { btnCancelDl } = this.el;
        if (btnCancelDl && !btnCancelDl._listenerAttached) {
            btnCancelDl.addEventListener('click', () => {
                if (this.currentDownloader) this.currentDownloader.cancel();
                this.el.dlModal.style.display = 'none';
            });
            btnCancelDl._listenerAttached = true;
        }
    },

    // ── SIDE PANEL ──────────────────────────────────────────────
    _bindSidePanel() {
        // Close panel
        const overlay  = document.getElementById('side-panel-overlay');
        const closeBtn = document.getElementById('panel-close');
        if (overlay)  overlay.addEventListener('click', () => this._closePanel());
        if (closeBtn) closeBtn.addEventListener('click', () => this._closePanel());

        // Risk card action buttons → open panel
        document.querySelectorAll('.risk-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._openPanel(btn.dataset.actionType);
            });
        });

        // Info cards click → open panel
        document.querySelectorAll('.info-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.info-action-btn')) return;
                this._openPanel(card.dataset.panelType);
            });
        });
        document.querySelectorAll('.info-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._openPanel(btn.dataset.actionType);
            });
        });

        // "Xem tất cả" → switch to file list tab with filter
        const viewAllBtn = document.getElementById('panel-view-all');
        if (viewAllBtn) viewAllBtn.addEventListener('click', () => {
            const type = this._currentPanelType || 'all';
            this._closePanel();
            this._navigateFromOverviewCard(type);
        });

        // Close on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this._closePanel();
        });
    },

    _currentPanelType: null,

    _openPanel(type) {
        if (!this.allScannedFiles.length) return;
        this._currentPanelType = type;

        const panel   = document.getElementById('side-panel');
        const overlay = document.getElementById('side-panel-overlay');
        if (!panel) return;

        // Populate panel
        this._populatePanel(type);

        // Show
        if (overlay) overlay.style.display = 'block';
        panel.classList.add('is-open');
        panel.setAttribute('aria-hidden', 'false');

        // Lock scroll
        document.body.style.overflow = 'hidden';

        // Accessibility: focus handling
        this._previousFocusedEl = document.activeElement;
        const closeBtn = panel.querySelector('.side-panel__close');
        if (closeBtn) closeBtn.focus();

        // Setup focus trap
        this._panelFocusTrapHandler = (e) => {
            if (e.key !== 'Tab') return;
            const focusable = panel.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
            if (!focusable || focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey) {
                if (document.activeElement === first) { e.preventDefault(); last.focus(); }
            } else {
                if (document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        };
        document.addEventListener('keydown', this._panelFocusTrapHandler);
    },

    _closePanel() {
        const panel   = document.getElementById('side-panel');
        const overlay = document.getElementById('side-panel-overlay');
        if (panel) { panel.classList.remove('is-open'); panel.setAttribute('aria-hidden', 'true'); }
        if (overlay) overlay.style.display = 'none';
        this._currentPanelType = null;
        // Restore scroll
        document.body.style.overflow = '';
        // Remove focus trap
        if (this._panelFocusTrapHandler) {
            document.removeEventListener('keydown', this._panelFocusTrapHandler);
            this._panelFocusTrapHandler = null;
        }
        // Restore previous focus
        try { if (this._previousFocusedEl && this._previousFocusedEl.focus) this._previousFocusedEl.focus(); } catch (e) {}
    },

    _populatePanel(type) {
        const files = this._getBaseForType(type);
        const titleEl   = document.getElementById('panel-title');
        const countEl   = document.getElementById('panel-count');
        const viewAllCountEl = document.getElementById('panel-view-all-count');

        const titleMap = {
            all: I18n.t('kpi.totalFiles.label'), public: I18n.t('risk.publicLabel'),
            stale: I18n.t('risk.staleLabel').replace('{n}', STALE_THRESHOLD_DAYS), dupes: I18n.t('risk.dupesLabel'),
            issues: I18n.t('kpi.issues.label'), empty: I18n.t('kpi.empty.label'),
            orphan: I18n.t('kpi.orphan.label'), trash: I18n.t('kpi.trash.label'),
            storage: I18n.t('kpi.storage.label'),
        };
        if (titleEl) titleEl.innerText = titleMap[type] || titleMap.all;
        if (countEl) countEl.innerText = fmt(files.length);
        if (viewAllCountEl) viewAllCountEl.innerText = fmt(files.length);

        // Category breakdown — horizontal bar chart
        const breakdownEl = document.getElementById('panel-breakdown');
        if (breakdownEl) {
            const stats = { image: 0, video: 0, doc: 0, other: 0 };
            const COLORS = { image: '#f59e0b', video: '#10b981', doc: '#9ca3af', other: '#8b5cf6' };
            const LABELS = {
                image: I18n.t('chart.image') || 'Ảnh', video: 'Video',
                doc: I18n.t('chart.doc') || 'Tài liệu', other: I18n.t('chart.other') || 'Khác'
            };
            files.forEach(f => {
                if (f.mimeType.includes('image'))      stats.image++;
                else if (f.mimeType.includes('video')) stats.video++;
                else if (f.mimeType.includes('document') || f.mimeType.includes('sheet') || f.mimeType.includes('presentation')) stats.doc++;
                else stats.other++;
            });
            const sorted = Object.entries(stats).sort((a, b) => b[1] - a[1]);
            const total = files.length || 1;
            breakdownEl.innerHTML = sorted.map(([key, val], i) => {
                const pct = Math.round((val / total) * 100);
                return `
                    <div class="panel-hbar-row" style="--bar-delay:${i * 80}ms">
                        <div class="panel-hbar-meta">
                            <span class="panel-hbar-dot" style="background:${COLORS[key]}"></span>
                            <span class="panel-hbar-label">${LABELS[key]}</span>
                            <span class="panel-hbar-count">${fmt(val)}</span>
                        </div>
                        <div class="panel-hbar-track">
                            <div class="panel-hbar-fill" style="--bar-pct:${pct}%;background:${COLORS[key]}"></div>
                        </div>
                    </div>`;
            }).join('');
        }

        // Sample files (top 3 by size)
        const sampleEl = document.getElementById('panel-sample-files');
        if (sampleEl) {
            const sorted = [...files].sort((a, b) => (parseInt(b.size||0) - parseInt(a.size||0)));
            const top3 = sorted.slice(0, 3);
            if (top3.length === 0) {
                sampleEl.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">${I18n.t('info.noData')}</p>`;
            } else {
                sampleEl.innerHTML = top3.map(f => {
                    const path = this._getFilePath(f);
                    return `
                    <div class="panel-file-item">
                        <div class="panel-file-icon">${this._fileIcon(f.name, f.mimeType)}</div>
                        <div class="panel-file-info">
                            <div class="panel-file-name">${escapeHtml(f.name || '')}</div>
                            <div class="panel-file-path">${escapeHtml(path)}</div>
                        </div>
                        <div class="panel-file-size">${formatBytes(parseInt(f.size||0))}</div>
                    </div>`;
                }).join('');
            }
        }
    },

    // ── Scan ──────────────────────────────────────────────────────
    async runScan() {
        // Delegate to ScanFlowController — shows progress view (IMAGE 3)
        // then returns to dashboard on completion (skips result for rescan)
        const { btnRefresh } = this.el;
        if (btnRefresh) {
            btnRefresh.disabled = true;
            btnRefresh.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${I18n.t('btn.connecting')}`;
        }

        this._selectedFileIds.clear();
        BulkActionBar.update();

        try {
            await ScanFlowController.rescan();
        } finally {
            if (btnRefresh) {
                btnRefresh.disabled = false;
                btnRefresh.innerHTML = `<i class="fas fa-search"></i> ${I18n.t('btn.analyze')}`;
            }
        }
    },

    // ── Stats ─────────────────────────────────────────────────────
    async updateStats(files) {
        let countStale  = 0;
        const countPublic = computeSharingMetrics(files).public;

        const _allFolderIds = new Set(
            files.filter(f => f.mimeType && f.mimeType.includes('folder')).map(f => f.id)
        );
        const _problemFileIds = new Set();

        files.forEach(f => {
            if (isPublicFile(f)) _problemFileIds.add(f.id);

            if (!f.trashed) {
                if (isStaleFile(f)) { countStale++; _problemFileIds.add(f.id); }
            }
        });

        const duplicateIndex = this._getDuplicateIndex();
        const dupeGroups = duplicateIndex.groupCount;
        const dupeFiles  = duplicateIndex.duplicateFilesWithGroupIndex;
        dupeFiles.forEach(f => _problemFileIds.add(f.id));

        const countRootLevel = files.filter(f =>
            f.parents && f.parents.length > 0 &&
            !_allFolderIds.has(f.parents[0]) &&
            f.ownedByMe && !f.trashed &&
            f.mimeType && !f.mimeType.includes('folder')
        ).length;

        const parentSet = new Set();
        files.forEach(f => { if (f.parents) f.parents.forEach(p => parentSet.add(p)); });
        const countEmpty = files.filter(f =>
            f.mimeType && f.mimeType.includes('folder') && !f.trashed && !parentSet.has(f.id)
        ).length;

        const countOrphan = files.filter(f =>
            (!f.parents || !f.parents.length) && !f.trashed && f.ownedByMe && !f.shared &&
            f.mimeType && !f.mimeType.includes('folder')
        ).length;

        const countTrash = files.filter(f => f.trashed).length;

        // Save counts
        this._cardCounts = {
            all: files.length, issues: countRootLevel,
            mine: files.filter(f => f.ownedByMe).length,
            stale: countStale, dupes: dupeGroups, public: countPublic,
            empty: countEmpty, orphan: countOrphan, trash: countTrash
        };

        // ── Populate Drive Info Cards ──
        const el = (id) => document.getElementById(id);
        const setText = (id, v) => { const e = el(id); if (e) e.innerText = v; };
        setText('stat-total-files', fmt(files.length));
        setText('stat-issues-count', fmt(countRootLevel));
        setText('stat-empty-folders', fmt(countEmpty));
        setText('stat-orphan-files', fmt(countOrphan));
        setText('stat-trash-files', fmt(countTrash));

        // Orphan & Trash badges and no-data labels
        const orphanBadge = el('info-badge-orphan');
        if (orphanBadge) orphanBadge.style.display = countOrphan === 0 ? 'inline-flex' : 'none';
        const trashBadge = el('info-badge-trash');
        if (trashBadge) trashBadge.style.display = countTrash === 0 ? 'inline-flex' : 'none';
        const orphanNoData = el('orphan-no-data');
        if (orphanNoData) orphanNoData.style.display = countOrphan === 0 ? 'block' : 'none';
        const trashNoData = el('trash-no-data');
        if (trashNoData) trashNoData.style.display = countTrash === 0 ? 'block' : 'none';

        // ── Populate Risk Cards ──
        setText('risk-val-public', fmt(countPublic));
        setText('risk-val-stale', fmt(countStale));
        setText('risk-label-stale', I18n.t('risk.staleLabel').replace('{n}', STALE_THRESHOLD_DAYS));
        setText('risk-val-dupes', dupeGroups > 0
            ? I18n.t('risk.dupesGroups').replace('{n}', fmt(dupeGroups)) : '0');

        // Risk badge state (resolved vs risk)
        this._updateRiskBadge('risk-badge-public', countPublic, 'risk.high', 'red');
        this._updateRiskBadge('risk-badge-stale',  countStale,  'risk.review', 'orange');
        this._updateRiskBadge('risk-badge-dupes',  dupeGroups,  'risk.waste', 'purple');

        // Risk card value colors (green when resolved)
        const setValColor = (id, count, riskColor) => {
            const e = el(id);
            if (e) {
                e.className = 'issue-card-value ' + (count === 0 ? 'issue-card-value--green' : `issue-card-value--${riskColor}`);
            }
        };
        setValColor('risk-val-public', countPublic, 'red');
        setValColor('risk-val-stale', countStale, 'orange');
        setValColor('risk-val-dupes', dupeGroups, 'purple');

        // ── Section label ──
        const issueCount = (countPublic > 0 ? 1 : 0) + (countStale > 0 ? 1 : 0) + (dupeGroups > 0 ? 1 : 0);
        const score = calculateSecurityScore(files, {
            isStale: isStaleFile,
            countDuplicateGroups: () => duplicateIndex.groupCount,
        });
        const totalBadge = el('info-badge-total');
        if (totalBadge) {
            if (score.issueCount === 0) {
                totalBadge.className = 'info-card-badge info-card-badge--green';
                totalBadge.innerHTML = `<i class="fas fa-check"></i> <span>${I18n.t('info.normal')}</span>`;
            } else {
                totalBadge.className = 'info-card-badge issue-card-badge--orange';
                totalBadge.innerHTML = `<i class="fas fa-exclamation-triangle"></i> <span>${I18n.t('risk.review')}</span>`;
            }
        }
        this._renderSecurityScore(score.issueCount, score.securityScore);
        const issueSummary = el('risk-issue-summary');
        if (issueSummary) issueSummary.innerText = I18n.t('section.issueCount').replace('{n}', issueCount);

        // ── Action section descriptions ──
        const actionRevoke = el('action-revoke-desc');
        if (actionRevoke) actionRevoke.innerText = I18n.t('action.revokeDesc').replace('{n}', fmt(countPublic));
        const actionClean = el('action-clean-desc');
        if (actionClean) actionClean.innerText = I18n.t('action.cleanDesc').replace('{n}', fmt(countStale));
        const actionDupes = el('action-dupes-desc');
        if (actionDupes) actionDupes.innerText = I18n.t('action.dupesDesc').replace('{n}', fmt(dupeGroups));

        // ── Deduction values ──
        this._updateDeductions(
            score.deductions.public,
            score.deductions.external,
            score.deductions.stale,
            score.deductions.other,
            score.deductions.duplicates
        );

        // ── Charts ──
        this._renderCharts();

        // ── Progress circles ──
        this._updateProgressCircles();

        // ── Sidebar ──
        await this._loadDriveStorage();
        this._buildFolderMap(files);
        this.updateDocumentMap(files);
    },

    _updateRiskBadge(badgeId, count, riskKey, riskColor) {
        const badge = document.getElementById(badgeId);
        if (!badge) return;
        if (count === 0) {
            badge.className = 'issue-card-badge issue-card-badge--green';
            badge.innerHTML = `<i class="fas fa-check"></i> <span>${I18n.t('risk.resolved')}</span>`;
        } else {
            badge.className = `issue-card-badge issue-card-badge--${riskColor}`;
            badge.innerHTML = `<i class="fas fa-exclamation-triangle"></i> <span>${I18n.t(riskKey)}</span>`;
        }
    },

    _renderSecurityScore(issueCount, securityScore) {
        const el = (id) => document.getElementById(id);
        const container = el('security-score');
        if (!container) return;

        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

        container.style.display = 'block';

        // Score
        const scoreEl = el('security-score-value');
        if (scoreEl) scoreEl.textContent = securityScore;

        // Status
        const statusEl = el('security-score-status');
        if (statusEl) {
            if (securityScore >= 70) statusEl.textContent = I18n.t('security.excellent');
            else statusEl.textContent = I18n.t('security.improve');
        }

        // Meter
        const meterFill = el('security-meter-fill');
        const meterDot = el('security-meter-dot');
        if (meterFill) meterFill.style.width = `${Math.min(100, securityScore)}%`;
        if (meterDot) meterDot.style.left = `${Math.min(100, securityScore)}%`;

        // Description
        const descEl = el('security-score-desc');
        if (descEl) {
            if (issueCount > 0) {
                descEl.innerText = I18n.t('security.desc')
                    .replace('{n}', issueCount)
                    .replace('{time}', timeStr);
            } else {
                descEl.innerText = I18n.t('security.descClean');
            }
        }

        // How button — use addEventListener, not onclick
        const howBtn = el('security-score-how');
        if (howBtn) {
            howBtn.textContent = I18n.t('security.how');
            if (!howBtn._listenerAttached) {
                howBtn.addEventListener('click', () => this._openScoreHelpModal());
                howBtn._listenerAttached = true;
            }
        }
    },

    _updateDeductions(publicPts, externalPts, stalePts, otherPts, dupesPts) {
        const setText = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        setText('deduction-public', `-${publicPts}`);
        setText('deduction-external', `-${externalPts}`);
        setText('deduction-stale', `-${stalePts}`);
        setText('deduction-other', `-${otherPts}`);
        setText('deduction-dupes', `-${dupesPts}`);
        const total = publicPts + externalPts + stalePts + otherPts + dupesPts;
        setText('deductions-total', total);
    },

    _openScoreHelpModal() {
        const overlay = document.getElementById('scoreHelpOverlay');
        if (!overlay) return;
        this._populateScoreHelpModal();
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    },

    _closeScoreHelpModal() {
        const overlay = document.getElementById('scoreHelpOverlay');
        if (!overlay) return;
        overlay.classList.remove('open');
        document.body.style.overflow = '';
    },

    _populateScoreHelpModal() {
        const cards = this._cardCounts;
        if (!cards) return;
        const total = cards.all || 1;
        const setText = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };

        const lvlPublic = Math.min((cards.public / total), 1);
        const penPublic = Math.round(Math.min(40 * lvlPublic, 40));
        setText('sh-level-public', lvlPublic.toFixed(2));
        setText('sh-penalty-public', penPublic);

        const lvlExternal = 0;
        const penExternal = 0;
        setText('sh-level-external', lvlExternal.toFixed(2));
        setText('sh-penalty-external', penExternal);

        const lvlStale = Math.min((cards.stale / total), 1);
        const penStale = Math.round(Math.min(15 * lvlStale, 15));
        setText('sh-level-stale', lvlStale.toFixed(2));
        setText('sh-penalty-stale', penStale);

        const otherCount = (cards.trash || 0) + (cards.orphan || 0) + (cards.issues || 0) + (cards.empty || 0);
        const lvlOther = Math.min((otherCount / total), 1);
        const penOther = Math.round(Math.min(15 * lvlOther, 15));
        setText('sh-level-other', lvlOther.toFixed(2));
        setText('sh-penalty-other', penOther);

        const lvlDupes = Math.min(((cards.dupes || 0) / total), 1);
        const penDupes = Math.round(Math.min(10 * lvlDupes, 10));
        setText('sh-level-dupes', lvlDupes.toFixed(2));
        setText('sh-penalty-dupes', penDupes);

        const totalPen = penPublic + penExternal + penStale + penOther + penDupes;
        const score = Math.max(0, Math.min(100, 100 - totalPen));
        setText('sh-score', score);

        const remaining = score;
        const setFlex = (id, v) => { const e = document.getElementById(id); if (e) e.style.flex = String(Math.max(v, 1)); };
        setFlex('svb-remaining', remaining);
        setFlex('svb-public', penPublic);
        setFlex('svb-stale', penStale);
        setFlex('svb-dupes', penDupes);
        const svbOther = document.getElementById('svb-other');
        if (svbOther) svbOther.style.flex = String(Math.max(penOther, 1));
        const svbText = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = String(v); };
        svbText('svb-remaining', remaining);
        svbText('svb-public', penPublic > 0 ? `-${penPublic}` : '0');
        svbText('svb-stale', penStale > 0 ? `-${penStale}` : '0');
        svbText('svb-dupes', penDupes > 0 ? `-${penDupes}` : '0');
        const svbOtherText = document.getElementById('svb-other');
        if (svbOtherText) svbOtherText.textContent = penOther > 0 ? `-${penOther}` : '0';
    },

    _initScoreHelpModal() {
        const overlay = document.getElementById('scoreHelpOverlay');
        if (!overlay) return;
        const modal = document.getElementById('scoreHelpModal');
        const closeBtn = document.getElementById('scoreHelpClose');
        const closeCaptionBtn = document.getElementById('scoreHelpCloseBtn');
        const fixBtn = document.getElementById('scoreHelpFixBtn');
        const boundClose = () => this._closeScoreHelpModal();
        if (closeBtn) closeBtn.addEventListener('click', boundClose);
        if (closeCaptionBtn) closeCaptionBtn.addEventListener('click', boundClose);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this._closeScoreHelpModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.classList.contains('open')) this._closeScoreHelpModal();
        });
        if (fixBtn) {
            fixBtn.addEventListener('click', () => {
                this._closeScoreHelpModal();
                const cleanupSection = document.getElementById('cleanup-section');
                if (cleanupSection) cleanupSection.scrollIntoView({ behavior: 'smooth' });
            });
        }
    },

    _renderScanTime() {
        const badge = document.getElementById('scan-time-badge');
        const valueEl = document.getElementById('scan-time-value');
        if (!badge || !valueEl || !this._lastScanTime) return;
        const t = this._lastScanTime;
        const timeStr = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
        valueEl.innerText = I18n.t('scan.today').replace('{time}', timeStr);
        badge.style.display = 'inline-flex';
    },

    _updateAlertBanner() {
        const banner = document.getElementById('alert-banner-public');
        const countEl = document.getElementById('banner-public-count');
        if (!banner) return;
        const countPublic = this._cardCounts?.public || 0;
        if (countPublic > 0) {
            banner.style.display = 'flex';
            if (countEl) countEl.innerText = `${fmt(countPublic)} files`;
        } else {
            banner.style.display = 'none';
        }
    },

    // ── Sync KPI sau mỗi thao tác cục bộ ───────────────
    _syncKPIAfterChange() {
        const files = this.allScannedFiles;
        if (!files.length) return;
        this._duplicateIndex = null;

        const setText = (id, v) => { const e = document.getElementById(id); if (e) e.innerText = v; };
        setText('stat-total-files', fmt(files.length));

        const countTrash = files.filter(f => f.trashed).length;
        setText('stat-trash-files', fmt(countTrash));

        const allFolderIds = new Set(
            files.filter(f => f.mimeType && f.mimeType.includes('folder')).map(f => f.id)
        );
        const countRootLevel = files.filter(f =>
            f.parents && f.parents.length > 0 &&
            !allFolderIds.has(f.parents[0]) &&
            f.ownedByMe && !f.trashed &&
            f.mimeType && !f.mimeType.includes('folder')
        ).length;
        setText('stat-issues-count', fmt(countRootLevel));

        const countPublic = computeSharingMetrics(files).public;

        const countStale = files.filter(f => {
            if (f.trashed) return false;
            return isStaleFile(f);
        }).length;

        const countOrphan = files.filter(f =>
            (!f.parents || !f.parents.length) && !f.trashed && f.ownedByMe && !f.shared &&
            f.mimeType && !f.mimeType.includes('folder')
        ).length;
        setText('stat-orphan-files', fmt(countOrphan));

        const parentSet = new Set();
        files.forEach(f => { if (f.parents) f.parents.forEach(p => parentSet.add(p)); });
        const countEmpty = files.filter(f =>
            f.mimeType && f.mimeType.includes('folder') && !f.trashed && !parentSet.has(f.id)
        ).length;
        setText('stat-empty-folders', fmt(countEmpty));

        const duplicateIndex = this._getDuplicateIndex();
        const dupeGroups = duplicateIndex.groupCount;
        this._cardCounts = {
            all: files.length, issues: countRootLevel,
            mine: files.filter(f => f.ownedByMe).length,
            stale: countStale, dupes: dupeGroups, public: countPublic,
            empty: countEmpty, orphan: countOrphan, trash: countTrash
        };

        // Update risk cards
        setText('risk-val-public', fmt(countPublic));
        setText('risk-val-stale', fmt(countStale));
        setText('risk-label-stale', I18n.t('risk.staleLabel').replace('{n}', STALE_THRESHOLD_DAYS));
        setText('risk-val-dupes', dupeGroups > 0
            ? I18n.t('risk.dupesGroups').replace('{n}', fmt(dupeGroups)) : '0');
        this._updateRiskBadge('risk-badge-public', countPublic, 'risk.high', 'red');
        this._updateRiskBadge('risk-badge-stale',  countStale,  'risk.review', 'orange');
        this._updateRiskBadge('risk-badge-dupes',  dupeGroups,  'risk.waste', 'purple');

        // Update security score
        const score = calculateSecurityScore(files, {
            isStale: isStaleFile,
            countDuplicateGroups: () => duplicateIndex.groupCount,
        });
        this._renderSecurityScore(score.issueCount, score.securityScore);

        // Update deductions
        this._updateDeductions(
            score.deductions.public,
            score.deductions.external,
            score.deductions.stale,
            score.deductions.other,
            score.deductions.duplicates
        );

        // Update progress circles
        this._updateProgressCircles();

        // Update charts
        this._renderCharts();

        // Info badges and no-data labels
        const orphanBadge = document.getElementById('info-badge-orphan');
        if (orphanBadge) orphanBadge.style.display = countOrphan === 0 ? 'inline-flex' : 'none';
        const trashBadge = document.getElementById('info-badge-trash');
        if (trashBadge) trashBadge.style.display = countTrash === 0 ? 'inline-flex' : 'none';
        const orphanNoData = document.getElementById('orphan-no-data');
        if (orphanNoData) orphanNoData.style.display = countOrphan === 0 ? 'block' : 'none';
        const trashNoData = document.getElementById('trash-no-data');
        if (trashNoData) trashNoData.style.display = countTrash === 0 ? 'block' : 'none';
    },

    async _loadDriveStorage() {
        const { statOptimize } = this.el;
        try {
            const token = await getAuthTokenSilently();
            const res   = await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota', {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data  = await res.json();
            const quota = data.storageQuota || {};
            const used  = parseInt(quota.usage || 0);
            const total = parseInt(quota.limit || 0);
            if (statOptimize) {
                statOptimize.innerText = total > 0
                    ? `${formatBytes(used)} / ${formatBytes(total)}`
                    : formatBytes(used);
            }
            this._renderStorageUI(used, total);
            this._lastStorageUsed  = used;
            this._lastStorageTotal = total;
            this._renderCharts();
        } catch (_) {
            const fallbackUsed = FileAnalyzer.calcMyDriveSize(this.allScannedFiles);
            if (statOptimize) statOptimize.innerText = formatBytes(fallbackUsed);
            this._renderStorageUI(fallbackUsed, 0);
            this._lastStorageUsed  = fallbackUsed;
            this._lastStorageTotal = 0;
            this._renderCharts();
        }
    },

    _renderStorageUI(used, total) {
        const barFill  = document.getElementById('storage-bar-fill');
        const textEl   = document.getElementById('storage-text');
        const adviceEl = document.getElementById('storage-advice');
        if (!barFill) return;
        if (!total || total <= 0) {
            barFill.style.width = '100%';
            if (textEl)   textEl.innerText   = I18n.t('storage.unlimited');
            if (adviceEl) adviceEl.innerText = I18n.t('storage.clickMine');
            return;
        }
        const percent    = Math.min(100, (used / total) * 100);
        const pctRounded = Math.round(percent);
        barFill.style.width = `${percent}%`;
        const wrap = document.getElementById('storage-bar-wrap');
        if (wrap) wrap.style.display = 'block';
        if (percent > 90)      barFill.style.background = '#e74a3b';
        else if (percent > 70) barFill.style.background = '#f59e0b';
        else                   barFill.style.background = 'linear-gradient(90deg, #0052CD, #058EF4)';
        if (adviceEl) adviceEl.innerText = I18n.t('storage.usedPct').replace('{n}', pctRounded);
        if (textEl)   textEl.innerText   = I18n.t('storage.free').replace('{n}', formatBytes(total - used));
    },

    _recomputeStaleCount() {
        if (!this.allScannedFiles.length) return;
        // Recalculate stale and sync all KPIs
        this._syncKPIAfterChange();
    },

    // ── Main filter entry point ──────────────────
    applyFilter(type) {
        if (!this.allScannedFiles.length && type !== 'all') return;
        this.currentFilterType = type;
        this._applyFull();
    },

    _resetFileTypeFilter() {
        const filter = document.getElementById('file-type-filter');
        if (filter) filter.value = '';
    },

    _navigateFromOverviewCard(type) {
        this._resetFileTypeFilter();
        this._pagination.currentPage = 1;
        this.applyFilter(type);
        this._switchToTab('filelist');
    },

    _updateFilterLabel(type, count) {
        const badge = document.getElementById('list-status');
        if (badge) badge.innerText = `${fmt(count)} file`;
        this._updateAlertBanner();
    },

    // ── Table ─────────────────────────────────────────────────────
    _pagination: { currentPage: 1, pageSize: 15, totalFiles: [] },

    async renderTable(files) {
        const sorted = this._sortAnalysisFiles(files);
        this._pagination.totalFiles  = sorted;
        this._pagination.currentPage = 1;
        this._renderPage();
    },

    _sortAnalysisFiles(files) {
        return sortAnalysisFiles(files, this._analysisSort);
    },

    _renderPage() {
        const { tableBody, listStatus } = this.el;
        if (!tableBody) return;
        const { currentPage, pageSize, totalFiles } = this._pagination;
        const totalPages = Math.max(1, Math.ceil(totalFiles.length / pageSize));
        const safePage   = Math.min(currentPage, totalPages);
        this._pagination.currentPage = safePage;
        const start  = (safePage - 1) * pageSize;
        const sliced = totalFiles.slice(start, start + pageSize);

        if (listStatus) listStatus.innerText = `${fmt(totalFiles.length)} file`;

        if (sliced.length === 0) {
            tableBody.innerHTML = '';
            EmptyState.show("clean");
            this._renderPagination(0, 1, 1);
            return;
        }

        tableBody.innerHTML = sliced.map(file => this._buildRow(file)).join('');
        EmptyState.hide();

        tableBody.querySelectorAll('.row-chk').forEach(c => {
            if (this._selectedFileIds.has(c.dataset.fileId)) c.checked = true;
        });
        const chkAll = document.getElementById('chk-all');
        if (chkAll) {
            const all = [...tableBody.querySelectorAll('.row-chk')];
            chkAll.checked = all.length > 0 && all.every(c => c.checked);
        }
        BulkActionBar.update();

        // Bind action buttons
        tableBody.querySelectorAll('.btn-delete').forEach(btn         => btn.addEventListener('click', (e) => this.handleDeleteClick(e)));
        tableBody.querySelectorAll('.btn-restore').forEach(btn        => btn.addEventListener('click', (e) => this.handleRestoreClick(e)));
        tableBody.querySelectorAll('.btn-perm-delete').forEach(btn     => btn.addEventListener('click', (e) => this.handlePermanentDeleteClick(e)));
        tableBody.querySelectorAll('.btn-transfer-own').forEach(btn   => btn.addEventListener('click', (e) => this.handleTransferOwnershipClick(e)));
        tableBody.querySelectorAll('.btn-request-own').forEach(btn    => btn.addEventListener('click', (e) => this.handleRequestOwnershipClick(e)));
        tableBody.querySelectorAll('.btn-stop-sharing').forEach(btn   => btn.addEventListener('click', (e) => this.handleStopSharingClick(e)));
        tableBody.querySelectorAll('.btn-compare-dupes').forEach(btn  => btn.addEventListener('click', (e) => this.handleCompareDuplicatesClick(e)));
        tableBody.querySelectorAll('.td-shared[data-file-id]').forEach(td => {
            td.addEventListener('click', (e) => { e.stopPropagation(); this.handleShareInfoClick({ currentTarget: td }); });
        });
        tableBody.querySelectorAll('tr[data-file-id]').forEach(row => row.addEventListener('click', event => {
            if (!shouldOpenDashboardRowPreview(event.target)) return;
            const file = this.allScannedFiles.find(item => item.id === row.dataset.fileId);
            if (file) this._openFilePreview(file);
        }));
        tableBody.querySelectorAll('tr[data-file-id]').forEach(row => {
            row.addEventListener('pointerenter', () => {
                const file = this.allScannedFiles.find(item => item.id === row.dataset.fileId);
                if (file) this._quickPreview?.schedulePrefetch(file);
            });
            row.addEventListener('pointerleave', () => this._quickPreview?.cancelPrefetch());
        });
        this._renderPagination(totalFiles.length, safePage, totalPages);
    },

    _bindFilePreview() {
        this._quickPreview = new PreviewController({
            panel: document.getElementById('filePreview'),
            overlay: document.getElementById('previewOverlay'),
            area: document.getElementById('previewArea'),
            content: document.getElementById('previewContent'),
            fallbackIcon: document.getElementById('previewHeroIcon'),
            fallbackName: document.getElementById('previewHeroName'),
            fallbackBadge: document.getElementById('previewHeroBadge')
        });
        const close = () => this._closeFilePreview();
        document.getElementById('previewClose')?.addEventListener('click', close);
        document.getElementById('previewOverlay')?.addEventListener('click', close);
        document.getElementById('btnOpenDrive')?.addEventListener('click', () => {
            if (this._previewFile?.webViewLink) window.open(this._previewFile.webViewLink, '_blank');
        });
        document.getElementById('btnDeleteFile')?.addEventListener('click', () => this._deletePreviewFile());
    },

    _closeFilePreview() {
        this._quickPreview?.close();
        this._previewFile = null;
    },

    _openFilePreview(file) {
        const displayDates = getDisplayTimestamps(file);
        const set = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
        const permissions = Array.isArray(file.permissions) ? file.permissions : [];
        const status = file.trashed ? 'Thùng rác'
            : permissions.some(permission => permission.type === 'anyone') ? 'Công khai'
            : permissions.some(permission => permission.type === 'domain') ? 'Nội bộ'
            : file.shared ? 'Shared' : 'Riêng tư';
        const owner = file.owners?.[0]?.displayName || (file.ownedByMe ? 'Tôi' : 'Khác');
        set('previewFileName', file.name || '—');
        set('previewPath', this._getFilePath(file));
        set('previewStatus', status);
        set('previewOwner', owner);
        set('previewShared', getSharingDisplay(file));
        set('previewSize', Number(file.size) ? formatBytes(Number(file.size)) : '—');
        set('previewCreated', displayDates.createdTime ? formatDate(displayDates.createdTime) : '—');
        set('previewModified', displayDates.modifiedTime ? formatDate(displayDates.modifiedTime) : '—');
        this._previewFile = file;
        this._quickPreview?.open(file);
    },

    _deletePreviewFile() {
        const file = this._previewFile;
        if (!file?.id) return;
        ConfirmController.open(I18n.t('delete.confirm').replace('{n}', file.name || 'tệp này'), async () => {
            const operation = await requireCleanupMutation(file.id);
            if (!operation) return;
            const button = document.getElementById('btnDeleteFile');
            if (button?.disabled) return;
            if (button) button.disabled = true;
            try {
                await deleteFile(file.id);
                const index = this.allScannedFiles.findIndex(item => item.id === file.id);
                if (index !== -1) this.allScannedFiles[index].trashed = true;
                this._syncKPIAfterChange();
                await logAction({ type: 'delete', fileId: file.id, fileName: file.name, fileSize: file.size, actionLabel: 'Xóa file' }, operation);
                this._closeFilePreview();
                this._applyFull();
                Toast.success(I18n.t('delete.success').replace('{n}', file.name || 'tệp'));
            } catch (error) {
                await failReservedCleanup(operation);
                console.error('[QuickPreview][delete]', error);
                Toast.error(I18n.t('delete.error') + error.message);
                if (button) button.disabled = false;
            }
        });
    },

    _renderPagination(total, currentPage, totalPages) {
        let container = document.getElementById('table-pagination');
        if (!container) {
            container = document.createElement('div');
            container.id = 'table-pagination';
            const cardBody = document.querySelector('#issues-table')?.closest('.wix-card__body');
            if (cardBody) cardBody.appendChild(container);
        }
        if (totalPages <= 1) { container.innerHTML = ''; return; }

        const pageSize  = this._pagination.pageSize;
        const startItem = (currentPage - 1) * pageSize + 1;
        const endItem   = Math.min(currentPage * pageSize, total);

        const pages = [];
        if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) pages.push(i); }
        else {
            pages.push(1);
            if (currentPage > 3) pages.push('...');
            for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
            if (currentPage < totalPages - 2) pages.push('...');
            pages.push(totalPages);
        }

        const pageButtons = pages.map(pg =>
            pg === '...' ? `<span class="page-ellipsis">…</span>`
            : `<button class="page-btn${pg === currentPage ? ' page-btn-active' : ''}" data-page="${pg}">${pg}</button>`
        ).join('');

        container.innerHTML = `
            <div class="pagination-wrapper">
                <span class="pagination-info">${fmt(startItem)}–${fmt(endItem)} / ${fmt(total)} file</span>
                <div class="pagination-controls">
                    <button class="page-btn page-nav" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>${I18n.t('page.prev')}</button>
                    ${pageButtons}
                    <button class="page-btn page-nav" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>${I18n.t('page.next')}</button>
                </div>
            </div>`;

        container.querySelectorAll('.page-btn:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => {
                const pg = parseInt(btn.dataset.page);
                if (!isNaN(pg) && pg >= 1 && pg <= totalPages) {
                    this._pagination.currentPage = pg;
                    this._renderPage();
                    document.getElementById('issues-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });
    },

    _buildRow(file) {
        const { severity, labels } = FileAnalyzer.analyze(file);

        const dupeGroupIdx = file._dupeGroupIdx;
        const hasDupeGroup = dupeGroupIdx !== undefined;
        const dupeClass    = hasDupeGroup ? ` dupe-group-row dupe-group-${dupeGroupIdx % 8}` : '';

        let rowClass = '';
        if (hasDupeGroup) {
            rowClass = ` class="wix-row--dupe${dupeClass}"`;
        } else {
            rowClass = severity === 'high'   ? ' class="wix-row--high"'
                     : severity === 'medium' ? ' class="wix-row--medium"' : '';
        }

        const isPublic  = labels.some(l => l.key === 'public');
        const isDomain  = labels.some(l => l.key === 'domain');
        const isTrashed = file.trashed;

        let badgeClass, badgeText;
        if (isTrashed)                        { badgeClass = 'vbadge vbadge--trash';    badgeText = I18n.t('badge.trash'); }
        else if (isPublic)                     { badgeClass = 'vbadge vbadge--public';   badgeText = I18n.t('badge.public'); }
        else if (isDomain)                     { badgeClass = 'vbadge vbadge--internal'; badgeText = I18n.t('badge.internal'); }
        else if (severity === 'high' && !isPublic) { badgeClass = 'vbadge vbadge--action'; badgeText = I18n.t('badge.action'); }
        else                                   { badgeClass = 'vbadge vbadge--private';  badgeText = I18n.t('badge.private'); }
        const statusHtml = `<span class="${badgeClass}">${badgeText}</span>`;

        const safeName = escapeHtml(file.name || '');
        const size     = Number(file.size) || 0;
        const displayDates = getDisplayTimestamps(file);
        const createdDate = displayDates.createdTime ? formatDate(displayDates.createdTime) : '—';
        const modDate     = displayDates.modifiedTime ? formatDate(displayDates.modifiedTime) : '—';
        const filePath     = this._getFilePath(file);
        const safePathFull = escapeHtml(filePath);
        const pathHtml     = this._buildPathBreadcrumb(filePath);

        const perms      = file.permissions || [];
        const ownerPerm  = perms.find(p => p.role === 'owner');
        const ownerName  = ownerPerm
            ? (ownerPerm.displayName || ownerPerm.emailAddress || '—')
            : (file.ownedByMe ? I18n.t('misc.me') : '—');
        const safeOwner  = escapeHtml(ownerName);

        const sharedPerms  = perms.filter(p => p.type === 'user' && p.role !== 'owner');
        const sharedEmails = sharedPerms.map(p => p.emailAddress || p.displayName || '').filter(Boolean);
        let sharedHtml = '—';
        if (perms.some(p => p.type === 'anyone')) {
            sharedHtml = `<span class="shared-tag shared-tag--public">${I18n.t('shared.publicTag')}</span>`;
        } else if (sharedEmails.length > 0) {
            const shown = sharedEmails.slice(0, 2).map(e => `<span class="shared-tag" title="${escapeHtml(e)}">${escapeHtml(e.split('@')[0])}</span>`).join('');
            const more  = sharedEmails.length > 2 ? `<span class="shared-tag shared-tag--more" title="${escapeHtml(sharedEmails.join(', '))}">+${sharedEmails.length - 2}</span>` : '';
            sharedHtml  = shown + more;
        }

        let actionsHtml;
        if (file.trashed) {
            const restoreLink = file.ownedByMe
                ? `<button class="action-link action-link--restore btn-restore"
                    data-file-id="${file.id}" data-file-name="${safeName}"
                    title="${I18n.t('action.restore')}"><i class="fas fa-undo-alt"></i></button>` : '';
            const permDeleteLink = file.ownedByMe
                ? `<button class="action-link action-link--perm-delete btn-perm-delete"
                    data-file-id="${file.id}" data-file-name="${safeName}"
                    title="${I18n.t('action.deletePermanent')}"><i class="fas fa-times-circle"></i></button>` : '';
            actionsHtml = `<div class="action-links">${restoreLink}${permDeleteLink}</div>`;
        } else {
            const canTransfer = file.ownedByMe === true && !file.driveId && !file.teamDriveId;
            const canRequest = file.ownedByMe !== true;
            const hasShareable = (file.permissions || []).some(p => p.type === 'anyone' || p.type === 'domain' || p.type === 'group' || (p.type === 'user' && p.role !== 'owner'));
            const canStopShare = canCurrentAccountManageSharing(file) && (file.shared === true || hasShareable);
            const canCompare = canCurrentAccountManageSharing(file) && file._dupeGroupIdx !== undefined;
            const canDelete = file.ownedByMe === true;
            const aCls = (ok) => ok ? '' : ' action-btn-5--disabled';
            const aDis = (ok) => ok ? '' : 'disabled aria-disabled="true" tabindex="-1"';

            const btnTransfer = `<button class="action-btn-5 action-btn-5--transfer btn-transfer-own${aCls(canTransfer)}"
                data-file-id="${file.id}" data-file-name="${safeName}"
                title="Chuyển quyền sở hữu sang người khác" ${aDis(canTransfer)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 8 21 12 17 16"/><line x1="9" y1="12" x2="21" y2="12"/></svg>
            </button>`;
            const btnRequest = `<button class="action-btn-5 action-btn-5--request btn-request-own${aCls(canRequest)}"
                data-file-id="${file.id}" data-file-name="${safeName}"
                title="Yêu cầu lấy lại quyền sở hữu về bạn" ${aDis(canRequest)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            </button>`;
            const btnStopShare = `<button class="action-btn-5 action-btn-5--stop-share btn-stop-sharing${aCls(canStopShare)}"
                data-file-id="${file.id}" data-file-name="${safeName}" data-owned-by-me="${file.ownedByMe}"
                title="Ngừng chia sẻ - đưa file về riêng tư, chỉ người được cấp mới mở được" ${aDis(canStopShare)}>
                <i class="fas fa-lock"></i>
            </button>`;
            const btnCompare = `<button class="action-btn-5 action-btn-5--compare btn-compare-dupes${aCls(canCompare)}"
                data-file-id="${file.id}" data-file-name="${safeName}"
                title="So sánh & xóa bản trùng nội dung, giữ bản gốc" ${aDis(canCompare)}>
                <i class="fas fa-copy"></i>
            </button>`;
            const btnDelete = `<button class="action-btn-5 action-btn-5--delete btn-delete${aCls(canDelete)}"
                data-file-id="${file.id}" data-file-name="${safeName}"
                title="Xóa tệp" ${aDis(canDelete)}>
                <i class="fas fa-trash"></i>
            </button>`;
            actionsHtml = `<div class="action-links-5">${btnTransfer}${btnRequest}${btnStopShare}${btnCompare}${btnDelete}</div>`;
        }

        return `
        <tr${rowClass} data-file-id="${escapeHtml(file.id)}">
            <td class="td-chk"><input type="checkbox" class="wix-chk row-chk" data-file-id="${escapeHtml(file.id)}"></td>
            <td class="td-name" title="${safeName}">
                <span class="file-name-cell">${this._fileIcon(file.name, file.mimeType)}<span class="file-name-text">${safeName}</span></span>
            </td>
            <td class="td-path" data-fullpath="${safePathFull}">${pathHtml}</td>
            <td class="td-status">${statusHtml}</td>
            <td class="td-owner" title="${safeOwner}">${safeOwner}</td>
            <td class="td-shared" data-file-id="${escapeHtml(file.id)}" data-file-name="${safeName}" data-owned-by-me="${file.ownedByMe}">${sharedHtml}</td>
            <td class="td-size">${formatBytes(size)}</td>
            <td class="td-date">${createdDate}</td>
            <td class="td-date">${modDate}</td>
            <td class="td-actions">${actionsHtml}</td>
        </tr>`;
    },

    _shortenRec(rec) { return I18n.t(rec) || rec; },

    _ICON_MAP: {
        pdf:   { fa: 'fas fa-file-pdf',         color: '#e74a3b' },
        doc:   { fa: 'fas fa-file-word',         color: '#2b579a' },
        docx:  { fa: 'fas fa-file-word',         color: '#2b579a' },
        xls:   { fa: 'fas fa-file-excel',        color: '#1d6f42' },
        xlsx:  { fa: 'fas fa-file-excel',        color: '#1d6f42' },
        csv:   { fa: 'fas fa-file-csv',          color: '#1d6f42' },
        ppt:   { fa: 'fas fa-file-powerpoint',   color: '#d24726' },
        pptx:  { fa: 'fas fa-file-powerpoint',   color: '#d24726' },
        txt:   { fa: 'fas fa-file-alt',          color: '#6c757d' },
        rtf:   { fa: 'fas fa-file-alt',          color: '#6c757d' },
        jpg:   { fa: 'fas fa-file-image',        color: '#9c27b0' },
        jpeg:  { fa: 'fas fa-file-image',        color: '#9c27b0' },
        png:   { fa: 'fas fa-file-image',        color: '#9c27b0' },
        gif:   { fa: 'fas fa-file-image',        color: '#ff9800' },
        webp:  { fa: 'fas fa-file-image',        color: '#9c27b0' },
        svg:   { fa: 'fas fa-bezier-curve',      color: '#ff9800' },
        mp4:   { fa: 'fas fa-file-video',        color: '#e91e63' },
        avi:   { fa: 'fas fa-file-video',        color: '#e91e63' },
        mov:   { fa: 'fas fa-file-video',        color: '#e91e63' },
        mkv:   { fa: 'fas fa-file-video',        color: '#e91e63' },
        mp3:   { fa: 'fas fa-file-audio',        color: '#00bcd4' },
        wav:   { fa: 'fas fa-file-audio',        color: '#00bcd4' },
        zip:   { fa: 'fas fa-file-archive',      color: '#795548' },
        rar:   { fa: 'fas fa-file-archive',      color: '#795548' },
        '7z':  { fa: 'fas fa-file-archive',      color: '#795548' },
        py:    { fa: 'fab fa-python',            color: '#3776ab' },
        ipynb: { fa: 'fas fa-book-open',         color: '#f37626' },
        js:    { fa: 'fab fa-js-square',         color: '#f7df1e' },
        ts:    { fa: 'fas fa-code',              color: '#3178c6' },
        html:  { fa: 'fab fa-html5',             color: '#e34c26' },
        css:   { fa: 'fab fa-css3-alt',          color: '#264de4' },
        json:  { fa: 'fas fa-code',              color: '#ff9800' },
        md:    { fa: 'fab fa-markdown',          color: '#083fa1' },
        sql:   { fa: 'fas fa-database',          color: '#00758f' },
        sh:    { fa: 'fas fa-terminal',          color: '#4caf50' },
    },

    _fileIcon(fileName = '', mimeType = '') {
        const ext    = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
        const mapped = this._ICON_MAP[ext];
        if (mapped) return `<i class="${mapped.fa} file-icon" style="color:${mapped.color};" title="${ext.toUpperCase()}"></i>`;
        if (mimeType.includes('folder'))       return `<i class="fas fa-folder file-icon" style="color:#f59e0b;"></i>`;
        if (mimeType.includes('image'))        return `<i class="fas fa-file-image file-icon" style="color:#9c27b0;"></i>`;
        if (mimeType.includes('video'))        return `<i class="fas fa-file-video file-icon" style="color:#e91e63;"></i>`;
        if (mimeType.includes('audio'))        return `<i class="fas fa-file-audio file-icon" style="color:#00bcd4;"></i>`;
        if (mimeType.includes('pdf'))          return `<i class="fas fa-file-pdf file-icon" style="color:#e74a3b;"></i>`;
        if (mimeType.includes('spreadsheet'))  return `<i class="fas fa-file-excel file-icon" style="color:#1d6f42;"></i>`;
        if (mimeType.includes('document'))     return `<i class="fas fa-file-word file-icon" style="color:#2b579a;"></i>`;
        if (mimeType.includes('presentation')) return `<i class="fas fa-file-powerpoint file-icon" style="color:#d24726;"></i>`;
        if (mimeType.includes('zip') || mimeType.includes('archive')) return `<i class="fas fa-file-archive file-icon" style="color:#795548;"></i>`;
        return `<i class="fas fa-file file-icon" style="color:#adb5bd;"></i>`;
    },

    // ── [TRASH-2] Chuyển file vào Trash ──────────────────────────
    async handleDeleteClick(e) {
        const btn      = e.currentTarget;
        const fileId   = btn.dataset.fileId;
        const fileName = btn.dataset.fileName;

        ConfirmController.open(I18n.t('delete.confirm').replace('{n}', fileName), async () => {
            const operation = await requireCleanupMutation(fileId);
            if (!operation) return;
            const origHTML = btn.innerHTML;
            btn.disabled   = true;
            btn.innerHTML  = '<i class="fas fa-spinner fa-spin"></i>';

            try {
                await deleteFile(fileId);

                const fi = UIController.allScannedFiles.findIndex(f => f.id === fileId);
                if (fi !== -1) UIController.allScannedFiles[fi].trashed = true;

                // [TRASH-1] Cập nhật KPI ngay lập tức
                UIController._syncKPIAfterChange();

                const fileInfo = fi !== -1 ? UIController.allScannedFiles[fi] : null;
                await logAction({ type: 'delete', fileId, fileName, fileSize: fileInfo?.size, actionLabel: 'Xóa file' }, operation);

                if (UIController.currentFilterType !== 'trash') {
                    const row = btn.closest('tr');
                    if (row) {
                        row.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                        row.style.opacity    = '0';
                        row.style.transform  = 'translateX(-10px)';
                        setTimeout(() => { row.remove(); UIController._applyFull(); }, 320);
                    }
                } else {
                    UIController._applyFull();
                }

                Toast.success(I18n.t('delete.success').replace('{n}', fileName));
            } catch (err) {
                await failReservedCleanup(operation);
                console.error('Trash error:', err);
                try { trackEvent('api_error', { error_type: 'trash_failure', error_message: (err.message || '').substring(0, 100) }); } catch (_) {}
                Toast.error(I18n.t('delete.error') + err.message);
                btn.innerHTML = origHTML;
                btn.disabled  = false;
            }
        });
    },

    // ── [TRASH-3] Khôi phục file từ Trash ────────────────────────
    async handleRestoreClick(e) {
        const btn      = e.currentTarget;
        const fileId   = btn.dataset.fileId;
        const fileName = btn.dataset.fileName;

        ConfirmController.open(I18n.t('restore.confirm').replace('{n}', fileName), async () => {
            const operation = await requireCleanupMutation(fileId);
            if (!operation) return;
            const origHTML = btn.innerHTML;
            btn.disabled   = true;
            btn.innerHTML  = '<i class="fas fa-spinner fa-spin"></i>';

            try {
                await restoreFile(fileId);

                const fi = UIController.allScannedFiles.findIndex(f => f.id === fileId);
                if (fi !== -1) UIController.allScannedFiles[fi].trashed = false;

                UIController._syncKPIAfterChange();

                const fileInfo = fi !== -1 ? UIController.allScannedFiles[fi] : null;
                await logAction({ type: 'restore', fileId, fileName, fileSize: fileInfo?.size, actionLabel: 'Khôi phục file' }, operation);

                const row = btn.closest('tr');
                if (row) {
                    row.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                    row.style.opacity    = '0';
                    row.style.transform  = 'translateX(10px)';
                    setTimeout(() => { row.remove(); UIController._applyFull(); }, 320);
                }

                Toast.success(I18n.t('restore.success').replace('{n}', fileName));
            } catch (err) {
                await failReservedCleanup(operation);
                console.error('Restore error:', err);
                try { trackEvent('api_error', { error_type: 'restore_failure', error_message: (err.message || '').substring(0, 100) }); } catch (_) {}
                Toast.error(I18n.t('restore.error') + err.message);
                btn.innerHTML = origHTML;
                btn.disabled  = false;
            }
        });
    },

    // ── [TRASH-4] Xóa vĩnh viễn ──────────────────────────────────
    async handlePermanentDeleteClick(e) {
        const btn      = e.currentTarget;
        const fileId   = btn.dataset.fileId;
        const fileName = btn.dataset.fileName;

        ConfirmController.open(I18n.t('perm.delete.confirm').replace('{n}', fileName), async () => {
            const operation = await requireCleanupMutation(fileId);
            if (!operation) return;
            const origHTML = btn.innerHTML;
            btn.disabled   = true;
            btn.innerHTML  = '<i class="fas fa-spinner fa-spin"></i>';

            try {
                await permanentlyDeleteFile(fileId);

                const fi = UIController.allScannedFiles.findIndex(f => f.id === fileId);
                const fileInfo = fi !== -1 ? UIController.allScannedFiles[fi] : null;
                // Xóa hoàn toàn khỏi memory
                if (fi !== -1) UIController.allScannedFiles.splice(fi, 1);

                UIController._syncKPIAfterChange();

                await logAction({ type: 'permanent_delete', fileId, fileName, fileSize: fileInfo?.size, actionLabel: 'Xóa vĩnh viễn' }, operation);

                const row = btn.closest('tr');
                if (row) {
                    row.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                    row.style.opacity    = '0';
                    row.style.transform  = 'translateX(-10px)';
                    setTimeout(() => { row.remove(); UIController._applyFull(); }, 320);
                }

                Toast.success(I18n.t('perm.delete.success').replace('{n}', fileName));
            } catch (err) {
                await failReservedCleanup(operation);
                console.error('Permanent delete error:', err);
                try { trackEvent('api_error', { error_type: 'permanent_delete_failure', error_message: (err.message || '').substring(0, 100) }); } catch (_) {}
                Toast.error(I18n.t('perm.delete.error') + err.message);
                btn.innerHTML = origHTML;
                btn.disabled  = false;
            }
        });
    },

    // ── Download ──────────────────────────────────────────────────
    async handleDownloadClick(e) {
        const btn      = e.currentTarget;
        const fileId   = btn.dataset.fileId;
        const fileName = btn.dataset.fileName;
        const fileSize = parseInt(btn.dataset.fileSize) || 0;
        if (!fileId) return;
        const token = await getAuthToken();
        if (!token) { Toast.error(I18n.t('toast.noAuth')); return; }
        const { dlModal, dlProgressBar, dlStatusText, dlStats, dlFilename, dlThreads } = this.el;
        dlModal.style.display     = 'flex';
        dlFilename.innerText      = fileName;
        dlProgressBar.style.width = '0%';
        dlProgressBar.innerText   = '0%';
        dlProgressBar.className   = 'wix-progress__bar';
        if (dlStatusText) dlStatusText.innerHTML = `<span style="color:#f59e0b;">${I18n.t('dl.preparing')}</span>`;
        dlStats.innerText = `0 / ${formatBytes(fileSize)}`;
        if (dlThreads) dlThreads.innerText = '0';
        this.currentDownloader = new SmartDownloader(token);
        try {
            if (dlStatusText) dlStatusText.innerHTML = `<span style="color:#0052CD;">${I18n.t('dl.inProgress')}</span>`;
            await this.currentDownloader.start(fileId, fileName, fileSize, (percent, loaded, total, threads) => {
                dlProgressBar.style.width = `${percent}%`;
                dlProgressBar.innerText   = `${percent}%`;
                dlStats.innerText = `${formatBytes(loaded)} / ${formatBytes(total)}`;
                if (dlThreads) dlThreads.innerText = threads;
            });
            if (dlStatusText) dlStatusText.innerHTML = `<span style="color:#10b981;">${I18n.t('dl.complete')}</span>`;
            dlProgressBar.innerText = I18n.t('dl.completePct');
            setTimeout(() => { dlModal.style.display = 'none'; }, 2200);
        } catch (err) {
            if (err.name === 'AbortError') { dlModal.style.display = 'none'; return; }
            dlProgressBar.style.background = '#e74a3b';
            if (dlStatusText) dlStatusText.innerHTML = `<span style="color:#e74a3b;">${I18n.t('dl.failed')}</span>`;
            let msg = err.message;
            if (err.message.includes('403')) msg = I18n.t('dl.error403');
            dlProgressBar.innerText = I18n.t('dl.error');
            const errEl = dlModal.querySelector('#dl-error-msg');
            if (errEl) { errEl.innerText = msg; errEl.style.display = 'block'; }
        }
    },

    // ── Share Modal ───────────────────────────────────────────────
    async handleShareInfoClick(e) {
        const btn       = e.currentTarget;
        const fileId    = btn.dataset.fileId;
        const fileName  = btn.dataset.fileName;
        if (!fileId) return;
        const file = this.allScannedFiles.find(item => item.id === fileId);
        if (!file) return;
        const ownedByMe = canCurrentAccountManageSharing(file);
        const {
            shareModal, modalFileName, modalRiskBadge, modalRiskAdvice,
            ownerSection, ownerInfo, sharedWithSection, sharedList, sharedCount
        } = this.el;
        shareModal.style.display  = 'flex';
        modalFileName.textContent = fileName;
        if (modalRiskBadge)  modalRiskBadge.innerHTML = '';
        if (modalRiskAdvice) modalRiskAdvice.style.display = 'none';
        ownerInfo.innerHTML  = `<i class="fas fa-spinner fa-spin" style="color:var(--blue);"></i> ${I18n.t('modal.shareLoading')}`;
        sharedList.innerHTML = `<li style="padding:10px;text-align:center;"><i class="fas fa-spinner fa-spin" style="color:var(--blue);"></i> ${I18n.t('modal.shareLoading')}</li>`;

        try {
            if (ownedByMe) {
                ownerSection.style.display = 'none'; sharedWithSection.style.display = 'block';
                const permissions = await getFilePermissions(fileId);
                const sharePerms  = (permissions || []).filter(p => p.role !== 'owner');
                if (sharedCount) sharedCount.textContent = sharePerms.length;
                const hasPublic = sharePerms.some(p => p.type === 'anyone');
                const hasDomain = sharePerms.some(p => p.type === 'domain');
                if (modalRiskBadge) {
                    if (hasPublic) {
                        modalRiskBadge.innerHTML = `<span class="risk-badge risk-high">${I18n.t('modal.riskHigh')}</span>`;
                        if (modalRiskAdvice) { modalRiskAdvice.style.display = 'block'; modalRiskAdvice.innerHTML = I18n.t('modal.adviceHigh'); }
                    } else if (hasDomain) {
                        modalRiskBadge.innerHTML = `<span class="risk-badge risk-medium">${I18n.t('modal.riskMedium')}</span>`;
                        if (modalRiskAdvice) { modalRiskAdvice.style.display = 'block'; modalRiskAdvice.innerHTML = I18n.t('modal.adviceMedium'); }
                    } else if (sharePerms.length > 0) {
                        modalRiskBadge.innerHTML = `<span class="risk-badge risk-low">${I18n.t('modal.riskSelective')}</span>`;
                    } else {
                        modalRiskBadge.innerHTML = `<span class="risk-badge risk-low">${I18n.t('modal.riskPrivate')}</span>`;
                    }
                }
                if (sharePerms.length === 0) {
                    sharedList.innerHTML = `<li style="padding:14px;text-align:center;color:#888;"><i class="fas fa-lock"></i> ${I18n.t('modal.notShared')}</li>`;
                    return;
                }
                const currentUser  = this._currentUser || await this._loadCurrentUser();
                const currentEmail = currentUser?.emailAddress || '';
                sharedList.innerHTML = sharePerms.map(perm => this._buildPermItem(perm, fileId, currentEmail)).join('');
                this._bindRevokeButtons(sharedList, fileId);
            } else {
                ownerSection.style.display = 'block'; sharedWithSection.style.display = 'none';
                if (modalRiskBadge) modalRiskBadge.innerHTML = `<span class="risk-badge risk-low">${I18n.t('modal.riskSharedWithMe')}</span>`;
                const owner = await getFileOwner(fileId);
                if (!owner) {
                    ownerInfo.innerHTML = `<span style="color:#888;">${I18n.t('modal.noOwner')}</span>`;
                    return;
                }
                const ownerEmail = owner.emailAddress || I18n.t('modal.noEmail');
                const ownerName  = owner.displayName  || ownerEmail;
                const ownerPhoto = owner.photoLink    || chrome.runtime.getURL('assets/icons/wistorix-icon-48.png');
                ownerInfo.innerHTML = `<img src="${ownerPhoto}" alt="${ownerName}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;"><div><div style="font-weight:bold;font-size:14px;color:#333;">${ownerName}</div><div style="font-size:12px;color:#888;">${ownerEmail}</div></div>`;
            }
        } catch (error) {
            console.error('Share info error:', error);
            try { trackEvent('api_error', { error_type: 'share_info_failure', error_message: (error.message || '').substring(0, 100) }); } catch (_) {}
            const errMsg = `<span style="color:var(--red);">${I18n.t('modal.shareError')}${error.message}</span>`;
            if (ownedByMe) sharedList.innerHTML = `<li style="padding:10px;text-align:center;">${errMsg}</li>`;
            else ownerInfo.innerHTML = errMsg;
        }
    },

    _buildPermItem(perm, fileId = null, currentUserEmail = '') {
        let displayName = '', avatar = '', roleText = '';
        const fallbackAvatar = chrome.runtime.getURL('assets/icons/wistorix-icon-48.png');
        if (perm.role === 'reader')         roleText = I18n.t('role.reader');
        else if (perm.role === 'writer')    roleText = I18n.t('role.writer');
        else if (perm.role === 'commenter') roleText = I18n.t('role.commenter');
        else roleText = perm.role;
        if (perm.type === 'anyone')      { displayName = I18n.t('modal.public'); avatar = fallbackAvatar; }
        else if (perm.type === 'user')   { displayName = perm.emailAddress || perm.displayName || I18n.t('modal.noEmail'); avatar = perm.photoLink || fallbackAvatar; }
        else if (perm.type === 'domain') { displayName = I18n.t('modal.domain') + (perm.domain || ''); avatar = fallbackAvatar; }
        else if (perm.type === 'group')  { displayName = I18n.t('modal.group') + (perm.emailAddress || I18n.t('modal.noEmail')); avatar = fallbackAvatar; }
        else { displayName = perm.displayName || perm.emailAddress || I18n.t('modal.unknown'); avatar = fallbackAvatar; }

        const emailLine = (perm.emailAddress && perm.type === 'user')
            ? `<div style="font-size:11px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${perm.emailAddress}</div>` : '';

        const isOwner   = perm.role === 'owner';
        const isSelf    = currentUserEmail && perm.emailAddress === currentUserEmail;
        const isInherited = perm.permissionDetails?.some(d => d.inherited === true)
                         || (perm.inherited === true);
        const canRevoke = !isOwner && !isSelf && !isInherited && fileId && perm.id;

        let revokeBtn;
        if (isInherited) {
            revokeBtn = `<span class="perm-inherited-tag" title="${I18n.t('perm.inherited.tooltip')}">
                <i class="fas fa-link"></i> ${I18n.t('perm.inherited.label')}
            </span>`;
        } else if (canRevoke) {
            revokeBtn = `<button class="btn-revoke-perm"
                 data-perm-id="${perm.id}"
                 data-perm-name="${escapeHtml(displayName)}"
                 title="${I18n.t('perm.revoke.title')}">
                 <i class="fas fa-times"></i> ${I18n.t('perm.revoke.btn')}
               </button>`;
        } else {
            revokeBtn = '';
        }

        return `<li class="user-item">
            <img src="${avatar}" alt="${escapeHtml(displayName)}" class="user-avatar" data-fallback-avatar="${fallbackAvatar}" >
            <div style="flex:1;min-width:0;">
                <div style="font-weight:700;font-size:13px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(displayName)}</div>
                ${emailLine}
            </div>
            <span class="role-badge">${roleText}</span>
            ${revokeBtn}
        </li>`;
    },

    _bindRevokeButtons(listEl, fileId) {
        listEl.querySelectorAll('.btn-revoke-perm').forEach(btn => {
            btn.addEventListener('click', () => this._revokePermission(btn, fileId));
        });
    },

    async _revokePermission(btn, fileId) {
        const permId   = btn.dataset.permId;
        const permName = btn.dataset.permName;
        const file = this.allScannedFiles.find(item => item.id === fileId);
        if (!canCurrentAccountManageSharing(file)) {
            Toast.error('Bạn không có quyền ngừng chia sẻ tệp này.');
            return;
        }
        if (this.el.shareModal) this.el.shareModal.style.display = 'none';
        ConfirmController.open(
            I18n.t('perm.revoke.confirm').replace('{n}', permName),
            async () => {
                if (!canCurrentAccountManageSharing(this.allScannedFiles.find(item => item.id === fileId))) {
                    Toast.error('Bạn không có quyền ngừng chia sẻ tệp này.');
                    return;
                }
                const operation = await requireCleanupMutation(fileId);
                if (!operation) return;
                    const origHTML = btn.innerHTML;
                btn.disabled   = true;
                btn.innerHTML  = '<i class="fas fa-spinner fa-spin"></i>';
                try {
                    await revokePermission(fileId, permId);
                    const fi = UIController.allScannedFiles.find(f => f.id === fileId);
                    await logAction({ type: 'revoke', fileId, fileName: fi?.name || btn.dataset.fileName || 'Unknown', fileSize: fi?.size, actionLabel: 'Thu hồi quyền' }, operation);
                    if (fi) {
                        fi.permissions = (fi.permissions || []).filter(permission => permission.id !== permId);
                        fi.shared = fi.permissions.some(permission => permission.role !== 'owner');
                    }
                    UIController._syncKPIAfterChange();
                    UIController._applyFull();
                    const li = btn.closest('li');
                    if (li) {
                        li.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
                        li.style.opacity    = '0';
                        li.style.transform  = 'translateX(10px)';
                        setTimeout(() => {
                            li.remove();
                            const countEl = document.getElementById('sharedCount');
                            if (countEl) countEl.textContent = Math.max(0, parseInt(countEl.textContent || '0') - 1);
                        }, 270);
                    }
                    Toast.success(I18n.t('perm.revoke.success').replace('{n}', permName));
                } catch (err) {
                    await failReservedCleanup(operation);
                    console.error('Revoke error:', err);
                    try { trackEvent('api_error', { error_type: 'revoke_failure', error_message: (err.message || '').substring(0, 100) }); } catch (_) {}
                    const errMsg = err.message || '';
                    const errReason = err.reason || '';
                    if (errReason === 'cannot_delete_permission' || errReason === 'inherited_permission'
                        || errMsg.includes('403') || errMsg.includes('cannot delete') || errMsg.includes('inherited')) {
                        Toast.error(I18n.t('perm.inherited.error'));
                    } else if (errMsg.includes('shared drive') || errMsg.includes('teamDrive')) {
                        Toast.error(I18n.t('perm.sharedDrive.error'));
                    } else {
                        Toast.error(I18n.t('perm.revoke.error') + errMsg);
                    }
                    btn.innerHTML = origHTML;
                    btn.disabled  = false;
                }
            }
        );
    },

    // ── Transfer Ownership (Action 1) ──────────────────────────────
    async handleTransferOwnershipClick(e) {
        const btn      = e.currentTarget;
        const fileId   = btn.dataset.fileId;
        const fileName = btn.dataset.fileName;
        if (!fileId || btn.disabled) return;
        const origHTML = btn.innerHTML;

        const file = this.allScannedFiles.find(f => f.id === fileId);
        if (!file) { Toast.error(I18n.t('transfer.error') + 'Không tìm thấy file'); return; }

        // Gate 1: kiểm tra quyền chuyển ownership trước khi hỏi email
        if (file.ownedByMe !== true || (file.capabilities && file.capabilities.canShare === false)) {
            Toast.error(I18n.t('transfer.notOwner'));
            return;
        }

        const email = await openOwnershipTransferModal([file]);
        if (!email) return;
        if (!EMAIL_RE.test(email.trim())) {
            Toast.warning(I18n.t('transfer.invalidEmail'));
            return;
        }

        const operation = await requireCleanupMutation(fileId);
        if (!operation) return;

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        try {
            const result = await transferOwnership(file, email);
            if (result.status === 'completed') {
                // transferOwnership đã patch cache/shared state; chỉ cần cập nhật view local.
                const cur = this.allScannedFiles.find(f => f.id === fileId);
                if (cur) {
                    cur.ownedByMe = false;
                    cur.owners   = [{ emailAddress: result.email, me: false }];
                    const p = (cur.permissions || []).find(x => x.emailAddress && x.emailAddress.toLowerCase() === result.email);
                    if (p) p.role = 'owner';
                }
                Toast.success(I18n.t('transfer.success'));
                await logAction({ type: 'transfer_ownership', fileId, fileName, fileSize: file?.size, actionLabel: 'Chuyển quyền sở hữu' }, operation);
                this._syncKPIAfterChange();
                this._applyFull();
            } else if (result.status === 'pending') {
                Toast.info(result.alreadyPending ? I18n.t('transfer.pendingAgain') : I18n.t('transfer.pending'));
                await logAction({ type: 'transfer_ownership_pending', fileId, fileName, actionLabel: 'Gửi lời mời chuyển quyền sở hữu' }, operation);
            } else if (result.status === 'already_owner') {
                await failReservedCleanup(operation);
                Toast.info(I18n.t('transfer.alreadyOwner'));
            }
        } catch (err) {
            await failReservedCleanup(operation);
            console.error('Transfer ownership error:', err);
            const msg = (err && err.message) || '';
            if (isConsentRequiredError(err)) {
                Toast.info(I18n.t('transfer.consentPolicy'));
            } else if (err.code === 'not_owner' || err.code === 'cannot_share') {
                Toast.error(I18n.t('transfer.notOwner'));
            } else if (err.code === 'invalid_email') {
                Toast.warning(I18n.t('transfer.invalidEmail'));
            } else if (err.code === 'shared_drive') {
                Toast.error(I18n.t('transfer.sharedDrive'));
            } else if (err.code === 'trashed') {
                Toast.error(I18n.t('transfer.trashed'));
            } else if (err.status === 403 || err.reason === 'insufficientFilePermissions' ||
                       /insufficient.*permission|domain policy|allowed to transfer|outside your domain|same organization/i.test(msg)) {
                Toast.error(I18n.t('transfer.domainPolicy'));
            } else {
                Toast.error(I18n.t('transfer.error') + msg);
            }
        }
        btn.disabled = false;
        btn.innerHTML = origHTML;
    },

    // ── Request Ownership (Action 2) ──────────────────────────────
    async handleRequestOwnershipClick(e) {
        e.stopPropagation();
        const btn      = e.currentTarget;
        const fileId   = btn.dataset.fileId;
        if (!fileId) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        try {
            const file = this.allScannedFiles.find(item => item.id === fileId);
            if (!file) throw new Error('Không tìm thấy file');
            await openOwnershipRequestModal([file]);
        } catch (err) {
            Toast.error(I18n.t('request.error') + err.message);
        }
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-hand-paper"></i>';
    },

    // ── Stop Sharing — Share Detail V2 (Action 3) ────────────────
    _currentShareFileId: null,

    async handleStopSharingClick(e) {
        const btn      = e.currentTarget;
        const fileId   = btn.dataset.fileId;
        const fileName = btn.dataset.fileName;
        const ownedByMe = btn.dataset.ownedByMe === 'true';
        if (!fileId) return;
        const file = this.allScannedFiles.find(item => item.id === fileId);
        if (!canCurrentAccountManageSharing(file)) {
            Toast.error('Bạn không có quyền ngừng chia sẻ tệp này.');
            return;
        }
        this._currentShareFileId = fileId;
        document.getElementById('share-modal-filename').textContent = fileName;
        const listEl = document.getElementById('share-permissions-list');
        listEl.innerHTML = `<div style="text-align:center;padding:20px;color:#888;"><i class="fas fa-spinner fa-spin"></i> ${I18n.t('modal.shareLoading')}</div>`;
        document.getElementById('shareDetailModalV2').style.display = 'flex';
        try {
            const permissions = await getFilePermissions(fileId);
            const filtered = (permissions || []).filter(p => p.role !== 'owner');
            if (filtered.length === 0) {
                listEl.innerHTML = `<div style="text-align:center;padding:20px;color:#888;"><i class="fas fa-lock"></i> ${I18n.t('shareV2.noPermission')}</div>`;
                return;
            }
            const currentUser = this._currentUser || await this._loadCurrentUser();
            const currentEmail = currentUser?.emailAddress || '';
            listEl.innerHTML = filtered.map(perm => {
                const isInherited = perm.permissionDetails?.some(d => d.inherited === true || d.inheritedFrom) || perm.inherited === true || Boolean(perm.inheritedFrom);
                const isAnyone = perm.type === 'anyone';
                const isDomain = perm.type === 'domain';
                let displayName = '';
                let avatar = chrome.runtime.getURL('assets/icons/wistorix-icon-48.png');
                if (isAnyone)      { displayName = I18n.t('modal.public'); }
                else if (isDomain) { displayName = I18n.t('modal.domain') + (perm.domain || ''); }
                else if (perm.type === 'user') { displayName = perm.emailAddress || perm.displayName || I18n.t('modal.noEmail'); avatar = perm.photoLink || avatar; }
                else if (perm.type === 'group') { displayName = I18n.t('modal.group') + (perm.emailAddress || ''); }
                else { displayName = perm.emailAddress || perm.displayName || I18n.t('modal.unknown'); }
                const roleLabel = perm.role === 'reader' ? I18n.t('role.reader') : perm.role === 'writer' ? I18n.t('role.writer') : perm.role === 'commenter' ? I18n.t('role.commenter') : perm.role;
                const canRevoke = !isInherited && perm.id;
                return `<div class="share-permission-item">
                    <img src="${avatar}" class="share-permission-avatar" data-fallback-avatar="${chrome.runtime.getURL('assets/icons/wistorix-icon-48.png')}" >
                    <div class="share-permission-info">
                        <div class="share-permission-name">${escapeHtml(displayName)}</div>
                        ${perm.emailAddress && !isAnyone ? `<div class="share-permission-email">${escapeHtml(perm.emailAddress)}</div>` : ''}
                    </div>
                    <span class="share-permission-role">${roleLabel}</span>
                    ${isInherited ? `<span class="perm-inherited-tag" title="${I18n.t('perm.inherited.tooltip')}"><i class="fas fa-link"></i> ${I18n.t('perm.inherited.label')}</span>${getInheritedParentId(perm) ? `<button class="share-permission-revoke" data-inherited-perm-id="${perm.id}"><i class="fas fa-folder"></i> Thu hồi</button>` : ''}`
                    : canRevoke ? `<button class="share-permission-revoke" data-perm-id="${perm.id}" data-perm-name="${escapeHtml(displayName)}"><i class="fas fa-times"></i> Gỡ</button>` : ''}
                </div>`;
            }).join('');
            // Bind individual revoke buttons
            listEl.querySelectorAll('[data-perm-id]').forEach(revBtn => {
                revBtn.addEventListener('click', async (ev) => {
                    ev.stopPropagation();
                    const permId = revBtn.dataset.permId;
                    const permName = revBtn.dataset.permName;
                    document.getElementById('shareDetailModalV2').style.display = 'none';
                    ConfirmController.open(I18n.t('perm.revoke.confirm').replace('{n}', permName), async () => {
                        const currentFile = this.allScannedFiles.find(item => item.id === fileId);
                        if (!canCurrentAccountManageSharing(currentFile)) {
                            Toast.error('Bạn không có quyền ngừng chia sẻ tệp này.');
                            return;
                        }
                        const operation = await requireCleanupMutation(fileId);
                        if (!operation) return;
                        try {
                            await revokePermission(fileId, permId);
                            const file = this.allScannedFiles.find(f => f.id === fileId);
                            await logAction({ type: 'revoke', fileId, fileName: file?.name || 'Unknown', fileSize: file?.size, actionLabel: 'Thu hồi quyền' }, operation);
                            if (file) {
                                file.permissions = (file.permissions || []).filter(permission => permission.id !== permId);
                                file.shared = file.permissions.some(permission => permission.role !== 'owner');
                            }
                            this._syncKPIAfterChange();
                            this._applyFull();
                            Toast.success(I18n.t('perm.revoke.success').replace('{n}', permName));
                        } catch (er) {
                            await failReservedCleanup(operation);
                            Toast.error(I18n.t('perm.revoke.error') + er.message);
                        }
                    });
                });
            });
            listEl.querySelectorAll('[data-inherited-perm-id]').forEach(revBtn => {
                revBtn.addEventListener('click', async ev => {
                    ev.stopPropagation();
                    const permission = permissions.find(item => item.id === revBtn.dataset.inheritedPermId);
                    document.getElementById('shareDetailModalV2').style.display = 'none';
                    await handleInheritedPermissionRevoke({
                        file, permission, getFileMetadata, getFilePermissions, revokePermission, removeCachedPermission,
                        requireCleanupMutation, canManageSharing: canCurrentAccountManageSharing, toast: Toast,
                        onSuccess: async ({ parent, parentPermission, childPermission, operation }) => {
                            const currentParent = this.allScannedFiles.find(item => item.id === parent.id);
                            if (currentParent) {
                                currentParent.permissions = (currentParent.permissions || []).filter(item => item.id !== parentPermission.id);
                                currentParent.shared = currentParent.permissions.some(item => item.role !== 'owner');
                            }
                            const currentChild = this.allScannedFiles.find(item => item.id === fileId);
                            if (currentChild) {
                                currentChild.permissions = (currentChild.permissions || []).filter(item => item.id !== childPermission.id);
                                currentChild.shared = currentChild.permissions.some(item => item.role !== 'owner');
                            }
                            await logAction({ type: 'revoke', fileId: parent.id, fileName: parent.name, actionLabel: 'Thu hồi quyền thư mục cha' }, operation);
                            this._syncKPIAfterChange();
                            this._applyFull();
                        }
                    });
                });
            });
        } catch (err) {
            listEl.innerHTML = `<div style="text-align:center;padding:20px;color:#e74a3b;"><i class="fas fa-exclamation-circle"></i> ${I18n.t('modal.shareError')}${err.message}</div>`;
        }
    },

    // ── Compare Duplicates — Duplicate Modal (Action 4) ──────────
    async handleCompareDuplicatesClick(e) {
        const btn      = e.currentTarget;
        const fileId   = btn.dataset.fileId;
        const fileName = btn.dataset.fileName;
        if (!fileId) return;
        const sourceFile = this.allScannedFiles.find(f => f.id === fileId);
        if (!canCurrentAccountManageSharing(sourceFile)) {
            Toast.error('Bạn không có quyền xử lý bản trùng của tệp này.');
            return;
        }
        if (!sourceFile.md5Checksum) {
            Toast.info('Không có thông tin mã băm để so sánh.');
            return;
        }
        openDuplicateActionModal({
            getFiles: () => this.allScannedFiles,
            sourceFileId: fileId,
            fileName,
            formatBytes,
            formatDate,
            escapeHtml,
            renderIcon: file => this._fileIcon(file.name, file.mimeType),
            t: (key, fallback) => I18n.t(key) || fallback,
            confirmAction: ConfirmController.open,
            requireCleanupMutation,
            deleteFile,
            logAction,
            canManageDuplicate: canCurrentAccountManageSharing,
            onMutationSuccess: () => { this._syncKPIAfterChange(); this._applyFull(); },
            toast: Toast
        });
    },

    _reRenderDynamic() {
        if (!this.allScannedFiles.length) return;
        this._renderStorageUI(this._lastStorageUsed, this._lastStorageTotal);
        const _staleSub = document.getElementById('stale-card-sub');
        if (_staleSub) {
            _staleSub.textContent = I18n.t('kpi.stale.subDays').replace('{n}', STALE_THRESHOLD_DAYS);
        }
        this._applyFull();
        // Re-render risk cards and alert on language change
        if (this._cardCounts) {
            this._syncKPIAfterChange();
            this._renderScanTime();
        }
    },

    // ── CHART RENDERING — Canvas donut charts ─────────────────────
    _renderCharts() {
        if (!this.allScannedFiles.length) return;
        const files = this.allScannedFiles;
        // File type counts
        const catCount = { image: 0, video: 0, doc: 0, other: 0 };
        const catSize  = { image: 0, video: 0, doc: 0, other: 0 };
        files.forEach(f => {
            const mime = (f.mimeType || '').toLowerCase();
            const size = parseInt(f.size || 0);
            if (mime.includes('image'))      { catCount.image++; catSize.image += size; }
            else if (mime.includes('video'))  { catCount.video++; catSize.video += size; }
            else if (mime.includes('document') || mime.includes('spreadsheet') || mime.includes('presentation')) { catCount.doc++; catSize.doc += size; }
            else if (!mime.includes('folder')) { catCount.other++; catSize.other += size; }
        });
        const totalFiles = catCount.image + catCount.video + catCount.doc + catCount.other;
        const totalSize  = catSize.image + catSize.video + catSize.doc + catSize.other;
        // Card and chart share canonical raw metrics.  `myBytes` is official
        // Drive quota usage when available, otherwise a scan-derived fallback.
        const storage = computeStorageMetrics(files, this._lastStorageUsed);
        const sharing = computeSharingMetrics(files);
        const mySize = storage.myBytes;
        const shSize = storage.sharedBytes;
        const pubCount = sharing.public;
        const domCount = sharing.internal;
        const privCount = sharing.private;
        const sharedWithMeCount = sharing.shared;
        const chartTotal = sharing.total;

        const COLORS = ['#0052CD', '#10b981', '#f59e0b', '#8b5cf6', '#e74a3b'];
        const LABELS = {
            image: 'Ảnh', video: 'Video', doc: 'Tài liệu', other: 'Khác',
            mine: 'Của tôi', shared: 'của người khác chia sẻ',
            pub: 'Công khai', dom: 'Nội bộ', priv: 'Riêng tư', swm: 'Được chia sẻ'
        };

        this._drawDonutChart('chart-count', [catCount.image, catCount.video, catCount.doc, catCount.other], COLORS, totalFiles);
        this._renderLegend('legend-count', ['image', 'video', 'doc', 'other'], [catCount.image, catCount.video, catCount.doc, catCount.other], COLORS, LABELS);
        const totalGB = (totalSize / (1024*1024*1024)).toFixed(2);
        document.getElementById('chart-count-total').textContent = fmt(totalFiles);
        document.getElementById('chart-size-total').textContent = totalGB;
        document.getElementById('chart-ownership-total').textContent = (storage.totalBytes / (1024*1024*1024)).toFixed(2);
        document.getElementById('chart-sharing-total').textContent = fmt(chartTotal);

        this._drawDonutChart('chart-size', [catSize.image, catSize.video, catSize.doc, catSize.other], COLORS, totalSize, true);
        this._renderLegend('legend-size', ['image', 'video', 'doc', 'other'], [catSize.image, catSize.video, catSize.doc, catSize.other], COLORS, LABELS);

        this._drawDonutChart('chart-ownership', [mySize, shSize], ['#0052CD', '#10b981'], mySize + shSize, true);
        this._renderLegend('legend-ownership', ['mine', 'shared'], [mySize, shSize], ['#0052CD', '#10b981'], LABELS);

        this._drawDonutChart('chart-sharing', [pubCount, domCount, privCount, sharedWithMeCount], COLORS, chartTotal);
        this._renderLegend('legend-sharing', ['pub', 'dom', 'priv', 'swm'], [pubCount, domCount, privCount, sharedWithMeCount], COLORS, LABELS);
    },

    _drawDonutChart(canvasId, values, colors, total, isBytes = false) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        const cx = w / 2, cy = h / 2;
        const outerR = Math.min(cx, cy) - 4;
        const innerR = outerR * 0.6;
        ctx.clearRect(0, 0, w, h);
        const nonZero = values.filter(v => v > 0);
        if (nonZero.length === 0) {
            ctx.beginPath();
            ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
            ctx.arc(cx, cy, innerR, 0, Math.PI * 2, true);
            ctx.closePath();
            ctx.fillStyle = '#e5e7eb';
            ctx.fill();
            return;
        }
        const totalVal = total > 0 ? total : 1;
        let startAngle = -Math.PI / 2;
        values.forEach((val, i) => {
            if (val <= 0) return;
            const sliceAngle = (val / totalVal) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(cx, cy, outerR, startAngle, startAngle + sliceAngle);
            ctx.arc(cx, cy, innerR, startAngle + sliceAngle, startAngle, true);
            ctx.closePath();
            ctx.fillStyle = colors[i % colors.length];
            ctx.fill();
            startAngle += sliceAngle;
        });
        // Inner circle border
        ctx.beginPath();
        ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
    },

    _renderLegend(legendId, keys, values, colors, labels) {
        const el = document.getElementById(legendId);
        if (!el) return;
        const total = values.reduce((s, v) => s + v, 0);
        el.innerHTML = keys.map((key, i) => {
            const pct = total > 0 ? Math.round((values[i] / total) * 100) : 0;
            const displayVal = typeof values[i] === 'number' && values[i] >= 1024 ? formatBytes(values[i]) : fmt(values[i]);
            return `<div class="legend-item">
                <span class="legend-dot" style="background:${colors[i % colors.length]}"></span>
                <span class="legend-label">${labels[key] || key}</span>
                <span class="legend-count">${displayVal}</span>
                <span class="legend-pct">${pct}%</span>
            </div>`;
        }).join('');
    },

    // ── Progress Circles for issue cards ──────────────────────────
    _updateProgressCircles() {
        const files = this.allScannedFiles;
        if (!files.length) return;
        const totalNonTrashed = files.filter(f => !f.trashed).length || 1;
        const countPublic = computeSharingMetrics(files).public;
        const countStale = files.filter(f => !f.trashed && isStaleFile(f)).length;
        const dupeFiles = this._getDuplicateIndex().duplicateFiles.length;

        this._setCircleProgress('progress-public-fill', 'progress-public-text', countPublic, totalNonTrashed, '#e74a3b');
        this._setCircleProgress('progress-stale-fill', 'progress-stale-text', countStale, totalNonTrashed, '#f59e0b');
        this._setCircleProgress('progress-dupes-fill', 'progress-dupes-text', dupeFiles, totalNonTrashed, '#8b5cf6');
    },

    _setCircleProgress(fillId, textId, value, total, color) {
        const fill = document.getElementById(fillId);
        const text = document.getElementById(textId);
        if (!fill) return;
        const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
        fill.style.strokeDasharray = `${pct} ${100 - pct}`;
        fill.style.stroke = color;
        if (text) text.textContent = pct + '%';
    },

    updateDocumentMap(files) {
        const tree = this._buildTree(files);
        tree.forEach(node => this._computeNodeSize(node));
        const listEl = this.el.documentMapList;
        if (listEl) listEl.innerHTML = this._renderTree(tree);
        // this._renderSidebarTree(tree); // removed — sidebar folder tree UI deleted
    },

    _computeNodeSize(node) {
        let total = parseInt(node.size || 0);
        if (node.children && node.children.length > 0) {
            node.children.forEach(child => { this._computeNodeSize(child); total += child._computedSize || 0; });
        }
        node._computedSize = total;
        return total;
    },

    _buildTree(files) {
        const map = {};
        files.forEach(f => { map[f.id] = { ...f, children: [] }; });
        const root = [];
        files.forEach(f => {
            if (f.parents && f.parents.length > 0) {
                f.parents.forEach(parentId => {
                    if (map[parentId]) map[parentId].children.push(map[f.id]);
                });
            } else {
                root.push(map[f.id]);
            }
        });
        return root;
    },

    _renderTree(nodes, depth = 0) {
        return nodes.sort((a, b) => {
            if (a.mimeType.includes('folder') && !b.mimeType.includes('folder')) return -1;
            if (!a.mimeType.includes('folder') && b.mimeType.includes('folder')) return 1;
            return a.name.localeCompare(b.name);
        }).map(n => `
            <li style="margin-left:${depth * 14}px; padding:2px 0;">
                ${n.mimeType.includes('folder') ? '📁' : '📄'} <span style="font-size:12px;">${n.name}</span>
                ${n.children.length ? `<ul style="list-style:none;padding:0;">${this._renderTree(n.children, depth + 1)}</ul>` : ''}
            </li>`).join('');
    },

    _renderSidebarTree(nodes) {
        const sidebarTree = document.getElementById('sidebar-tree');
        if (!sidebarTree) return;
        if (!nodes || nodes.length === 0) {
            sidebarTree.innerHTML = `<div class="sidebar__tree-empty"><i class="fas fa-folder-open"></i><span>${I18n.t('nav.empty')}</span></div>`;
            return;
        }
        sidebarTree.innerHTML = this._buildSidebarTreeHtml(nodes, 0);
        sidebarTree.querySelectorAll('.sidebar-tree-item[data-has-children="true"]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const id         = item.dataset.id;
                const childrenEl = sidebarTree.querySelector(`.sidebar-tree-children[data-parent="${id}"]`);
                const toggle     = item.querySelector('.sidebar-tree-item__toggle');
                if (!childrenEl) return;
                const isOpen = childrenEl.classList.contains('is-expanded');
                childrenEl.classList.toggle('is-expanded', !isOpen);
                childrenEl.classList.toggle('is-collapsed', isOpen);
                if (toggle) toggle.classList.toggle('is-open', !isOpen);
            });
        });
    },

    _buildSidebarTreeHtml(nodes, depth) {
        const sorted = [...nodes].sort((a, b) => {
            const aIsFolder = a.mimeType.includes('folder');
            const bIsFolder = b.mimeType.includes('folder');
            if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
            const mode = this._folderSortMode || 'alpha';
            if (mode === 'size-desc') return (b._computedSize || 0) - (a._computedSize || 0);
            if (mode === 'size-asc')  return (a._computedSize || 0) - (b._computedSize || 0);
            return a.name.localeCompare(b.name);
        });
        return sorted.map(n => {
            const isFolder    = n.mimeType.includes('folder');
            const hasChildren = n.children && n.children.length > 0;
            const indent      = depth * 12;
            const shortName   = n.name.length > 20 ? n.name.slice(0, 18) + '…' : n.name;
            return `
                <div class="sidebar-tree-item"
                     style="padding-left:${10 + indent}px;"
                     data-id="${n.id}"
                     data-has-children="${hasChildren}"
                     title="${n.name}">
                    <span class="sidebar-tree-item__toggle ${hasChildren ? '' : 'invisible'}">${hasChildren ? '›' : ''}</span>
                    <span class="sidebar-tree-item__icon">${isFolder ? '📁' : '📄'}</span>
                    <span class="sidebar-tree-item__name">${shortName}</span>
                </div>
                ${hasChildren
                    ? `<div class="sidebar-tree-children is-collapsed" data-parent="${n.id}">${this._buildSidebarTreeHtml(n.children, depth + 1)}</div>`
                    : ''}
            `;
        }).join('');
    },

    async exportReport() {
        if (!this.allScannedFiles.length) { Toast.warning(I18n.t('export.noData')); return; }
        try { trackEvent('export_to_sheets_clicked'); } catch (_) { /* analytics optional */ }
        const { btnExport } = this.el;
        const originalHTML  = btnExport.innerHTML;
        btnExport.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${I18n.t('btn.exporting')}`;
        btnExport.disabled  = true;
        try {
            let csvContent = I18n.t('export.csv.header') + '\n';
            this.allScannedFiles.forEach(f => {
                const { severity, labels, recommendedAction } = FileAnalyzer.analyze(f);
                const statusStr = labels.map(l => {
                    const keyMap = {
                        trashed: 'badge.trash', public: 'badge.public', domain: 'badge.internal',
                        private: 'badge.private', restricted: 'rec.checkPerm', readonly: 'rec.requestEdit',
                        blocked: 'rec.contactAdmin', orphan: 'rec.organize', stale: 'rec.archive', safe: 'rec.safe'
                    };
                    return I18n.t(keyMap[l.key] || l.key);
                }).join('; ');
                const severityLabel = severity === 'high' ? I18n.t('export.severity.high')
                    : severity === 'medium' ? I18n.t('export.severity.medium') : I18n.t('export.severity.low');
                csvContent += [
                    `"${(f.name || '').replace(/"/g, '""')}"`,
                    `"${statusStr}"`,
                    `"${severityLabel}"`,
                    `"${I18n.t(recommendedAction || FileAnalyzer._REC_SAFE)}"`,
                    f.size || 0,
                    formatBytes(f.size),
                    f.mimeType,
                    formatDate(f.createdTime),
                    f.webViewLink || ''
                ].join(',') + '\n';
            });
            const metadata = {
                name:     `Wistorix_Report_${new Date().toLocaleString('en-US').replace(/[/:,\s]/g, '_')}.csv`,
                mimeType: 'application/vnd.google-apps.spreadsheet'
            };
            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file',     new Blob([csvContent],              { type: 'text/csv' }));
            const res  = await fetchGoogleApiWithAuthRetry(token => fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form
            }));
            if (!res.ok) throw new Error(res.statusText);
            const data = await res.json();
            chrome.tabs.create({ url: `https://docs.google.com/spreadsheets/d/${data.id}/edit` });
            Toast.success(I18n.t('toast.exportSuccess'));
        } catch (e) {
            try { trackEvent('api_error', { error_type: 'export_failure', error_message: (e.message || '').substring(0, 100) }); } catch (_) {}
            Toast.error(I18n.t('export.error') + e.message);
        } finally {
            btnExport.innerHTML = originalHTML;
            btnExport.disabled  = false;
        }
    },

    _buildFolderMap(files) {
        this._folderMap     = {};
        this._fileParentMap = {};
        this._inheritedPermissionSourceCache.clear();
        files.forEach(f => {
            if (f.mimeType && f.mimeType.includes('folder')) this._folderMap[f.id] = f.name;
            if (f.parents && f.parents.length > 0)          this._fileParentMap[f.id] = f.parents[0];
        });
    },

    _getFilePath(file) {
        if (!file.parents || !file.parents.length) return 'My Drive';
        const parts   = [];
        let parentId  = file.parents[0];
        const visited = new Set();
        let maxDepth  = 12;
        while (parentId && !visited.has(parentId) && maxDepth-- > 0) {
            visited.add(parentId);
            const name = this._folderMap[parentId];
            if (!name) {
                if (parts.length === 0) return '📂 Shared Drive';
                parts.unshift('…');
                break;
            }
            parts.unshift(name);
            parentId = this._fileParentMap[parentId] || null;
        }
        if (parts.length === 0) return 'My Drive';
        return parts.join(' › ');
    },

    _buildPathBreadcrumb(pathStr) {
        if (!pathStr) return '—';
        const parts = pathStr.split(' › ');
        if (parts.length === 1) return `<span class="path-segment">${escapeHtml(parts[0])}</span>`;
        return parts.map((p, i) => {
            const isLast = i === parts.length - 1;
            return `<span class="path-segment${isLast ? ' path-segment--last' : ''}">${escapeHtml(p)}</span>`
                 + (isLast ? '' : `<span class="path-sep">›</span>`);
        }).join('');
    },

    // ── Card Export Buttons ───────────────────────────────────────
    _injectCardExportBtns() {
        const cardTypeMap = {
            'card-filter-all':    'all',   'card-filter-issues': 'issues',
            'card-filter-mine':   'mine',  'card-filter-stale':  'stale',
            'card-filter-dupes':  'dupes', 'card-filter-public': 'public',
            'card-filter-empty':  'empty', 'card-filter-orphan': 'orphan',
            'card-filter-trash':  'trash',
        };
        Object.entries(cardTypeMap).forEach(([cardId, type]) => {
            const card = document.getElementById(cardId);
            if (!card) return;
            const body = card.querySelector('.wix-kpi__body');
            if (!body || body.querySelector('.kpi-export-btn')) return;
            const btn = document.createElement('button');
            btn.className = 'kpi-export-btn';
            btn.dataset.cardType = type;
            btn.style.display = 'none';
            btn.innerHTML = `<i class="fas fa-download"></i><span>${I18n.t('kpi.export.btn')}</span>`;
            btn.addEventListener('click', (e) => { e.stopPropagation(); this._exportCardList(type); });
            body.appendChild(btn);
        });
    },

    _updateCardExportBtns() {
        const counts = this._cardCounts;
        if (!counts) return;
        const configs = [
            { type: 'all',    text: I18n.t('kpi.export.files').replace('{n}', fmt(counts.all)) },
            { type: 'issues', text: I18n.t('kpi.export.files').replace('{n}', fmt(counts.issues)) },
            { type: 'mine',   text: I18n.t('kpi.export.files').replace('{n}', fmt(counts.mine)) },
            { type: 'stale',  text: I18n.t('kpi.export.files').replace('{n}', fmt(counts.stale)) },
            { type: 'dupes',  text: I18n.t('kpi.export.groups').replace('{n}', fmt(counts.dupes)) },
            { type: 'public', text: I18n.t('kpi.export.files').replace('{n}', fmt(counts.public)) },
            { type: 'empty',  text: I18n.t('kpi.export.files').replace('{n}', fmt(counts.empty)) },
            { type: 'orphan', text: I18n.t('kpi.export.files').replace('{n}', fmt(counts.orphan)) },
            { type: 'trash',  text: I18n.t('kpi.export.files').replace('{n}', fmt(counts.trash)) },
        ];
        configs.forEach(({ type, text }) => {
            const btn = document.querySelector(`.kpi-export-btn[data-card-type="${type}"]`);
            if (!btn) return;
            const span = btn.querySelector('span');
            if (span) span.textContent = text;
            btn.style.display = (counts[type] || 0) > 0 ? 'inline-flex' : 'none';
        });
    },

    _exportCardList(type) {
        const files = type === 'dupes'
            ? this._getDuplicateIndex().duplicateFilesWithGroupIndex
            : this._getBaseForType(type);
        if (!files || files.length === 0) { Toast.warning(I18n.t('kpi.export.empty')); return; }

        const btn = document.querySelector(`.kpi-export-btn[data-card-type="${type}"]`);
        if (btn) {
            btn.disabled = true;
            const origHTML = btn.innerHTML;
            btn.innerHTML  = '<i class="fas fa-spinner fa-spin"></i>';
            setTimeout(() => { btn.disabled = false; btn.innerHTML = origHTML; }, 1400);
        }

        const header = 'Tên File,Trạng thái,Dung lượng,Đường dẫn,Chủ sở hữu,Ngày sửa,Link\n';
        const rows   = files.map(f => {
            const { labels } = FileAnalyzer.analyze(f);
            const status = labels.map(l => l.key).join('; ');
            const path   = this._getFilePath(f);
            const perms  = f.permissions || [];
            const ownerP = perms.find(p => p.role === 'owner');
            const owner  = ownerP ? (ownerP.emailAddress || ownerP.displayName || '—') : (f.ownedByMe ? I18n.t('misc.me') : '—');
            return [
                `"${(f.name || '').replace(/"/g, '""')}"`,
                `"${status}"`,
                formatBytes(parseInt(f.size || 0)),
                `"${path}"`,
                `"${owner}"`,
                formatDate(f.modifiedTime || f.createdTime),
                f.webViewLink || ''
            ].join(',');
        });

        const csv  = '\uFEFF' + header + rows.join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `Wistorix_${type}_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

};

function scheduleCleanupInvitePreload() {
    const requestedRoute = (window.location.hash || '#/dashboard').split('?')[0];
    if (requestedRoute !== '#/dashboard') return;
    const warm = () => import('./modules/cleanup-invite-preload.js')
        .then(({ preloadCleanupInviteResources }) => preloadCleanupInviteResources())
        .catch(() => {});
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(warm, { timeout: 1500 });
    } else {
        setTimeout(warm, 0);
    }
}


// ============================================================
// MODULE: PathTooltip
// ============================================================
const PathTooltip = (() => {
    let _tooltip   = null;
    let _hideTimer = null;

    function _getTooltip() {
        if (!_tooltip) {
            _tooltip = document.createElement('div');
            _tooltip.className = 'path-tooltip';
            document.body.appendChild(_tooltip);
        }
        return _tooltip;
    }

    function show(anchorEl, fullPath) {
        if (!fullPath || fullPath === 'My Drive') return;
        clearTimeout(_hideTimer);
        const tt    = _getTooltip();
        const parts = fullPath.split(' › ');
        tt.innerHTML = parts.map((p, i) => {
            const isLast = i === parts.length - 1;
            return `<span class="path-tooltip__part${isLast ? ' path-tooltip__part--last' : ''}">${escapeHtml(p)}</span>`
                 + (isLast ? '' : `<span class="path-tooltip__sep">›</span>`);
        }).join('');
        const rect = anchorEl.getBoundingClientRect();
        let left = rect.left;
        let top  = rect.bottom + 6;
        if (left + 340 > window.innerWidth - 12)  left = Math.max(8, window.innerWidth - 352);
        if (top  + 80  > window.innerHeight - 8)  top  = rect.top - 80;
        tt.style.left    = `${left}px`;
        tt.style.top     = `${top}px`;
        tt.style.display = 'block';
        requestAnimationFrame(() => { tt.style.opacity = '1'; });
    }

    function hide() {
        clearTimeout(_hideTimer);
        _hideTimer = setTimeout(() => {
            if (_tooltip) { _tooltip.style.opacity = '0'; }
            _hideTimer = setTimeout(() => { if (_tooltip) _tooltip.style.display = 'none'; }, 150);
        }, 80);
    }

    function init() {
        document.addEventListener('mouseover', (e) => {
            const el = e.target.closest('[data-fullpath]');
            if (el) show(el, el.dataset.fullpath);
        });
        document.addEventListener('mouseout', (e) => {
            if (e.target.closest('[data-fullpath]')) hide();
        });
    }

    return { init };
})();


// ============================================================
// MODULE: BulkActionBar
// ============================================================
const BulkActionBar = (() => {
    let _bar         = null;
    let _countEl     = null;
    let _btnDl       = null;
    let _btnRevoke   = null;
    let _btnTransfer = null;
    let _btnRequestOwnership = null;
    let _btnDel      = null;
    let _btnDesel    = null;
    let _initialized = false;

    function _cache() {
        _bar      = document.getElementById('bulk-action-bar');
        _countEl  = document.getElementById('bulk-count');
        _btnDl    = document.getElementById('bulk-btn-download');
        _btnRevoke= document.getElementById('bulk-btn-revoke');
        _btnTransfer = document.getElementById('bulk-btn-transfer');
        _btnRequestOwnership = document.getElementById('bulk-btn-request-ownership');
        _btnDel   = document.getElementById('bulk-btn-delete');
        _btnDesel = document.getElementById('bulk-btn-deselect');
    }

    function init() {
        if (_initialized) return;
        _cache();
        if (!_bar) return;
        _btnDl?.addEventListener('click',     _handleDownload);
        _btnRevoke?.addEventListener('click', _handleRevoke);
        _btnTransfer?.addEventListener('click', _handleTransferOwnership);
        _btnRequestOwnership?.addEventListener('click', _handleRequestOwnership);
        _btnDel?.addEventListener('click',    _handleDelete);
        _btnDesel?.addEventListener('click',  _handleDeselect);
        _initialized = true;
    }

    function update() {
        if (!_bar) _cache();
        if (!_bar) return;
        const count = UIController._selectedFileIds.size;
        if (count === 0) { _bar.classList.remove('is-visible'); return; }
        _bar.classList.add('is-visible');
        if (_countEl) {
            _countEl.innerHTML = `<strong>${fmt(count)}</strong> ${
                I18n.t('bulk.selected').replace('{n}', fmt(count)).replace(/^\d+\s/, '')
            }`;
        }
    }

    function _handleDeselect() {
        UIController._selectedFileIds.clear();
        document.querySelectorAll('#issues-tbody .row-chk').forEach(c => c.checked = false);
        const chkAll = document.getElementById('chk-all');
        if (chkAll) chkAll.checked = false;
        update();
    }

    // [TRASH-6] Bulk trash — gọi _syncKPIAfterChange sau batch
    async function _handleDelete() {
        const ids = [...UIController._selectedFileIds];
        if (ids.length === 0) return;
        ConfirmController.open(
            I18n.t('bulk.confirmDelete').replace('{n}', ids.length),
            async () => {
                const operation = await requireCleanupMutation(ids);
                if (!operation) return;
                if (_btnDel) { _btnDel.disabled = true; _btnDel.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
                if (_btnDl)   _btnDl.disabled   = true;

                let successCount = 0;
                let failCount    = 0;
                const loggedActions = [];

                for (const fileId of ids) {
                    if (!operation.allowedFileIds.includes(fileId)) { failCount++; continue; }
                    try {
                        await deleteFile(fileId);
                        successCount++;
                        UIController._selectedFileIds.delete(fileId);
                        const ai = UIController.allScannedFiles.findIndex(f => f.id === fileId);
                        if (ai !== -1) UIController.allScannedFiles[ai].trashed = true;
                        const pi = UIController._pagination.totalFiles.findIndex(f => f.id === fileId);
                        if (pi !== -1) UIController._pagination.totalFiles[pi].trashed = true;
                        const file = ai !== -1 ? UIController.allScannedFiles[ai] : UIController._pagination.totalFiles[pi];
                        loggedActions.push({ type: 'delete', fileId, fileName: file?.name || 'Unknown', fileSize: file?.size || 0, actionLabel: 'Xóa file' });
                    } catch (_) {
                        failCount++;
                    }
                }

                if (loggedActions.length) await logActionsBulk(loggedActions, operation);
                else await failReservedCleanup(operation);

                if (_btnDel) { _btnDel.disabled = false; _btnDel.innerHTML = `<i class="fas fa-trash"></i> <span>${I18n.t('bulk.delete')}</span>`; }
                if (_btnDl)   _btnDl.disabled   = false;

                // [TRASH-1] Sync KPI ngay sau bulk delete
                UIController._syncKPIAfterChange();
                UIController._applyFull();
                update();

                if (successCount > 0) Toast.success(I18n.t('bulk.deleteSuccess').replace('{n}', successCount));
                if (failCount    > 0) Toast.error(I18n.t('bulk.deleteFail').replace('{n}', failCount));
            }
        );
    }

    async function _handleDownload() {
        const ids = [...UIController._selectedFileIds];
        if (ids.length === 0) return;
        const downloadable = UIController.allScannedFiles.filter(
            f => ids.includes(f.id) && f.capabilities?.canDownload !== false
        );
        if (downloadable.length === 0) { Toast.warning(I18n.t('bulk.noDownloadable')); return; }
        await _downloadSequential(downloadable);
    }

    async function _downloadSequential(files) {
        const { dlModal, dlProgressBar, dlStatusText, dlStats, dlFilename, dlThreads } = UIController.el;
        for (let i = 0; i < files.length; i++) {
            const file  = files[i];
            const token = await getAuthToken();
            if (!token) { Toast.error(I18n.t('toast.noAuth')); return; }
            dlModal.style.display     = 'flex';
            dlFilename.innerText      = `[${i + 1}/${files.length}] ${file.name}`;
            dlProgressBar.style.width = '0%';
            dlProgressBar.innerText   = '0%';
            dlProgressBar.className   = 'wix-progress__bar';
            if (dlStatusText) dlStatusText.innerHTML = `<span style="color:#f59e0b;">${I18n.t('dl.preparing.bulk')}</span>`;
            if (dlStats)   dlStats.innerText   = `0 / ${formatBytes(parseInt(file.size || 0))}`;
            if (dlThreads) dlThreads.innerText = '0';
            UIController.currentDownloader = new SmartDownloader(token);
            try {
                await UIController.currentDownloader.start(
                    file.id, file.name, parseInt(file.size || 0),
                    (percent, loaded, total, threads) => {
                        dlProgressBar.style.width = `${percent}%`;
                        dlProgressBar.innerText   = `${percent}%`;
                        if (dlStats)   dlStats.innerText   = `${formatBytes(loaded)} / ${formatBytes(total)}`;
                        if (dlThreads) dlThreads.innerText = threads;
                    }
                );
            } catch (err) {
                if (err.name === 'AbortError') { dlModal.style.display = 'none'; return; }
                Toast.error(I18n.t('dl.error') + ` "${file.name}": ${err.message}`);
            }
        }
        if (dlStatusText) dlStatusText.innerHTML = `<span style="color:#10b981;">${I18n.t('dl.bulkComplete').replace('{n}', files.length)}</span>`;
        dlProgressBar.innerText = I18n.t('dl.completePct');
        setTimeout(() => { dlModal.style.display = 'none'; }, 2200);
    }

    async function _handleRevoke() {
        const ids = [...UIController._selectedFileIds];
        if (ids.length === 0) return;
        const eligibleIds = ids.filter(fileId => canCurrentAccountManageSharing(
            UIController.allScannedFiles.find(file => file.id === fileId)
        ));
        if (!eligibleIds.length) {
            Toast.warning('Không có tệp nào thuộc quyền sở hữu của bạn để thu hồi quyền.');
            return;
        }
        ConfirmController.open(
            I18n.t('bulk.revokeConfirm').replace('{n}', eligibleIds.length),
            async () => {
                const operation = await requireCleanupMutation(eligibleIds);
                if (!operation) return;
                const allBtns = [_btnDl, _btnRevoke, _btnTransfer, _btnRequestOwnership, _btnDel, _btnDesel];
                allBtns.forEach(b => { if (b) b.disabled = true; });
                if (_btnRevoke) _btnRevoke.innerHTML = `<i class="fas fa-spinner fa-spin"></i> <span>0/${eligibleIds.length}</span>`;

                const currentUser  = UIController._currentUser || await UIController._loadCurrentUser();
                const currentEmail = currentUser?.emailAddress || '';
                let revokeCount = 0;
                let failCount   = 0;
                const loggedActions = [];

                for (let i = 0; i < eligibleIds.length; i++) {
                    const fileId = eligibleIds[i];
                    if (_btnRevoke) _btnRevoke.innerHTML = `<i class="fas fa-spinner fa-spin"></i> <span>${i + 1}/${eligibleIds.length}</span>`;
                    if (!operation.allowedFileIds.includes(fileId)) { failCount++; continue; }
                    try {
                        const currentFile = UIController.allScannedFiles.find(file => file.id === fileId);
                        if (!canCurrentAccountManageSharing(currentFile)) { failCount++; continue; }
                        const permissions = await getFilePermissions(fileId);
                        const revocable   = permissions.filter(p =>
                            p.role !== 'owner' &&
                            !(p.type === 'user' && p.emailAddress === currentEmail) &&
                            !(p.permissionDetails?.some(d => d.inherited === true)) &&
                            !(p.inherited === true)
                        );
                        for (const perm of revocable) {
                            try { await revokePermission(fileId, perm.id); } catch (_) { /* skip inherited/403 */ }
                        }
                        revokeCount++;
                        const fi = UIController.allScannedFiles.findIndex(f => f.id === fileId);
                        if (fi !== -1 && UIController.allScannedFiles[fi].permissions) {
                            UIController.allScannedFiles[fi].permissions =
                                UIController.allScannedFiles[fi].permissions.filter(p => p.role === 'owner');
                            UIController.allScannedFiles[fi].shared = false;
                        }
                        const file = fi !== -1 ? UIController.allScannedFiles[fi] : null;
                        loggedActions.push({ type: 'revoke', fileId, fileName: file?.name || 'Unknown', fileSize: file?.size || 0, actionLabel: 'Thu hồi quyền' });
                    } catch (_) {
                        failCount++;
                    }
                }

                if (loggedActions.length) await logActionsBulk(loggedActions, operation);
                else await failReservedCleanup(operation);

                allBtns.forEach(b => { if (b) b.disabled = false; });
                if (_btnRevoke) _btnRevoke.innerHTML = `<i class="fas fa-shield-alt"></i> <span>${I18n.t('bulk.revoke')}</span>`;

                UIController._applyFull();
                update();

                if (revokeCount > 0) Toast.success(I18n.t('bulk.revokeSuccess').replace('{n}', revokeCount));
                if (failCount   > 0) Toast.error(I18n.t('bulk.revokeFail').replace('{n}', failCount));
            }
        );
    }

    async function _handleTransferOwnership() {
        const selected = UIController.allScannedFiles.filter(f => UIController._selectedFileIds.has(f.id));
        const eligible = selected.filter(f => f.ownedByMe === true && f.capabilities?.canShare !== false && !f.trashed);
        const skipped = selected.length - eligible.length;
        if (!eligible.length) {
            Toast.warning('Không có tệp nào đủ quyền để chuyển sở hữu.');
            return;
        }
        // Reuse the real Drive ownership-transfer helper.  The modal is supplied by
        // the single-file action; bulk applies one validated recipient to eligible files.
        const email = await openOwnershipTransferModal(eligible);
        if (!email) return;
        const normalizedEmail = email.trim().toLowerCase();
        if (!EMAIL_RE.test(normalizedEmail)) { Toast.warning(I18n.t('transfer.invalidEmail')); return; }
        const operation = await requireCleanupMutation(eligible);
        if (!operation) return;
        if (_btnTransfer?.disabled) return;
        if (_btnTransfer) _btnTransfer.disabled = true;
        let success = 0;
        let failed = 0;
        const loggedActions = [];
        for (const file of eligible) {
            if (!operation.allowedFileIds.includes(file.id)) { failed++; continue; }
            try {
                const result = await transferOwnership(file, normalizedEmail);
                if (result.status === 'completed' || result.status === 'pending') {
                    success++;
                    if (!result.alreadyPending) loggedActions.push({ type: result.status === 'completed' ? 'transfer_ownership' : 'transfer_ownership_pending', fileId: file.id, fileName: file.name, fileSize: file.size, actionLabel: 'Chuyển quyền sở hữu' });
                }
                else failed++;
            } catch (_) { failed++; }
        }
        if (loggedActions.length) await logActionsBulk(loggedActions, operation);
        else await failReservedCleanup(operation);
        if (_btnTransfer) _btnTransfer.disabled = false;
        UIController._applyFull();
        if (success) Toast.success(`Đã xử lý chuyển sở hữu cho ${success} tệp.`);
        if (failed || skipped) Toast.warning(`${failed} thất bại, ${skipped} không đủ điều kiện.`);
    }

    async function _handleRequestOwnership() {
        const selected = UIController.allScannedFiles.filter(f => UIController._selectedFileIds.has(f.id));
        const candidates = selected.filter(f => !f.ownedByMe && !f.trashed);
        if (!candidates.length) {
            Toast.warning('Chỉ có thể yêu cầu sở hữu với tệp đang được chia sẻ cho bạn.');
            return;
        }
        if (_btnRequestOwnership?.disabled) return;
        _btnRequestOwnership.disabled = true;
        const originalHtml = _btnRequestOwnership.innerHTML;
        _btnRequestOwnership.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Đang chuẩn bị...</span>';
        try {
            await openOwnershipRequestModal(candidates);
        } finally {
            _btnRequestOwnership.disabled = false;
            _btnRequestOwnership.innerHTML = originalHtml;
        }
    }

    return { init, update };
})();


// ============================================================
// MODULE 5: DuplicateDetector
// ============================================================
const DuplicateDetector = {
    createIndex(files) {
        return createDuplicateIndex(files);
    },
    findDuplicatesWithGroupIndex(files) {
        const map = new Map();
        files.forEach(f => {
            if (!f.name || f.mimeType === 'application/vnd.google-apps.folder') return;
            const key = getDuplicateGroupingKey(f);
            if (!key) return;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(f);
        });
        const result = [];
        let groupIdx = 0;
        map.forEach(group => {
            if (group.length > 1) {
                group.forEach(f => result.push({ ...f, _dupeGroupIdx: groupIdx }));
                groupIdx++;
            }
        });
        return result;
    },

    findDuplicates(files) {
        const map = new Map();
        files.forEach(f => {
            if (!f.name || f.mimeType === 'application/vnd.google-apps.folder') return;
            const key = getDuplicateGroupingKey(f);
            if (!key) return;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(f);
        });
        const dupes = [];
        map.forEach(group => { if (group.length > 1) dupes.push(...group); });
        return dupes;
    },

    countGroups(files) {
        const map = new Map();
        files.forEach(f => {
            if (!f.name || f.mimeType === 'application/vnd.google-apps.folder') return;
            const key = getDuplicateGroupingKey(f);
            if (!key) return;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(f);
        });
        let groups = 0;
        map.forEach(group => { if (group.length > 1) groups++; });
        return groups;
    }
};


// ============================================================
// KHỞI ĐỘNG
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    await I18n.init();
    await loadStaleThreshold();

    const authOverlay = document.getElementById('view-auth');
    const wrapper     = document.getElementById('wrapper');
    const authBtn     = document.getElementById('btn-google-auth');

    // ── Helper: proceed after auth ──────────────────────────────
    async function proceedAfterAuth() {
        if (authOverlay) authOverlay.style.display = 'none';
        if (wrapper) wrapper.style.display = '';

        PathTooltip.init();
        initProfile().catch(error => console.warn('[dashboard] profile refresh failed', { code: error?.code || 'UNKNOWN' }));
        UIController.init();
        refreshStaleUIFromCachedFiles();
        ScanFlowController.init();

        // Hide dashboard view initially — ScanFlowController.autoStart decides which view
        document.getElementById('view-dashboard').style.display = 'none';

        await ScanFlowController.autoStart();

        // App Shell + Fragment Router: bắt đầu điều hướng hash
        if (window.WistorixRouter) {
            window.WistorixRouter.init();
        }
        scheduleCleanupInvitePreload();
    }

    // ── Always bind auth button (may be needed if token expires later) ──
    let _authInited = false;
    if (authBtn) {
        authBtn.addEventListener('click', async () => {
            authBtn.disabled = true;
            authBtn.querySelector('span').textContent = I18n.t('auth.btnLoading');
            try {
                await getAuthToken({ interactive: true });
                // Auth success → hide overlay, show wrapper
                if (authOverlay) authOverlay.style.display = 'none';
                if (wrapper) wrapper.style.display = '';

                if (!_authInited) {
                    // First time init after auth
                    await proceedAfterAuth();
                    _authInited = true;
                } else {
                    // Re-auth after token expiry — just go to scan-start
                    ScanFlowController._showView('scanStart');
                }
            } catch (err) {
                console.error('Auth failed:', err);
                authBtn.disabled = false;
                authBtn.querySelector('span').textContent = I18n.t('auth.btn');
                Toast.error(I18n.t('auth.error'));
            }
        });
    }

    // ── Step 1: Silent auth check ───────────────────────────────
    try {
        await getAuthTokenSilently();
        // Token exists → user already authorized → proceed
        _authInited = true;
        await proceedAfterAuth();
    } catch (_) {
        // No token → show auth overlay, hide wrapper
        if (authOverlay) authOverlay.style.display = 'flex';
        if (wrapper) wrapper.style.display = 'none';
    }
});
