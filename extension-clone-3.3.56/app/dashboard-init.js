let currentPreviewFile = null;

document.addEventListener('DOMContentLoaded', () => {

    const CARD_FILTER_MAP = {
        'risk-card-public':    'public',
        'risk-card-stale':     'stale',
        'risk-card-dupes':     'dupes',
    };

    Object.entries(CARD_FILTER_MAP).forEach(([id, filter]) => {
        const el = document.getElementById(id);
        if (el) {
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => navigateToFilter(filter));
        }
    });

    document.querySelectorAll('.info-card').forEach(card => {
        card.addEventListener('click', () => {
            const type = card.dataset.panelType;
            if (type) navigateToFilter(type);
        });
    });

    // Preview listeners live in dashboard.js.  Keeping them here caused the
    // legacy renderer to race the active panel controller.
});

function navigateToFilter(type) {
    if (window.UIController && typeof window.UIController._navigateFromOverviewCard === 'function') {
        window.UIController._navigateFromOverviewCard(type);
    } else {
        window.__pendingOverviewCardFilter = type;
        const observer = new MutationObserver(() => {
            if (window.UIController && typeof window.UIController._navigateFromOverviewCard === 'function') {
                window.UIController._navigateFromOverviewCard(window.__pendingOverviewCardFilter);
                window.__pendingOverviewCardFilter = null;
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
}

function tryOpenPreview(id) {
    const files = window.UIController?.allScannedFiles;
    if (!files) return;
    const file = files.find(f => f.id === id);
    if (!file) return;
    openPreview(file);
}

function getPreviewBadgeText(mime, ext, name) {
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
    currentPreviewFile = file;

    const name = file.name || '—';
    const mime = file.mimeType || '';
    const icon = getPreviewIcon(mime);
    const badge = getPreviewBadgeText(mime, '', name);

    document.getElementById('previewFileName').textContent = name;
    document.getElementById('previewHeroIcon').innerHTML = `<i class="fas ${icon} fa-fw"></i>`;
    document.getElementById('previewHeroName').textContent = name;
    document.getElementById('previewHeroBadge').textContent = badge;
    document.getElementById('previewPath').textContent = file.path || 'My Drive';
    document.getElementById('previewStatus').textContent = file.isPublic ? 'Công khai' : 'Riêng tư';
    document.getElementById('previewOwner').textContent = file.ownedByMe ? 'Tôi' : (file.owners?.[0]?.displayName || 'Khác');
    document.getElementById('previewSize').textContent = formatFileSize(file.size || 0);
    const displayDates = window.WistorixDisplayTimestamps?.(file) || file;
    document.getElementById('previewCreated').textContent = displayDates.createdTime ? new Date(displayDates.createdTime).toLocaleDateString('vi-VN') : '—';
    document.getElementById('previewModified').textContent = displayDates.modifiedTime ? new Date(displayDates.modifiedTime).toLocaleDateString('vi-VN') : '—';

    document.getElementById('filePreview').classList.add('active');
    document.getElementById('previewOverlay').classList.add('active');
}

function closePreview() {
    currentPreviewFile = null;
    document.getElementById('filePreview').classList.remove('active');
    document.getElementById('previewOverlay').classList.remove('active');
}

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return size.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}
