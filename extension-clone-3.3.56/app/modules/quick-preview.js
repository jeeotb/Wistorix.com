import { getFilePreviewBlob } from './drive.js';
import { getActiveAccountId } from './account-manager.js';

export const PREVIEW_STATUS = Object.freeze({
    IDLE: 'idle', LOADING: 'loading', READY: 'ready', UNSUPPORTED: 'unsupported', ERROR: 'error'
});

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const TEXT_TYPES = new Set(['text/plain', 'text/csv', 'application/json']);
const PREVIEW_LIMITS = Object.freeze({ image: 20 * 1024 * 1024, pdf: 15 * 1024 * 1024, text: 2 * 1024 * 1024 });
export const PREFETCH_HOVER_DELAY_MS = 200;
const PREFETCH_LIMITS = Object.freeze({ image: 8 * 1024 * 1024, pdf: 8 * 1024 * 1024, text: 1024 * 1024 });

function fileExtension(file) {
    const name = String(file?.name || '');
    return name.includes('.') ? name.split('.').pop().toLowerCase() : '';
}

function getFallbackIcon(mimeType) {
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('gzip') || mimeType.includes('tar') || mimeType.includes('7z')) return 'fa-file-archive';
    if (mimeType.includes('pdf')) return 'fa-file-pdf';
    if (mimeType.includes('image')) return 'fa-file-image';
    if (mimeType.includes('document') || mimeType.includes('word')) return 'fa-file-word';
    return 'fa-file';
}

export function inspectPreview(file) {
    const mimeType = String(file?.mimeType || '').toLowerCase();
    if (!file?.id || mimeType === FOLDER_MIME) return { supported: false, reason: 'folder', icon: 'fa-folder' };
    if (file.trashed) return { supported: false, reason: 'trashed', icon: 'fa-trash' };
    if (file.capabilities?.canDownload === false) return { supported: false, reason: 'download_disabled', icon: 'fa-file' };

    let renderer = null;
    if (mimeType.startsWith('image/')) renderer = 'image';
    else if (mimeType === 'application/pdf') renderer = 'pdf';
    else if (TEXT_TYPES.has(mimeType) || ['txt', 'csv', 'json'].includes(fileExtension(file))) renderer = 'text';
    if (!renderer) return { supported: false, reason: 'type', icon: getFallbackIcon(mimeType) };

    const size = Number(file.size);
    const limit = PREVIEW_LIMITS[renderer];
    if (Number.isFinite(size) && size > limit) return { supported: false, reason: 'size', renderer, icon: getFallbackIcon(mimeType) };
    return { supported: true, renderer, limit };
}

export function getUnsupportedPreviewMessage(reason) {
    if (reason === 'size') return 'Không thể xem trước nhanh vì tệp quá lớn';
    if (reason === 'folder') return 'Thư mục không hỗ trợ xem trước nhanh';
    if (reason === 'download_disabled') return 'Bạn không có quyền tải nội dung tệp để xem trước';
    if (reason === 'trashed') return 'Tệp trong Thùng rác không hỗ trợ xem trước nhanh';
    return 'Không hỗ trợ xem trước nhanh';
}

export function shouldPrefetch(file) {
    const inspection = inspectPreview(file);
    return inspection.supported && (!Number.isFinite(Number(file.size)) || Number(file.size) <= PREFETCH_LIMITS[inspection.renderer]);
}

export class PreviewResourceManager {
    constructor({ getBlob = getFilePreviewBlob, getAccountId = getActiveAccountId, maxEntries = 20 } = {}) {
        this.getBlob = getBlob; this.getAccountId = getAccountId; this.maxEntries = maxEntries;
        this.cache = new Map(); this.inFlight = new Map(); this.prefetchActive = 0;
    }
    async key(file) { return `${await this.getAccountId() || 'default'}:${file.id}:${file.modifiedTime || ''}`; }
    _remember(key, blob) { this.cache.delete(key); this.cache.set(key, blob); if (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value); }
    async load(file, { prefetch = false } = {}) {
        const key = await this.key(file);
        if (this.cache.has(key)) { const blob = this.cache.get(key); this.cache.delete(key); this.cache.set(key, blob); return { blob, source: 'cache' }; }
        if (this.inFlight.has(key)) return { blob: await this.inFlight.get(key), source: 'inflight' };
        const controller = new AbortController();
        const request = this.getBlob(file.id, { signal: controller.signal }).then(blob => { this._remember(key, blob); return blob; }).finally(() => this.inFlight.delete(key));
        this.inFlight.set(key, request);
        return { blob: await request, source: prefetch ? 'prefetch' : 'network' };
    }
    async prefetch(file) {
        if (!shouldPrefetch(file)) return null;
        const key = await this.key(file);
        if (this.cache.has(key) || this.inFlight.has(key) || this.prefetchActive >= 1) return null;
        this.prefetchActive++;
        try { return await this.load(file, { prefetch: true }); } finally { this.prefetchActive--; }
    }
}

const sharedResourceManager = new PreviewResourceManager();

export class PreviewRequestCoordinator {
    constructor() { this.sessionId = 0; this.controller = null; }

    start(fileId) {
        this.cancel();
        const session = { id: ++this.sessionId, fileId, controller: new AbortController() };
        this.controller = session.controller;
        return session;
    }

    isCurrent(session) { return Boolean(session) && session.id === this.sessionId && this.controller === session.controller; }

    cancel() {
        if (this.controller) this.controller.abort();
        this.controller = null;
    }
}

export class PreviewManager {
    constructor({ getBlob, resourceManager } = {}) { this.resourceManager = resourceManager || (getBlob ? new PreviewResourceManager({ getBlob }) : sharedResourceManager); }
    inspect(file) { return inspectPreview(file); }
    async load(file, inspection, signal) {
        const result = await this.resourceManager.load(file);
        return { ...result, renderer: inspection.renderer };
    }
    prefetch(file) { return this.resourceManager.prefetch(file); }
}

export class PreviewController {
    constructor({ panel, overlay, area, content, fallbackIcon, fallbackName, fallbackBadge, manager = new PreviewManager() }) {
        this.panel = panel;
        this.overlay = overlay;
        this.area = area;
        this.content = content;
        this.fallbackIcon = fallbackIcon;
        this.fallbackName = fallbackName;
        this.fallbackBadge = fallbackBadge;
        this.manager = manager;
        this.coordinator = new PreviewRequestCoordinator();
        this.state = { status: PREVIEW_STATUS.IDLE, fileId: null, renderer: null, error: null };
        this.objectUrl = null;
        this.prefetchTimer = null;
    }

    async open(file) {
        this.cancelPrefetch();
        this.cleanup();
        const session = this.coordinator.start(file?.id || null);
        this.state = { status: PREVIEW_STATUS.IDLE, fileId: file?.id || null, renderer: null, error: null };
        this.panel?.classList.add('active');
        this.overlay?.classList.add('active');
        const inspection = this.manager.inspect(file);
        if (!inspection.supported) {
            if (this.coordinator.isCurrent(session)) this.showUnsupported(file, inspection);
            return;
        }

        this.showLoading();
        try {
            const result = await this.manager.load(file, inspection, session.controller.signal);
            if (!this.coordinator.isCurrent(session)) return;
            await this.showReady(file, result);
        } catch (error) {
            if (error?.name === 'AbortError' || !this.coordinator.isCurrent(session)) return;
            console.warn(`[QuickPreview][${inspection.renderer}]`, error);
            this.showError(file, inspection, error);
        }
    }

    close() {
        this.cancelPrefetch();
        this.cleanup();
        this.panel?.classList.remove('active');
        this.overlay?.classList.remove('active');
        this.state = { status: PREVIEW_STATUS.IDLE, fileId: null, renderer: null, error: null };
    }

    cleanup() {
        this.coordinator.cancel();
        if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = null;
        if (this.content) this.content.replaceChildren();
    }

    retry(file) { return this.open(file); }

    schedulePrefetch(file) {
        this.cancelPrefetch();
        if (!shouldPrefetch(file)) return;
        this.prefetchTimer = setTimeout(() => { this.prefetchTimer = null; this.manager.prefetch(file).catch(() => {}); }, PREFETCH_HOVER_DELAY_MS);
    }
    cancelPrefetch() { if (this.prefetchTimer) clearTimeout(this.prefetchTimer); this.prefetchTimer = null; }

    showLoading() {
        this.state.status = PREVIEW_STATUS.LOADING;
        this._setAreaState(PREVIEW_STATUS.LOADING, true);
        const spinner = document.createElement('div');
        spinner.className = 'quick-preview-loading';
        spinner.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>Đang tải xem trước...</span>';
        this.content?.replaceChildren(spinner);
    }

    showUnsupported(file, inspection) {
        this.state = { status: PREVIEW_STATUS.UNSUPPORTED, fileId: file?.id || null, renderer: null, error: null };
        this._setAreaState(PREVIEW_STATUS.UNSUPPORTED, false);
        if (this.fallbackIcon) this.fallbackIcon.innerHTML = `<i class="fas ${inspection.icon || 'fa-file'}"></i>`;
        if (this.fallbackName) this.fallbackName.textContent = file?.name || '—';
        if (this.fallbackBadge) this.fallbackBadge.textContent = getUnsupportedPreviewMessage(inspection.reason);
    }

    async showReady(file, { blob, renderer }) {
        this.state = { status: PREVIEW_STATUS.READY, fileId: file?.id || null, renderer, error: null };
        this._setAreaState(PREVIEW_STATUS.READY, true);
        this.objectUrl = URL.createObjectURL(blob);
        const node = renderer === 'image' ? this._renderImage(file) : renderer === 'pdf' ? this._renderPdf(file) : await this._renderText(file, blob);
        if (this.state.status === PREVIEW_STATUS.READY && this.state.fileId === file.id) this.content?.replaceChildren(node);
    }

    _renderImage(file) {
        const objectUrl = this.objectUrl;
        const image = document.createElement('img');
        image.className = 'quick-preview-image';
        image.src = objectUrl;
        image.alt = file?.name || 'Bản xem trước hình ảnh';
        image.onerror = () => {
            if (this.state.status === PREVIEW_STATUS.READY && this.state.fileId === file?.id && this.objectUrl === objectUrl) {
                this.showError(file, { renderer: 'image' }, new Error('Image rendering failed'));
            }
        };
        return image;
    }

    _renderPdf(file) {
        const frame = document.createElement('iframe');
        frame.className = 'quick-preview-pdf';
        frame.src = this.objectUrl;
        frame.title = `Xem trước ${file?.name || 'PDF'}`;
        return frame;
    }

    async _renderText(file, blob) {
        let value = await blob.text();
        if (String(file?.mimeType).toLowerCase() === 'application/json' || fileExtension(file) === 'json') {
            try { value = JSON.stringify(JSON.parse(value), null, 2); } catch (_) { /* preserve invalid JSON as text */ }
        }
        const pre = document.createElement('pre');
        pre.className = 'quick-preview-text';
        pre.textContent = value;
        return pre;
    }

    showError(file, inspection, error) {
        this.state = { status: PREVIEW_STATUS.ERROR, fileId: file?.id || null, renderer: inspection.renderer || null, error };
        this._setAreaState(PREVIEW_STATUS.ERROR, true);
        const wrap = document.createElement('div');
        wrap.className = 'quick-preview-error';
        const message = document.createElement('strong');
        message.textContent = 'Không thể tải bản xem trước';
        const hint = document.createElement('span');
        hint.textContent = 'Bạn vẫn có thể mở tệp trên Google Drive.';
        const retry = document.createElement('button');
        retry.type = 'button'; retry.className = 'quick-preview-retry'; retry.textContent = 'Thử lại';
        retry.addEventListener('click', () => this.retry(file), { once: true });
        wrap.append(message, hint, retry);
        this.content?.replaceChildren(wrap);
    }

    _setAreaState(status, hideFallback) {
        if (this.area) this.area.dataset.previewState = status;
        [this.fallbackIcon, this.fallbackName, this.fallbackBadge].forEach(node => { if (node) node.hidden = hideFallback; });
        if (this.content) this.content.hidden = !hideFallback;
    }
}
