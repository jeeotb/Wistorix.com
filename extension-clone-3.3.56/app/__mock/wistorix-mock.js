/* ================================================================
   WISTORIX CLONE — MOCK RUNTIME
   Giả lập chrome.* API + Google Drive API để dashboard chạy được
   ngoài Chrome Extension (bản tĩnh, chỉnh sửa giao diện).
   Tự tắt khi file được đưa ngược vào extension thật.
   ================================================================ */
(function () {
    'use strict';

    // Trong extension thật → không mock gì cả
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        console.info('[wistorix-mock] Đang chạy trong extension thật, bỏ qua mock.');
        return;
    }

    const MOCK = window.WistorixMockData || { files: [], owner: {}, storageQuota: {} };
    const ACCOUNT_ID = 'g_demo@wistorix.dev';
    const TOKEN = 'mock-access-token';
    const LS_STORAGE = '__wistorix_mock_storage__';
    const LS_SEEDED = '__wistorix_mock_seeded__';
    const LS_FRESH  = '__wistorix_mock_fresh__';   // '1' = giả lập tài khoản chưa quét lần nào

    /* ── chrome.storage giả lập trên localStorage ──────────── */
    function readAll() {
        try { return JSON.parse(localStorage.getItem(LS_STORAGE)) || {}; } catch (_) { return {}; }
    }
    function writeAll(obj) {
        try { localStorage.setItem(LS_STORAGE, JSON.stringify(obj)); } catch (_) {}
    }

    const changeListeners = [];
    function fireChanged(changes, area) {
        const payload = {};
        Object.keys(changes).forEach(k => { payload[k] = { newValue: changes[k] }; });
        changeListeners.forEach(fn => { try { fn(payload, area); } catch (_) {} });
    }

    function makeArea(areaName) {
        return {
            get(keys, cb) {
                const all = readAll();
                let out = {};
                if (keys === null || keys === undefined) out = Object.assign({}, all);
                else if (typeof keys === 'string') { if (keys in all) out[keys] = all[keys]; }
                else if (Array.isArray(keys)) keys.forEach(k => { if (k in all) out[k] = all[k]; });
                else if (typeof keys === 'object') Object.keys(keys).forEach(k => { out[k] = (k in all) ? all[k] : keys[k]; });
                if (typeof cb === 'function') { cb(out); return undefined; }
                return Promise.resolve(out);
            },
            set(items, cb) {
                const all = readAll();
                Object.assign(all, items || {});
                writeAll(all);
                fireChanged(items || {}, areaName);
                if (typeof cb === 'function') { cb(); return undefined; }
                return Promise.resolve();
            },
            remove(keys, cb) {
                const all = readAll();
                (Array.isArray(keys) ? keys : [keys]).forEach(k => { delete all[k]; });
                writeAll(all);
                if (typeof cb === 'function') { cb(); return undefined; }
                return Promise.resolve();
            },
            clear(cb) {
                writeAll({});
                if (typeof cb === 'function') { cb(); return undefined; }
                return Promise.resolve();
            }
        };
    }

    /* ── chrome.* ───────────────────────────────────────────── */
    const chromeMock = {
        __isWistorixMock: true,
        runtime: {
            lastError: undefined,
            getURL(path) { try { return new URL(path, document.baseURI).href; } catch (_) { return path; } },
            getManifest() { return { name: 'Wistorix', version: '3.3.56', manifest_version: 3 }; },
            openOptionsPage(cb) { window.location.href = 'dashboard.html'; if (cb) cb(); },
            sendMessage(msg, cb) { if (typeof cb === 'function') cb({}); return Promise.resolve({}); },
            onMessage: { addListener() {}, removeListener() {}, hasListener() { return false; } },
            onInstalled: { addListener() {} },
            onStartup: { addListener() {} }
        },
        storage: {
            local: makeArea('local'),
            sync: makeArea('sync'),
            onChanged: {
                addListener(fn) { changeListeners.push(fn); },
                removeListener(fn) { const i = changeListeners.indexOf(fn); if (i >= 0) changeListeners.splice(i, 1); }
            }
        },
        identity: {
            getAuthToken(opts, cb) {
                const done = typeof opts === 'function' ? opts : cb;
                if (typeof done === 'function') done(TOKEN);
                return Promise.resolve(TOKEN);
            },
            removeCachedAuthToken(details, cb) { if (typeof cb === 'function') cb(); return Promise.resolve(); },
            getRedirectURL(path) { return window.location.origin + '/__mock_oauth/' + (path || ''); },
            launchWebAuthFlow(opts, cb) {
                const url = window.location.origin + '/__mock_oauth/#access_token=' + TOKEN + '&token_type=Bearer&expires_in=3600';
                if (typeof cb === 'function') cb(url);
                return Promise.resolve(url);
            }
        },
        tabs: {
            create(opts, cb) {
                const win = window.open(opts && opts.url ? opts.url : 'about:blank', '_blank');
                if (typeof cb === 'function') cb({ id: 1, url: opts && opts.url });
                return Promise.resolve({ id: 1, url: opts && opts.url, window: win });
            },
            query(q, cb) { if (typeof cb === 'function') cb([]); return Promise.resolve([]); }
        },
        notifications: {
            create(id, opts, cb) {
                console.info('[mock notification]', (opts && opts.title) || id, (opts && opts.message) || '');
                if (typeof cb === 'function') cb('mock-notification');
            },
            clear(id, cb) { if (typeof cb === 'function') cb(true); }
        },
        alarms: {
            create() {}, clear(name, cb) { if (typeof cb === 'function') cb(true); },
            get(name, cb) { if (typeof cb === 'function') cb(null); },
            onAlarm: { addListener() {} }
        },
        i18n: { getMessage(k) { return k; }, getUILanguage() { return 'vi'; } }
    };

    window.chrome = (typeof chrome !== 'undefined' && chrome) ? Object.assign(chrome, chromeMock) : chromeMock;

    /* ── Seed chrome.storage ────────────────────────────────── */
    function seedStorage() {
        const all = readAll();
        if (!all['wistorix_accounts_v1']) {
            const now = Date.now();
            all['wistorix_accounts_v1'] = {
                accounts: {
                    [ACCOUNT_ID]: {
                        id: ACCOUNT_ID,
                        email: MOCK.owner.emailAddress || 'demo@wistorix.dev',
                        name: MOCK.owner.displayName || 'Demo Wistorix',
                        picture: '',
                        initials: 'PH',
                        plan: 'FREE',
                        storageUsed: MOCK.storageQuota.usage || '0',
                        storageTotal: MOCK.storageQuota.limit || '0',
                        fileCount: (MOCK.files || []).length,
                        accessToken: TOKEN,
                        tokenExpiresAt: now + 365 * 24 * 3600 * 1000,
                        scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive'],
                        addedAt: now,
                        lastUsedAt: now,
                        signedOut: false
                    }
                },
                activeAccountId: ACCOUNT_ID,
                primaryWistorixAccountId: ACCOUNT_ID
            };
        }
        const fresh = localStorage.getItem(LS_FRESH) === '1';
        if (!fresh && !all['lastScanTime::' + ACCOUNT_ID]) {
            all['lastScanTime::' + ACCOUNT_ID] = new Date(Date.now() - 3600 * 1000).toISOString();
        }
        writeAll(all);
    }

    /* ── Seed IndexedDB (DriveCacheDB v3) ───────────────────── */
    function openDriveDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('DriveCacheDB', 3);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
                if (!db.objectStoreNames.contains('filesByAccount')) db.createObjectStore('filesByAccount', { keyPath: '_cacheKey' });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function seedDriveCache() {
        if (localStorage.getItem(LS_FRESH) === '1') return;   // để người dùng tự bấm quét
        if (localStorage.getItem(LS_SEEDED) === '3.3.56') return;
        const db = await openDriveDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction('filesByAccount', 'readwrite');
            const store = tx.objectStore('filesByAccount');
            (MOCK.files || []).forEach(f => {
                store.put(Object.assign({}, f, {
                    _accountId: ACCOUNT_ID,
                    _cacheKey: ACCOUNT_ID + ':' + f.id,
                    timestampCacheVersion: 1
                }));
            });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
        db.close();
        localStorage.setItem(LS_SEEDED, '3.3.56');
    }

    /* ── Giả lập Google Drive API + Cloud Functions ─────────── */
    const json = (obj, status) => new Response(JSON.stringify(obj), {
        status: status || 200,
        headers: { 'Content-Type': 'application/json' }
    });
    const noContent = () => new Response(null, { status: 204 });
    const wait = (ms) => new Promise(r => setTimeout(r, ms));

    function findFile(id) {
        return (MOCK.files || []).find(f => f.id === id) || null;
    }

    async function handleApi(url, method, init) {
        const u = String(url);

        // Google Analytics — nuốt im lặng
        if (u.indexOf('google-analytics.com') !== -1) return noContent();

        // userinfo
        if (u.indexOf('/oauth2/v2/userinfo') !== -1) {
            return json({
                id: '1000000000000000001',
                email: MOCK.owner.emailAddress,
                name: MOCK.owner.displayName,
                picture: ''
            });
        }

        // about (user / storageQuota)
        if (u.indexOf('/drive/v3/about') !== -1) {
            return json({
                user: {
                    displayName: MOCK.owner.displayName,
                    emailAddress: MOCK.owner.emailAddress,
                    photoLink: '',
                    me: true
                },
                storageQuota: MOCK.storageQuota
            });
        }

        // changes
        if (u.indexOf('/drive/v3/changes/startPageToken') !== -1) return json({ startPageToken: '1' });
        if (u.indexOf('/drive/v3/changes') !== -1) return json({ changes: [], newStartPageToken: '1' });

        // permissions
        const permMatch = u.match(/\/drive\/v3\/files\/([^/?]+)\/permissions(?:\/([^/?]+))?/);
        if (permMatch) {
            if (method === 'DELETE') return noContent();
            if (method === 'POST' || method === 'PATCH') return json({ id: 'mock-permission', role: 'reader', type: 'user' });
            const file = findFile(decodeURIComponent(permMatch[1]));
            return json({ permissions: (file && file.permissions) || [] });
        }

        // files/{id}
        const fileMatch = u.match(/\/drive\/v3\/files\/([^/?]+)/);
        if (fileMatch && u.indexOf('/drive/v3/files?') === -1) {
            const id = decodeURIComponent(fileMatch[1]);
            const file = findFile(id);
            if (method === 'DELETE') return noContent();
            if (method === 'PATCH') {
                let body = {};
                try { body = JSON.parse((init && init.body) || '{}'); } catch (_) {}
                if (file) Object.assign(file, body);
                return json(Object.assign({}, file || { id: id }, body));
            }
            if (!file) return json({ error: { code: 404, message: 'File not found (mock)' } }, 404);
            return json(file);
        }

        // files.list — phân trang để thấy được màn hình tiến trình quét
        if (u.indexOf('/drive/v3/files') !== -1) {
            const parsed = new URL(u);
            const pageSize = 120;
            const token = parseInt(parsed.searchParams.get('pageToken') || '0', 10) || 0;
            const all = MOCK.files || [];
            const slice = all.slice(token, token + pageSize);
            const next = token + pageSize < all.length ? String(token + pageSize) : undefined;
            await wait(320); // giả lập độ trễ mạng cho animation quét
            const payload = { files: slice.map(f => Object.assign({}, f)) };
            if (next) payload.nextPageToken = next;
            return json(payload);
        }

        // Cloud Functions
        if (u.indexOf('cloudfunctions.net') !== -1) {
            const profile = {
                subscription: { plan: 'free', status: 'FREE', validUntil: null },
                cleanup: { mode: 'limited', isUnlimited: false, usedFiles: 3, totalFiles: 25, remainingFiles: 22 }
            };
            if (u.indexOf('getServerProfile') !== -1) return json(profile);
            if (u.indexOf('getCleanupHistory') !== -1) return json({ history: [], items: [] });
            if (u.indexOf('reserveCleanup') !== -1) {
                let body = {};
                try { body = JSON.parse((init && init.body) || '{}'); } catch (_) {}
                const ids = body.fileIds || [];
                return json(Object.assign({}, profile, {
                    operation: { operationId: 'mock-op-' + Date.now(), allowedFileIds: ids, blockedFileIds: [] }
                }));
            }
            if (u.indexOf('completeCleanup') !== -1 || u.indexOf('failCleanup') !== -1) return json(profile);
            if (u.indexOf('createPaymentLink') !== -1) {
                return json({ checkoutUrl: '#mock-checkout', orderCode: 'MOCK-' + Date.now(), qrCode: '' });
            }
            if (u.indexOf('validateLicense') !== -1) return json({ valid: false, plan: 'free' });
            return json({ ok: true });
        }

        // Sheets / Gmail
        if (u.indexOf('sheets.googleapis.com') !== -1) return json({ spreadsheetId: 'mock-sheet', spreadsheetUrl: '#' });
        if (u.indexOf('gmail.googleapis.com') !== -1) return json({ id: 'mock-mail' });

        return null; // không phải API → để fetch thật xử lý
    }

    const realFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        let url = '';
        let method = (init && init.method) || 'GET';
        if (typeof input === 'string') url = input;
        else if (input && input.url) { url = input.url; method = init && init.method ? init.method : (input.method || 'GET'); }

        if (/^https?:\/\//i.test(url) && (url.indexOf('googleapis.com') !== -1 || url.indexOf('cloudfunctions.net') !== -1 || url.indexOf('google-analytics.com') !== -1)) {
            return handleApi(url, String(method).toUpperCase(), init).then(res => res || realFetch(input, init));
        }
        return realFetch(input, init);
    };

    /* ── Hoãn DOMContentLoaded cho tới khi seed xong ─────────── */
    const ready = (async () => {
        try { seedStorage(); await seedDriveCache(); }
        catch (err) { console.error('[wistorix-mock] seed lỗi', err); }
    })();
    window.WistorixMockReady = ready;

    const nativeAdd = document.addEventListener.bind(document);
    document.addEventListener = function (type, listener, options) {
        if (type === 'DOMContentLoaded' && typeof listener === 'function') {
            return nativeAdd(type, function (event) {
                ready.then(() => listener.call(document, event));
            }, options);
        }
        return nativeAdd(type, listener, options);
    };

    /* ── Tiện ích cho thanh công cụ dev ─────────────────────── */
    window.WistorixMock = {
        accountId: ACCOUNT_ID,
        data: MOCK,
        async reset() {
            localStorage.removeItem(LS_STORAGE);
            localStorage.removeItem(LS_SEEDED);
            localStorage.removeItem(LS_FRESH);
            await new Promise(resolve => {
                const req = indexedDB.deleteDatabase('DriveCacheDB');
                req.onsuccess = req.onerror = req.onblocked = () => resolve();
            });
            window.location.reload();
        },
        async clearScanState() {
            const all = readAll();
            delete all['lastScanTime::' + ACCOUNT_ID];
            writeAll(all);
            await new Promise(resolve => {
                const req = indexedDB.deleteDatabase('DriveCacheDB');
                req.onsuccess = req.onerror = req.onblocked = () => resolve();
            });
            localStorage.removeItem(LS_SEEDED);
            localStorage.setItem(LS_FRESH, '1');
            window.location.reload();
        }
    };

    console.info('[wistorix-mock] Mock runtime đã bật: dữ liệu là giả lập, không kết nối Google Drive.');
})();
