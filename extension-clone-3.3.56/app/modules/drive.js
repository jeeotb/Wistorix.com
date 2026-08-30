/* =======================
   Wistorix — drive.js
   ─────────────────────
   CHANGES:
   [TRASH-FIX] Bỏ q="trashed=false" trong scanDrive → fetch cả file trong Trash
               → card "Thùng rác" đọc đúng số thực từ API
   [NEW] restoreFile()          — PATCH trashed=false, cập nhật cache
   [NEW] permanentlyDeleteFile() — DELETE vĩnh viễn, xóa khỏi cache
======================= */
import { getAuthToken, recoverAuthTokenAfterUnauthorized } from './auth.js';
import { getActiveAccountId } from './account-manager.js';
import { formatDate } from './utils.js';

const DB_NAME    = "DriveCacheDB";
// v3 adds an account-qualified primary key.  The previous `files` store used
// Drive's file id as its key, so identical file ids from different accounts
// overwrote each other.
const DB_VERSION = 3;
const STORE_NAME = "filesByAccount";
const LEGACY_STORE_NAME = "files";
export const TIMESTAMP_CACHE_VERSION = 1;

// Google returns 401 before accepting request. Retry once with a silent,
// account-scoped replacement token; never escalate a normal action to OAuth UI.
export async function fetchGoogleApiWithAuthRetry(request) {
    let token = await getAuthToken();
    let response = await request(token);
    if (response.status !== 401) return response;
    token = await recoverAuthTokenAfterUnauthorized(token);
    return request(token);
}

/* ── Drive API fields ──────────────────────────────────────── */
// [DRIVE-FIELD-FIX] KHÔNG request `permissions(permissionDetails, inheritedFrom)` trong
// files.list: field `inheritedFrom` KHÔNG tồn tại trên resource Permission ở files.list
// → Google trả 400 "Invalid field selection inheritedFrom".
// Chỉ request các field hợp lệ của Permission. Inherited permission được xử lý
// tại thời điểm revoke (lỗi cannotDeletePermission) thay vì đọc từ files.list.
const FILES_LIST_FIELDS =
    "nextPageToken, files(id, name, size, md5Checksum, mimeType, createdTime, modifiedTime, " +
    "webViewLink, ownedByMe, parents, trashed, shared, shortcutDetails, driveId, teamDriveId, " +
    "owners(displayName, emailAddress, photoLink, me), " +
    "permissions(id, type, role, emailAddress, displayName, photoLink, domain), " +
    "capabilities(canDownload, canEdit, canCopy, canShare, canTrash), " +
    "contentRestrictions(readOnly, reason))";

const CHANGES_LIST_FIELDS =
    "nextPageToken, newStartPageToken, changes(removed, fileId, file(" +
    "id, name, size, md5Checksum, mimeType, createdTime, modifiedTime, " +
    "webViewLink, ownedByMe, parents, trashed, shared, " +
    "permissions(id, type, role, emailAddress, displayName, photoLink, domain), " +
    "capabilities(canDownload, canEdit, canCopy, canShare, canTrash), " +
    "contentRestrictions(readOnly, reason)))";

// Guard dev: ngăn field sai quay lại files.list. Ném lỗi rõ ràng nếu phát hiện.
function validateDriveFields(fields, endpoint) {
    const forbiddenFields = ['inheritedFrom'];
    for (const field of forbiddenFields) {
        if (fields.includes(field)) {
            throw new DriveApiError(`[Drive fields] Forbidden/invalid field in ${endpoint}: ${field}`, {
                status: 400,
                reason: 'invalid_field_selection',
                code:   'invalidFieldSelection'
            });
        }
    }
}

/* ── IndexedDB helpers ─────────────────────────────────────── */
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            const tx = request.transaction;
            // Keep the legacy store intact.  Some v1 databases were created
            // without it, which is why opening at v1 never repaired them.
            if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
                db.createObjectStore(LEGACY_STORE_NAME, { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const cacheStore = db.createObjectStore(STORE_NAME, { keyPath: "_cacheKey" });
                // Migrate legacy/default cache without deleting user data.
                if (db.objectStoreNames.contains(LEGACY_STORE_NAME) && tx) {
                    const legacyStore = tx.objectStore(LEGACY_STORE_NAME);
                    legacyStore.openCursor().onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (!cursor) return;
                        const file = cursor.value || {};
                        const accountId = file._accountId || 'default';
                        cacheStore.put({ ...file, _accountId: accountId, _cacheKey: `${accountId}:${file.id}` });
                        cursor.continue();
                    };
                }
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror  = () => reject(request.error);
    });
}

// Namespace cache theo active account để account B không nhìn thấy data account A
async function _currentNamespace() {
    try {
        const id = await getActiveAccountId();
        return id || 'default';
    } catch (_) {
        return 'default';
    }
}

function _tagAccount(files, ns) {
    return files.map(f => ({ ...f, _accountId: ns, _cacheKey: `${ns}:${f.id}` }));
}

export function normalizeCachedFile(file, ns) {
    return {
        ...file,
        _accountId: ns,
        _cacheKey: `${ns}:${file.id}`,
        timestampCacheVersion: TIMESTAMP_CACHE_VERSION,
        modifiedTime: file.modifiedTime || null,
        createdTime: file.createdTime || null
    };
}

export function hasCurrentTimestampCache(files) {
    return Array.isArray(files) && files.every(file => file?.timestampCacheVersion === TIMESTAMP_CACHE_VERSION);
}

function _transactionDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
}

async function saveFilesToCache(files) {
    const ns = await _currentNamespace();
    const db    = await openDB();
    const tx    = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const normalized = _tagAccount(files, ns).map(file => normalizeCachedFile(file, ns));
    const done = _transactionDone(tx);

    // Xoá cache của account hiện tại trước (không đụng account khác)
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
            if (cursor.value && cursor.value._accountId === ns) store.delete(cursor.primaryKey);
            cursor.continue();
            return;
        }
        normalized.forEach(file => store.put(file));
    };
    return done;
}

async function loadFilesFromCache() {
    try {
        const ns = await _currentNamespace();
        const db = await openDB();
        if (!db.objectStoreNames.contains(STORE_NAME)) return [];
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        return await new Promise(resolve => {
            const request = store.getAll();
            request.onsuccess = () => {
                const all = request.result || [];
                resolve(all.filter(f => f._accountId === ns));
            };
            request.onerror = () => resolve([]);
        });
    } catch (err) {
        console.warn('Không thể đọc Drive cache:', err);
        return [];
    }
}

async function updateCachedFileRecord(fileId, updater) {
    const ns = await _currentNamespace();
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_NAME)) return null;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const key = `${ns}:${fileId}`;
    const current = await new Promise(resolve => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
    });
    if (!current) return null;
    const updated = updater(current);
    if (updated) store.put({ ...updated, _accountId: ns, _cacheKey: key });
    else store.delete(key);
    await _transactionDone(tx);
    return updated;
}

function updateSharedFilesCache(fileId, updater) {
    const state = globalThis.window?.WistorixAppState;
    if (!state?.filesCacheLoaded || !Array.isArray(state.filesCache)) return;
    const index = state.filesCache.findIndex(file => file.id === fileId);
    if (index === -1) return;
    const current = state.filesCache[index];
    const updated = updater(current);
    if (updated) Object.assign(current, updated);
    else state.filesCache.splice(index, 1);
}

async function patchCachedFile(fileId, updater) {
    await updateCachedFileRecord(fileId, updater);
    updateSharedFilesCache(fileId, updater);
}

function _timestampSnapshot(file) {
    if (!file) return null;
    return {
        id: file.id || null,
        name: file.name || null,
        createdTime: file.createdTime || null,
        modifiedTime: file.modifiedTime || null,
        modifiedByMeTime: file.modifiedByMeTime || null,
        timestampCacheVersion: file.timestampCacheVersion ?? null
    };
}

function _findRenderedRow(tableBodyId, fileId) {
    const rows = globalThis.window?.document?.querySelectorAll?.(`#${tableBodyId} tr[data-file-id]`) || [];
    return [...rows].find(row => row.dataset.fileId === fileId) || null;
}

function _renderedTimestampSnapshot(row, createdCellIndex, modifiedCellIndex) {
    if (!row) return null;
    const cells = row.children || [];
    return {
        createdTimeText: cells[createdCellIndex]?.textContent?.trim() || null,
        modifiedTimeText: cells[modifiedCellIndex]?.textContent?.trim() || null
    };
}

export function findTimestampAnomaliesFromFiles(files, source = 'unknown') {
    return (Array.isArray(files) ? files : []).filter(file => {
        const created = Date.parse(file?.createdTime || '');
        const modified = Date.parse(file?.modifiedTime || '');
        return Number.isFinite(created) && Number.isFinite(modified) && modified < created;
    }).map(file => ({
        ..._timestampSnapshot(file),
        source
    }));
}

function _firstTimestampDivergence(raw, pipeline) {
    const layers = [
        ['indexedDb', pipeline.indexedDb],
        ['appState', pipeline.appState],
        ['dashboardDataset', pipeline.dashboardDataset],
        ['myDriveDataset', pipeline.myDriveDataset]
    ];
    for (const [layer, value] of layers) {
        if (!value) continue;
        for (const field of ['createdTime', 'modifiedTime']) {
            if (value[field] !== raw[field]) {
                return { layer, field, rawValue: raw[field], localValue: value[field] };
            }
        }
    }
    const expected = {
        createdTimeText: raw.createdTime ? formatDate(raw.createdTime) : '—',
        modifiedTimeText: raw.modifiedTime ? formatDate(raw.modifiedTime) : '—'
    };
    for (const [layer, value] of [['dashboardRendered', pipeline.dashboardRendered], ['myDriveRendered', pipeline.myDriveRendered], ['dashboardPreview', pipeline.dashboardPreview], ['myDrivePreview', pipeline.myDrivePreview]]) {
        if (!value) continue;
        for (const field of ['createdTimeText', 'modifiedTimeText']) {
            if (value[field] !== expected[field]) {
                return { layer, field, rawValue: expected[field], localValue: value[field] };
            }
        }
    }
    return null;
}

// Read-only diagnostic for extension DevTools. It never logs or returns an
// OAuth token, and does not modify cache, AppState, or Drive.
export async function debugTimestampPipeline(fileId) {
    if (!fileId) throw new Error('FILE_ID_REQUIRED');
    const token = await getAuthToken();
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
    url.searchParams.set('fields', 'id,name,createdTime,modifiedTime,modifiedByMeTime,mimeType,trashed,parents');
    url.searchParams.set('supportsAllDrives', 'true');
    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new DriveApiError(`Timestamp diagnostic files.get failed (${response.status})`, { status: response.status });
    const raw = await response.json();
    const indexedDb = (await loadFilesFromCache()).find(file => file.id === fileId) || null;
    const appState = globalThis.window?.WistorixAppState?.filesCache?.find(file => file.id === fileId) || null;
    const dashboardController = globalThis.window?.UIController;
    const dashboardDataset = dashboardController?._pagination?.totalFiles?.find(file => file.id === fileId)
        || dashboardController?.allScannedFiles?.find(file => file.id === fileId) || null;
    const myDriveDebug = globalThis.window?.WistorixMyDriveTimestampDebug;
    const myDriveDataset = myDriveDebug?.getDatasetFile?.(fileId) || myDriveDebug?.getFile?.(fileId) || null;
    const dashboardRow = _findRenderedRow('issues-tbody', fileId);
    const myDriveRow = _findRenderedRow('mydrive-tbody', fileId);
    const dashboardPreview = dashboardController?._previewFile?.id === fileId
        ? {
            createdTimeText: globalThis.window?.document?.getElementById('previewCreated')?.textContent?.trim() || null,
            modifiedTimeText: globalThis.window?.document?.getElementById('previewModified')?.textContent?.trim() || null
        } : null;
    const myDrivePreview = myDriveDebug?.getPreviewFile?.()?.id === fileId
        ? {
            createdTimeText: globalThis.window?.document?.getElementById('mdrv-previewCreated')?.textContent?.trim() || null,
            modifiedTimeText: globalThis.window?.document?.getElementById('mdrv-previewModified')?.textContent?.trim() || null
        } : null;
    return {
        raw: _timestampSnapshot(raw),
        indexedDb: _timestampSnapshot(indexedDb),
        appState: _timestampSnapshot(appState),
        dashboardDataset: _timestampSnapshot(dashboardDataset),
        myDriveDataset: _timestampSnapshot(myDriveDataset),
        dashboardRendered: _renderedTimestampSnapshot(dashboardRow, 7, 8),
        myDriveRendered: _renderedTimestampSnapshot(myDriveRow, 7, 8),
        dashboardPreview,
        myDrivePreview
    };
}

export async function findTimestampAnomalies() {
    const dashboardController = globalThis.window?.UIController;
    const myDriveDebug = globalThis.window?.WistorixMyDriveTimestampDebug;
    const sources = [
        ['dashboardDataset', dashboardController?._pagination?.totalFiles || dashboardController?.allScannedFiles],
        ['myDriveDataset', myDriveDebug?.getDatasetFiles?.() || myDriveDebug?.getFiles?.()],
        ['appState', globalThis.window?.WistorixAppState?.filesCache],
        ['indexedDb', await loadFilesFromCache()]
    ];
    const byId = new Map();
    for (const [source, files] of sources) {
        for (const anomaly of findTimestampAnomaliesFromFiles(files, source)) {
            if (!byId.has(anomaly.id)) byId.set(anomaly.id, anomaly);
        }
    }
    return [...byId.values()];
}

export async function diagnoseTimestampAnomalies() {
    const anomalies = await findTimestampAnomalies();
    const sampledFile = anomalies[0] || null;
    if (!sampledFile) return { anomalies, sampledFile: null, pipeline: null, firstDivergence: null };
    const pipeline = await debugTimestampPipeline(sampledFile.id);
    return {
        anomalies,
        sampledFile,
        pipeline,
        firstDivergence: _firstTimestampDivergence(pipeline.raw, pipeline)
    };
}

/* ── Scan Google Drive ─────────────────────────────────────── */
/**
 * scanDrive — Quét toàn bộ Google Drive
 * @param {boolean}  forceRefresh  — true = bỏ qua cache, fetch lại từ API
 * @param {function} onProgress    — callback(info) được gọi sau mỗi page fetch
 *   info = { current, total, latestFiles[], pageIndex, done }
 *   - current: tổng số files đã fetch tính đến hiện tại
 *   - total:   ước tính tổng (dựa trên quota hoặc tính toán từ tốc độ tăng)
 *   - latestFiles: 5 files mới nhất từ page vừa fetch
 *   - pageIndex: số thứ tự page (1-based)
 *   - done: true khi scan hoàn tất
 */
export async function scanDrive(forceRefresh = false, onProgress = null) {
    // 1️⃣ Try cache first — CHỈ khi không bắt buộc refresh (forceRefresh)
    const cachedFiles = await loadFilesFromCache();
    if (!forceRefresh && cachedFiles.length > 0) {
        if (!hasCurrentTimestampCache(cachedFiles) || !cachedFiles[0].modifiedTime) {
            console.log("⚠️ Cache cũ → refresh lại");
        } else {
            return cachedFiles;
        }
    }

    // 2️⃣ Fetch từ Drive API — user chủ động quét (forceRefresh) LUÔN gọi API thật.
    //    Nếu API/auth/network lỗi → THROW lỗi rõ ràng, KHÔNG trả cache cũ
    //    (tránh UI báo "scan thành công" với dữ liệu cũ).
    // [TRASH-FIX] Bỏ q="trashed=false" → fetch TẤT CẢ file kể cả Trash
    // Trường `trashed` sẽ có trong response để dashboard đếm đúng card Thùng rác
    // [DRIVE-FIELD-FIX] Dùng FILES_LIST_FIELDS hợp lệ — không còn inheritedFrom
    validateDriveFields(FILES_LIST_FIELDS, 'files.list');

    let files     = [];
    let pageToken = null;
    let pageIndex = 0;
    let total     = 0;

    do {
        pageIndex++;
        const url = new URL("https://www.googleapis.com/drive/v3/files");
        url.searchParams.append("pageSize", "1000");
        url.searchParams.append("fields", FILES_LIST_FIELDS);
        if (pageToken) url.searchParams.append("pageToken", pageToken);

        let response;
        try {
            response = await fetchGoogleApiWithAuthRetry(token => fetch(url.toString(), {
                headers: { Authorization: "Bearer " + token }
            }));
        } catch (netErr) {
            throw new DriveApiError("Không thể kết nối Google Drive: " + (netErr.message || 'network_error'), {
                status: 0,
                reason: 'network_error',
                code:   'network_error'
            });
        }

        if (!response.ok) {
            const errorText = await response.text();
            let data = {};
            try { data = JSON.parse(errorText); } catch (_) { /* non-JSON error body */ }
            const e = data.error || {};
            console.error('[Drive API] files.list failed', {
                status:     response.status,
                statusText: response.statusText,
                url:        url.toString(),
                body:       errorText
            });
            throw new DriveApiError(
                e.message || e.errors?.[0]?.message || `Google Drive files.list failed (${response.status})`,
                {
                    status: response.status,
                    reason: e.reason || e.errors?.[0]?.reason || '',
                    code:   e.code || ''
                }
            );
        }

        const data = await response.json();
        if (data.files) files = files.concat(data.files);
        pageToken = data.nextPageToken;

        // Ước tính tổng cho counter: nếu còn page thì giả định ít nhất 1 page nữa
        total = pageToken ? files.length + 1000 : files.length;

        // 📡 Gọi onProgress callback — done=true CHỈ khi đã lấy hết pages
        if (onProgress) {
            const latestFiles = (data.files || []).slice(-5).reverse();
            onProgress({
                current:     files.length,
                total:       total,
                latestFiles: latestFiles,
                pageIndex:   pageIndex,
                done:        !pageToken
            });
        }
    } while (pageToken);

    // 3️⃣ Save to cache — chỉ ghi cache SAU khi lấy xong toàn bộ data
    await saveFilesToCache(files);
    const nsScan = await _currentNamespace();
    await chrome.storage.local.set({ [('lastScanTime::' + nsScan)]: new Date().toISOString() });
    console.log("💾 Drive files cached successfully:", files.length, "files");
    return files;
}

/* ── Trash File (chuyển vào Thùng rác) ────────────────────── */
// PATCH trashed=true — KHÔNG xóa vĩnh viễn, có thể khôi phục
export async function deleteFile(fileId) {
    const response = await fetchGoogleApiWithAuthRetry(token => fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}`,
        {
            method: "PATCH",
            headers: {
                Authorization: "Bearer " + token,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ trashed: true })
        }
    ));

    if (!response.ok) {
        throw new Error("Không thể chuyển file vào thùng rác (thiếu quyền hoặc file không tồn tại)");
    }

    // Cập nhật đúng item cache; không đọc/ghi lại toàn bộ Drive sau một mutation.
    await patchCachedFile(fileId, file => ({ ...file, trashed: true }));
}

/* ── Restore File (khôi phục từ Thùng rác) ────────────────── */
// PATCH trashed=false → file trở về Drive bình thường
export async function restoreFile(fileId) {
    const response = await fetchGoogleApiWithAuthRetry(token => fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}`,
        {
            method: "PATCH",
            headers: {
                Authorization: "Bearer " + token,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ trashed: false })
        }
    ));

    if (!response.ok) {
        throw new Error("Không thể khôi phục file (thiếu quyền hoặc file không tồn tại)");
    }

    // Cập nhật đúng item cache; không đọc/ghi lại toàn bộ Drive sau một mutation.
    await patchCachedFile(fileId, file => ({ ...file, trashed: false }));
}

/* ── Permanently Delete File (xóa vĩnh viễn) ──────────────── */
// DELETE — xóa hoàn toàn khỏi Google Drive, KHÔNG thể hoàn tác
// Chỉ gọi cho file đã ở trong Trash
export async function permanentlyDeleteFile(fileId) {
    const response = await fetchGoogleApiWithAuthRetry(token => fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}`,
        {
            method: "DELETE",
            headers: { Authorization: "Bearer " + token }
        }
    ));

    // DELETE thành công → 204 No Content
    if (!response.ok && response.status !== 204) {
        throw new Error("Không thể xóa vĩnh viễn file (thiếu quyền hoặc file không tồn tại)");
    }

    // Xóa đúng item cache; không đọc/ghi lại toàn bộ Drive sau một mutation.
    await patchCachedFile(fileId, () => null);
}

/* ── Quick Preview content ─────────────────────────────────── */
// Reuses account-aware auth above. Renderers never request their own token.
export async function getFilePreviewBlob(fileId, { signal } = {}) {
    if (!fileId) throw new DriveApiError('Thiếu thông tin file', { code: 'invalid_file' });
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
    url.searchParams.set('alt', 'media');
    url.searchParams.set('supportsAllDrives', 'true');
    const response = await fetchGoogleApiWithAuthRetry(token => fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        signal
    }));
    if (!response.ok) throw await _parseApiError(response, 'Không thể tải nội dung tệp để xem trước');
    return response.blob();
}

/* ── Get File Permissions ──────────────────────────────────── */
export async function getFilePermissions(fileId) {
    try {
        const url   = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`);
        url.searchParams.append("fields", "permissions(id, type, role, emailAddress, displayName, photoLink, domain, pendingOwner, deleted, permissionDetails(inherited,inheritedFrom,permissionType))");
        url.searchParams.append("supportsAllDrives", "true");

        const response = await fetchGoogleApiWithAuthRetry(token => fetch(url.toString(), {
            headers: { Authorization: `Bearer ${token}` }
        }));
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Không thể lấy permissions (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        return data.permissions || [];
    } catch (error) {
        console.error("Lỗi getFilePermissions:", error);
        throw error;
    }
}

/* ── Get File Owner ────────────────────────────────────────── */
export async function getFileOwner(fileId) {
    try {
        const url   = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
        url.searchParams.append("fields", "owners(emailAddress, displayName, photoLink, permissionId)");
        url.searchParams.append("supportsAllDrives", "true");

        const response = await fetchGoogleApiWithAuthRetry(token => fetch(url.toString(), {
            headers: { Authorization: `Bearer ${token}` }
        }));
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Không thể lấy thông tin owner (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        return (data.owners && data.owners.length > 0) ? data.owners[0] : null;
    } catch (error) {
        console.error("Lỗi getFileOwner:", error);
        throw error;
    }
}

/* ── Revoke Permission ─────────────────────────────────────── */
export async function revokePermission(fileId, permissionId) {
    const result = await revokePermissionSafe(fileId, permissionId);
    if (!result.ok) {
        const err = new Error(result.message || 'Không thể thu hồi quyền');
        err.reason = result.reason || '';
        throw err;
    }
    return result;
}

export async function revokePermissionSafe(fileId, permissionId, permissionInfo) {
    if (permissionInfo && permissionInfo.inherited === true) {
        return {
            ok: false,
            skipped: true,
            reason: 'inherited_permission',
            fileId,
            permissionId,
            message: 'Quyền được kế thừa từ thư mục cha, không thể thu hồi trực tiếp trên tệp này.'
        };
    }
    try {
        const response = await fetchGoogleApiWithAuthRetry(token => fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}/permissions/${permissionId}`,
            {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            }
        ));
        if (response.ok || response.status === 204) {
            await patchCachedFile(fileId, file => {
                const permissions = (file.permissions || []).filter(permission => permission.id !== permissionId);
                return {
                    ...file,
                    permissions,
                    shared: permissions.some(permission => permission.role !== 'owner'),
                };
            });
            return { ok: true, fileId, permissionId };
        }
        const errorText = await response.text();
        let parsed;
        try { parsed = JSON.parse(errorText); } catch (_) { parsed = {}; }
        const reason = parsed.error?.reason || parsed.error?.errors?.[0]?.reason || '';
        const message = parsed.error?.message || parsed.error?.errors?.[0]?.message || errorText;
        if (reason === 'cannotDeletePermission' || message.includes('permission is inherited') || message.includes('limited access')) {
            return {
                ok: false,
                skipped: true,
                reason: 'cannot_delete_permission',
                fileId,
                permissionId,
                message: 'Quyền được kế thừa từ thư mục cha, không thể thu hồi trực tiếp trên tệp này.'
            };
        }
        if (reason === 'insufficientFilePermissions' || response.status === 403) {
            return {
                ok: false,
                failed: true,
                reason: 'insufficient_permissions',
                fileId,
                permissionId,
                message: 'Bạn không có quyền thu hồi permission này. Chỉ chủ sở hữu hoặc người có quyền quản lý chia sẻ mới có thể thay đổi.'
            };
        }
        return {
            ok: false,
            failed: true,
            reason: reason || 'unknown',
            fileId,
            permissionId,
            message: message || 'Lỗi không xác định khi thu hồi quyền'
        };
    } catch (err) {
        if (err.name === 'AbortError') {
            return { ok: false, failed: true, reason: 'timeout', fileId, permissionId, message: 'Yêu cầu bị timeout' };
        }
        return { ok: false, failed: true, reason: 'network_error', fileId, permissionId, message: err.message };
    }
}

/* ── Utility ───────────────────────────────────────────────── */
export function isOldFile(file, days = 180) {
    if (!file.modifiedTime) return false;
    const diffDays = (Date.now() - new Date(file.modifiedTime).getTime()) / (1000 * 60 * 60 * 24);
    return !isNaN(diffDays) && diffDays >= days;
}

export async function getFileMetadata(fileId) {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
    url.searchParams.append('fields', 'id,name,parents,ownedByMe,driveId,teamDriveId,mimeType,webViewLink,owners(displayName,emailAddress,me),capabilities(canShare,canTrash)');
    url.searchParams.append('supportsAllDrives', 'true');
    const response = await fetchGoogleApiWithAuthRetry(token => fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` }
    }));
    if (!response.ok) throw await _parseApiError(response, 'Không thể lấy thông tin thư mục nguồn');
    return response.json();
}

export async function removeCachedPermission(fileId, permissionId) {
    await patchCachedFile(fileId, file => {
        const permissions = (file.permissions || []).filter(permission => permission.id !== permissionId);
        return { ...file, permissions, shared: permissions.some(permission => permission.role !== 'owner') };
    });
}

/* ── Export cache reader ───────────────────────────────────── */
// Dùng cho popup.js và các module khác đọc cache trực tiếp
export { loadFilesFromCache };

/* ── Drive Changes API — Incremental Sync ──────────────────── */
// Lần đầu (forceRefresh): scanDrive(true) → lấy startPageToken → lưu vào chrome.storage.local
// Những lần sau (alarm): syncDriveChanges() → fetch thay đổi kể từ token đó
//   → Merge cache: cập nhật file sửa/đổi quyền, đánh dấu file bị xóa
//   → Tiết kiệm 90-99% request so với full scan

export async function getStartPageToken() {
    try {
        const ns       = await _currentNamespace();
        const response = await fetchGoogleApiWithAuthRetry(token => fetch(
            "https://www.googleapis.com/drive/v3/changes/startPageToken",
            { headers: { Authorization: "Bearer " + token } }
        ));
        if (!response.ok) throw new Error(`startPageToken failed (${response.status})`);
        const data = await response.json();
        await chrome.storage.local.set({ [('driveChangesToken::' + ns)]: data.startPageToken });
        console.log("📌 Drive Changes startPageToken lưu:", data.startPageToken);
        return data.startPageToken;
    } catch (err) {
        console.warn("⚠️ Không thể lấy startPageToken:", err);
        return null;
    }
}

export async function syncDriveChanges() {
    const ns        = await _currentNamespace();
    const stored    = await chrome.storage.local.get(['driveChangesToken::' + ns]);
    const savedToken = stored['driveChangesToken::' + ns];

    // Records written before timestamp cache versioning cannot prove that both
    // canonical fields came from the same fresh Drive response. Repair them
    // with one normal full scan instead of guessing or rewriting timestamps.
    const cachedBeforeSync = await loadFilesFromCache();
    if (cachedBeforeSync.length > 0 && !hasCurrentTimestampCache(cachedBeforeSync)) {
        const files = await scanDrive(true);
        await getStartPageToken();
        return files;
    }

    if (!savedToken) {
        console.log("🔄 Chưa có driveChangesToken → full scan lần đầu");
        const files = await scanDrive(true);
        await getStartPageToken();
        return files;
    }

    // [DRIVE-FIELD-FIX] Dùng CHANGES_LIST_FIELDS hợp lệ — không còn inheritedFrom
    validateDriveFields(CHANGES_LIST_FIELDS, 'changes.list');

    let pageToken  = savedToken;
    const allChanges = [];

    try {
        do {
            const url = new URL("https://www.googleapis.com/drive/v3/changes");
            url.searchParams.append("pageToken",       pageToken);
            url.searchParams.append("fields",          CHANGES_LIST_FIELDS);
            url.searchParams.append("pageSize",        "1000");
            url.searchParams.append("includeRemoved",  "true");

            const response = await fetchGoogleApiWithAuthRetry(token => fetch(url.toString(), {
                headers: { Authorization: "Bearer " + token }
            }));

            if (response.status === 401 || response.status === 410) {
                console.warn("⚠️ driveChangesToken hết hạn → full scan lại");
                const files = await scanDrive(true);
                await getStartPageToken();
                return files;
            }
            if (!response.ok) {
                const errorText = await response.text();
                console.error('[Drive API] changes.list failed', {
                    status:     response.status,
                    statusText: response.statusText,
                    url:        url.toString(),
                    body:       errorText
                });
                throw new Error(`Changes API error (${response.status}): ${errorText}`);
            }

            const data = await response.json();
            if (data.changes) allChanges.push(...data.changes);

            if (data.newStartPageToken) {
                await chrome.storage.local.set({ [('driveChangesToken::' + ns)]: data.newStartPageToken });
                console.log("📌 driveChangesToken cập nhật:", data.newStartPageToken);
            }
            pageToken = data.nextPageToken || null;
        } while (pageToken);

        if (allChanges.length === 0) {
            console.log("✅ Không có thay đổi mới kể từ lần sync cuối.");
            return await loadFilesFromCache();
        }

        console.log(`🔄 Incremental sync: ${allChanges.length} thay đổi`);

        const cachedFiles = await loadFilesFromCache();
        const fileMap     = new Map(cachedFiles.map(f => [f.id, f]));

        for (const change of allChanges) {
            if (change.removed) {
                // File bị xóa vĩnh viễn → giữ record cũ ở trạng thái trashed.
                if (fileMap.has(change.fileId)) {
                    fileMap.get(change.fileId).trashed = true;
                }
            } else if (change.file) {
                // Changes API trả file metadata mới, kể cả trash/restore. Thay
                // toàn bộ record để timestamp canonical mới không bị cache cũ đè.
                fileMap.set(change.file.id, change.file);
            }
        }

        const mergedFiles = [...fileMap.values()];
        await saveFilesToCache(mergedFiles);
        await chrome.storage.local.set({ [('lastScanTime::' + ns)]: new Date().toISOString() });
        console.log(`💾 Cache cập nhật: ${mergedFiles.length} files sau sync`);
        return mergedFiles;

    } catch (err) {
        console.warn("⚠️ syncDriveChanges lỗi → dùng cache cũ:", err);
        return await loadFilesFromCache();
    }
}

/* ── Transfer Ownership ──────────────────────────────────── */
// Google Drive v3: chuyển ownership giữa 2 tài khoản consumer (vd gmail.com)
// bị Google chặn 403 "Consent is required to transfer ownership..." kể từ 04/2022.
// Luồng đúng theo docs:
//   1) current owner tạo/cập nhật permission người nhận: role=writer, pendingOwner=true
//      → Google gửi email mời, người nhận đồng ý thì ownership mới hoàn tất.
//   2) với tài khoản Workspace cùng tổ chức, có thể chuyển thẳng qua
//      permissions.update role=owner + transferOwnership=true.

export class DriveApiError extends Error {
    constructor(message, { status = null, reason = '', code = '' } = {}) {
        super(message);
        this.name   = 'DriveApiError';
        this.status = status;
        this.reason = reason;
        this.code   = code;
    }
}

export function isConsentRequiredError(err) {
    if (!err) return false;
    const reason  = String(err.reason || '').toLowerCase();
    const message = String(err.message || '').toLowerCase();
    return reason.includes('consentrequiredforownershiptransfer')
        || reason.includes('consent_required')
        || message.includes('consent is required to transfer ownership');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isValidEmail = (email) => typeof email === 'string' && EMAIL_RE.test(email.trim());

async function _parseApiError(response, fallback) {
    const data = await response.json().catch(() => ({}));
    const e    = data.error || {};
    return new DriveApiError(e.message || e.errors?.[0]?.message || fallback, {
        status: response.status,
        reason: e.reason || e.errors?.[0]?.reason || '',
        code:   e.code || ''
    });
}

export async function createFilePermission(fileId, body, { sendNotificationEmail = false, emailMessage, transferOwnership = false } = {}) {
    const url   = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`);
    url.searchParams.append("supportsAllDrives", "true");
    if (sendNotificationEmail) url.searchParams.append("sendNotificationEmail", "true");
    if (emailMessage)           url.searchParams.append("emailMessage", emailMessage);
    if (transferOwnership)      url.searchParams.append("transferOwnership", "true");

    const response = await fetchGoogleApiWithAuthRetry(token => fetch(url.toString(), {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body)
    }));
    if (!response.ok) throw await _parseApiError(response, `Không thể tạo permission (${response.status})`);
    return response.json();
}

export async function updateFilePermission(fileId, permissionId, body, { sendNotificationEmail = false, emailMessage, transferOwnership = false } = {}) {
    const url   = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions/${permissionId}`);
    url.searchParams.append("supportsAllDrives", "true");
    if (sendNotificationEmail) url.searchParams.append("sendNotificationEmail", "true");
    if (emailMessage)           url.searchParams.append("emailMessage", emailMessage);
    if (transferOwnership)      url.searchParams.append("transferOwnership", "true");

    const response = await fetchGoogleApiWithAuthRetry(token => fetch(url.toString(), {
        method:  'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body)
    }));
    if (!response.ok) throw await _parseApiError(response, `Không thể cập nhật permission (${response.status})`);
    return response.json();
}

/**
 * transferOwnership — luồng hoàn chỉnh chuyển quyền sở hữu file sang user khác.
 * @param {object} file       — đối tượng file (phải có id, ownedByMe, permissions,...)
 * @param {string} targetEmail — email người nhận quyền sở hữu
 * @returns {Promise<{status:'completed'|'pending'|'already_owner', email, alreadyPending?}>}
 */
export async function transferOwnership(file, targetEmail) {
    if (!file || !file.id) {
        throw new DriveApiError('Thiếu thông tin file', { code: 'invalid_file' });
    }
    const email = String(targetEmail || '').trim().toLowerCase();
    if (!isValidEmail(email)) {
        throw new DriveApiError('Vui lòng nhập email hợp lệ', { code: 'invalid_email' });
    }
    if (file.ownedByMe !== true) {
        throw new DriveApiError('Bạn không có quyền chuyển quyền sở hữu tệp này.', { code: 'not_owner' });
    }
    if (file.driveId || file.teamDriveId) {
        throw new DriveApiError('File nằm trong Shared Drive, không hỗ trợ chuyển quyền sở hữu.', { code: 'shared_drive' });
    }
    if (file.trashed) {
        throw new DriveApiError('Không thể chuyển quyền sở hữu file trong Thùng rác.', { code: 'trashed' });
    }
    if (file.capabilities && file.capabilities.canShare === false) {
        throw new DriveApiError('Bạn không có quyền chuyển quyền sở hữu tệp này.', { code: 'cannot_share' });
    }

    const fileId = file.id;

    // 1️⃣ Tìm permission hiện có của email nhận quyền
    const permissions = await getFilePermissions(fileId);
    let perm = (permissions || []).find(p =>
        !p.deleted &&
        p.emailAddress && p.emailAddress.trim().toLowerCase() === email
    );

    if (perm && perm.role === 'owner') {
        return { status: 'already_owner', email };
    }
    if (perm && perm.pendingOwner) {
        return { status: 'pending', email, alreadyPending: true };
    }

    // 2️⃣ Chưa có permission → tạo writer permission trước
    if (!perm) {
        perm = await createFilePermission(fileId, {
            type: 'user', role: 'writer', emailAddress: email
        }, { sendNotificationEmail: true });
    }
    const permissionId = perm.id;
    if (!permissionId) {
        throw new DriveApiError('Không thể xác định permission của người nhận.', { code: 'no_permission_id' });
    }

    // 3️⃣ Thử chuyển thẳng (hợp lệ với tài khoản Workspace cùng tổ chức)
    try {
        await updateFilePermission(fileId, permissionId, { role: 'owner' }, {
            transferOwnership: true,
            sendNotificationEmail: true
        });
        await patchCachedFile(fileId, cachedFile => {
            const permissions = (cachedFile.permissions || []).map(permission =>
                permission.emailAddress?.trim().toLowerCase() === email ? { ...permission, role: 'owner' } : permission
            );
            return {
                ...cachedFile,
                ownedByMe: false,
                owners: [{ emailAddress: email, me: false }],
                permissions,
            };
        });
        return { status: 'completed', email };
    } catch (err) {
        // 4️⃣ Google yêu cầu consent (consumer account / khác tổ chức):
        //    → chuyển sang luồng mời nhận quyền sở hữu
        if (isConsentRequiredError(err)) {
            await updateFilePermission(fileId, permissionId, { role: 'writer', pendingOwner: true }, {
                sendNotificationEmail: true,
                emailMessage: 'Bạn được mời nhận quyền sở hữu tệp này. Vui lòng mở tệp và chấp nhận quyền sở hữu để hoàn tất.'
            });
            return { status: 'pending', email, alreadyPending: false };
        }
        throw err;
    }
}

/* ── Cập nhật 1 file trong IndexedDB cache ────────────────── */
export async function updateCachedFile(fileId, updater) {
    await patchCachedFile(fileId, updater);
}

// Drive's ownedByMe is account-scoped canonical metadata. Fail closed for
// incomplete metadata and Shared Drive items, which have no personal owner.
export function canCurrentAccountManageSharing(file) {
    return file?.ownedByMe === true && !file.driveId && !file.teamDriveId;
}
