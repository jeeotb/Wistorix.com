import { getAuthToken, getAuthTokenSilently } from './modules/auth.js';
import { getFilePermissions, revokePermission } from './modules/drive.js';
import { initProfile } from './modules/profile.js';

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
        return new Promise(resolve => {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
                chrome.storage.sync.set(obj, resolve);
            } else {
                Object.entries(obj).forEach(([k, v]) => {
                    try { localStorage.setItem('ws_' + k, JSON.stringify(v)); } catch(e) {}
                });
                resolve();
            }
        });
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
   HELPER: fmt
   ================================================================ */
const fmt = (n) => new Intl.NumberFormat('en-US').format(Number(n) || 0);

/* ================================================================
   Toast — Notification
   ================================================================ */
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

/* ================================================================
   SettingsManager
   ================================================================ */
let STALE_THRESHOLD_DAYS = 180;

const SettingsManager = {
    _elements: {},
    init() {
        this._elements = {
            btnSave:                document.getElementById('btn-save-settings'),
            toggleAutoScan:         document.getElementById('toggle-auto-scan'),
            divAutoScan:            document.getElementById('auto-scan-settings'),
            inputScanValue:         document.getElementById('input-scan-value'),
            selectScanUnit:         document.getElementById('select-scan-unit'),
            selectRecentDaysPreset: document.getElementById('select-recent-days-preset'),
            selectFolderSort:       document.getElementById('select-folder-sort'),
            selectLanguage:         document.getElementById('select-language'),
        };
        this._load();
        this._bindEvents();
    },

    _load() {
        const {
            toggleAutoScan, divAutoScan,
            inputScanValue, selectScanUnit,
            selectRecentDaysPreset, selectFolderSort, selectLanguage
        } = this._elements;

        safeStorage.get(['autoScanEnabled', 'scanInterval', 'recentDays', 'folderSort', 'language']).then(data => {

            const isAuto = data.autoScanEnabled || false;
            if (toggleAutoScan) {
                toggleAutoScan.checked = isAuto;
                if (divAutoScan) divAutoScan.style.display = isAuto ? 'block' : 'none';
            }

            let mins = data.scanInterval || 60;
            if (inputScanValue && selectScanUnit) {
                if (mins % 1440 === 0)    { inputScanValue.value = mins / 1440; selectScanUnit.value = '1440'; }
                else if (mins % 60 === 0) { inputScanValue.value = mins / 60;   selectScanUnit.value = '60'; }
                else                      { inputScanValue.value = mins;         selectScanUnit.value = '1'; }
            }

            const savedDays = data.recentDays || 180;
            STALE_THRESHOLD_DAYS = savedDays;
            if (selectRecentDaysPreset) selectRecentDaysPreset.value = String(savedDays);
            this._updateStaleCardSub(savedDays);

            const savedSort = data.folderSort || 'alpha';
            if (selectFolderSort) selectFolderSort.value = savedSort;
            SettingsManager._savedFolderSort = savedSort;

            const savedLang = data.language || 'vi';
            if (selectLanguage) selectLanguage.value = savedLang;
        });

        if (selectRecentDaysPreset) {
            selectRecentDaysPreset.addEventListener('change', () => {
                const days = parseInt(selectRecentDaysPreset.value) || 180;
                STALE_THRESHOLD_DAYS = days;
                this._updateStaleCardSub(days);
            });
        }

        if (selectFolderSort) {
            selectFolderSort.addEventListener('change', () => {
                const isDirty = selectFolderSort.value !== (SettingsManager._savedFolderSort || 'alpha');
                let badge = selectFolderSort.parentElement?.querySelector('.settings-dirty-badge');
                if (isDirty) {
                    if (!badge) {
                        badge = document.createElement('span');
                        badge.className = 'settings-dirty-badge';
                        badge.textContent = 'Chưa lưu';
                        selectFolderSort.parentElement?.appendChild(badge);
                    }
                } else {
                    if (badge) badge.remove();
                }
            });
        }

        if (selectLanguage) {
            selectLanguage.addEventListener('change', () => {
                safeStorage.set({ language: selectLanguage.value });
            });
        }
    },

    _bindEvents() {
        const {
            btnSave, toggleAutoScan, divAutoScan,
            inputScanValue, selectScanUnit, selectRecentDaysPreset,
            selectFolderSort, selectLanguage
        } = this._elements;

        if (toggleAutoScan) {
            toggleAutoScan.onchange = () => {
                if (divAutoScan) divAutoScan.style.display = toggleAutoScan.checked ? 'block' : 'none';
            };
        }

        if (btnSave) {
            btnSave.onclick = async () => {
                const autoScan   = toggleAutoScan?.checked || false;
                const val        = parseInt(inputScanValue?.value) || 1;
                const unit       = parseInt(selectScanUnit?.value) || 1;
                const interval   = val * unit;
                const recentDays = parseInt(selectRecentDaysPreset?.value) || 180;
                const folderSort = selectFolderSort?.value || 'alpha';
                const language   = selectLanguage?.value || 'vi';

                if (autoScan && interval < 1) { Toast.warning('Chu kỳ quét tối thiểu là 1 phút!'); return; }

                await safeStorage.set({ autoScanEnabled: autoScan, scanInterval: interval, recentDays, folderSort, language });

                if (autoScan && typeof chrome !== 'undefined' && chrome.alarms) {
                    chrome.alarms.create('autoScanDrive', { periodInMinutes: interval });
                } else if (typeof chrome !== 'undefined' && chrome.alarms) {
                    chrome.alarms.clear('autoScanDrive');
                }

                STALE_THRESHOLD_DAYS = recentDays;
                this._updateStaleCardSub(recentDays);

                SettingsManager._savedFolderSort = folderSort;
                const sortBadge = document.querySelector('#select-folder-sort ~ .settings-dirty-badge');
                if (sortBadge) sortBadge.remove();

                Toast.success('Cấu hình đã được lưu thành công!');
            };
        }
    },

    _updateStaleCardSub(days) {
        const subEl = document.getElementById('stale-card-sub');
        if (subEl) subEl.textContent = `Files không cập nhật trong ${days} ngày`;
    },
};



/* ============================================================
   Navigation: Tab buttons
   ============================================================ */
function initTabNavigation() {
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var href = btn.getAttribute('data-href');
            if (!href) return;
            var m = href.match(/([a-z0-9-]+\.html)(#([^)]*))?/i);
            if (m) {
                var legacy = { 'dashboard.html': '/dashboard', 'mydrive.html': '/mydrive', 'email-shared.html': '/email-shared', 'settings.html': '/settings', 'invite.html': '/invite', 'upgrade.html': '/upgrade', 'cleanup.html': '/cleanup' };
                var target = legacy[m[1]] || ('/' + m[1].replace('.html', ''));
                window.location.hash = '#' + target;
            } else {
                window.location.href = href;
            }
        });
    });
}

/* ============================================================
   Khởi động
   ============================================================ */
let _mounted = false;

export async function mount() {
    if (_mounted) return;
    _mounted = true;
    initProfile().catch(error => console.warn('[settings] profile refresh failed', { code: error?.code || 'UNKNOWN' }));
    SettingsManager.init();
    initTabNavigation();
}

export async function onShow() {}
export async function onHide() {}

// Standalone (không qua shell) → tự khởi động
if (!window.WistorixRouter) {
    document.addEventListener('DOMContentLoaded', () => { mount(); });
}
