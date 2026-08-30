// popup.js — Wistorix Rich Popup
// Phase 4+5: Loads real user info, storage, and quick stats from cache
import { getAuthTokenSilently } from './modules/auth.js';
import { getLicenseInfo, calculateDaysRemaining, isLifetime, isExpired } from './modules/payos.js';

// ── Đăng ký ChartDataLabels plugin ngay sau khi scripts toàn cục đã load ──
// Gọi tường minh để tránh phụ thuộc vào auto-register (không tin cậy với type="module")
if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
}

document.addEventListener('DOMContentLoaded', async () => {
    let miniChart = null;
    const btnOpen    = document.getElementById('btn-open');
    const userEmail  = document.getElementById('user-email');
    const userAvatar = document.getElementById('user-avatar');
    const userBadge  = document.getElementById('user-badge');
    const statusText = document.getElementById('status-text');
    const statusBox  = document.getElementById('popup-status');

    initOnboarding();

    // ── Open dashboard ──────────────────────────────────────
    btnOpen.addEventListener('click', () => {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            window.open(chrome.runtime.getURL('dashboard.html'));
        }
    });

    // ── Auth & data ─────────────────────────────────────────
    let token = null;
    try {
        token = await getAuthTokenSilently();
    } catch (_) {
        token = null;
    }

    if (!token) {
        userEmail.textContent = 'Bấm để đăng nhập';
        renderStorageFallback();
        renderStatFallback();
        statusText.textContent = 'Chưa có dữ liệu';
        statusBox.className = 'popup-status';
        return;
    }

    // These sources are independent. Do not make cached stats wait for remote
    // userinfo, quota, or license requests.
    fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
    }).then(res => res.json()).then(info => {
        if (info.email) {
            userEmail.textContent = info.email;
            userBadge.style.display = 'inline-block';
            if (info.picture) {
                userAvatar.innerHTML = `<img src="${info.picture}" alt="avatar">`;
            } else {
                userAvatar.textContent = info.email.charAt(0).toUpperCase();
            }
        }
    }).catch(() => {});

    fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota', {
        headers: { Authorization: `Bearer ${token}` }
    }).then(res => res.json()).then(data => {
        const quota = data.storageQuota || {};
        const used  = parseInt(quota.usage || 0);
        const total = parseInt(quota.limit || 0);
        if (total > 0) renderStorage(used, total);
        else renderStorageFallback();
    }).catch(() => {
        renderStorageFallback();
    });

    getLicenseInfo().then(license => {
        if (license && !isExpired(license.expiryDate)) {
            const badge = document.getElementById('premium-badge');
            const label = document.getElementById('premium-label');
            if (badge) badge.style.display = 'inline-flex';
            if (label) {
                const days = calculateDaysRemaining(license.expiryDate);
                if (isLifetime(license.plan)) label.textContent = 'Trọn đời';
                else if (days <= 30) label.textContent = `Còn ${days} ngày`;
                else label.textContent = 'Premium';
            }
        }
    }).catch(() => {});

    loadCachedFiles().then(async files => {
        renderStats(files);
        await renderStatus(files);
        renderMiniChart(files);
    }).catch(() => {
        renderStatFallback();
    });

    // ── Helpers ─────────────────────────────────────────────

    /**
     * formatNumber — Format số nguyên có dấu phân cách hàng nghìn
     * Ví dụ: 12345 → "12,345" | 1234567 → "1,234,567"
     * An toàn với: null, undefined, '—', NaN → trả về giá trị gốc
     */
    function formatNumber(value) {
        if (value === '—' || value === null || value === undefined) return value;
        const n = Number(value);
        if (isNaN(n)) return value;
        return new Intl.NumberFormat('en-US').format(n);
    }

    /**
     * formatBytes — Format dung lượng bytes sang đơn vị đọc được
     * Ví dụ: 1_791_000_000 → "1.7 GB" | 456_789_000 → "435.8 MB"
     * Luôn giữ 1 chữ số thập phân, tự chọn đơn vị phù hợp (B/KB/MB/GB/TB)
     */
    function formatBytes(bytes) {
        const n = parseInt(bytes, 10);
        if (!n || isNaN(n) || n <= 0) return '0 B';
        const k     = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i     = Math.min(Math.floor(Math.log(n) / Math.log(k)), sizes.length - 1);
        const val   = parseFloat((n / Math.pow(k, i)).toFixed(2));
        // Bỏ ".00" nếu là số nguyên tròn (ví dụ 15.00 GB → 15 GB)
        const display = val % 1 === 0 ? val.toFixed(0) : val.toFixed(2).replace(/\.?0+$/, '');
        return `${display} ${sizes[i]}`;
    }

    function renderStorage(used, total) {
        const el = document.getElementById('storage-content');
        if (total <= 0) { renderStorageFallback(); return; }
        const pct  = Math.min(100, Math.round(used / total * 100));
        const warn = pct >= 75;
        el.innerHTML = `
            <div class="storage-row">
                <span class="storage-used">${formatBytes(used)}</span>
                <span class="storage-total">/ ${formatBytes(total)}</span>
            </div>
            <div class="storage-bar-bg">
                <div class="storage-bar-fill${warn ? ' warn' : ''}" style="width:${pct}%"></div>
            </div>
            <div class="storage-pct">
                ${pct}% đã dùng &nbsp;•&nbsp; Còn ${formatBytes(total - used)}
            </div>`;
    }

    function renderStorageFallback() {
        document.getElementById('storage-content').innerHTML =
            '<div style="font-size:11px;color:#a0aec0;">Chưa có dữ liệu – hãy phân tích Drive trước</div>';
    }

    // ── renderStats: existing stats + NEW duplicate + public ──
    function renderStats(files) {
        const STALE_MS = 180 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        let issues = 0, stale = 0;

        files.forEach(f => {
            // count issues: trashed, shared publicly
            if (f.trashed) issues++;
            else if (f.shared) issues++;

            // count stale: not modified in 180+ days, not trashed
            if (!f.trashed) {
                const lastMod = new Date(f.modifiedTime).getTime();
                if (Number.isFinite(lastMod) && now - lastMod >= STALE_MS) stale++;
            }
        });

        setStatPill('stat-total',  files.length, 'Tổng file');
        setStatPill('stat-issues', issues,        'Cần xử lý');
        setStatPill('stat-stale',  stale,         'File cũ (180d)');

        // ── NEW: Duplicate detection ─────────────────────────
        // Priority: md5Checksum (exact) → name+size (heuristic) → unknown
        const hasMd5      = files.some(f => f.md5Checksum);
        const hasNameSize = files.some(f => f.name !== undefined || f.size !== undefined);
        let dupGroups     = null; // null = không đủ data

        if (hasMd5) {
            // Exact match via md5
            const md5Map = {};
            files.forEach(f => {
                if (f.trashed || !f.md5Checksum) return;
                md5Map[f.md5Checksum] = (md5Map[f.md5Checksum] || 0) + 1;
            });
            dupGroups = Object.values(md5Map).filter(c => c > 1).length;
        } else if (hasNameSize) {
            // Heuristic match via name + size
            const nameMap = {};
            files.forEach(f => {
                if (f.trashed) return;
                const key = `${f.name || ''}_${f.size || 0}`;
                nameMap[key] = (nameMap[key] || 0) + 1;
            });
            dupGroups = Object.values(nameMap).filter(c => c > 1).length;
        }
        // dupGroups === null → không có đủ field để tính → hiển thị '—'

        setStatPill('stat-duplicates', dupGroups !== null ? dupGroups : '—', 'Files trùng lặp');

        // ── NEW: Public files (shared && ownedByMe) ──────────
        // Nếu cache chưa có ownedByMe → fallback dùng shared (bao quát hơn, an toàn hơn bỏ sót)
        const hasOwnedByMe = files.some(f => f.ownedByMe !== undefined);
        const publicCount  = files.filter(f =>
            !f.trashed &&
            f.shared === true &&
            (hasOwnedByMe ? f.ownedByMe === true : true)
        ).length;

        setStatPill('stat-public', publicCount, 'Files công khai (của tôi)');
    }

    // ── renderStatFallback: cập nhật đủ 5 pills ──
    function renderStatFallback() {
        setStatPill('stat-total',      '—', 'Tổng file');
        setStatPill('stat-issues',     '—', 'Cần xử lý');
        setStatPill('stat-stale',      '—', 'File cũ (180d)');
        setStatPill('stat-duplicates', '—', 'Files trùng lặp');        // NEW
        setStatPill('stat-public',     '—', 'Files công khai (của tôi)'); // NEW
    }

    /**
     * setStatPill — Cập nhật nội dung một stat pill
     * Tự động format số với dấu phân cách hàng nghìn nếu value là số
     */
    function setStatPill(id, value, label) {
        const el = document.getElementById(id);
        if (!el) return;
        const displayValue = (typeof value === 'number') ? formatNumber(value) : value;
        el.innerHTML = `<div class="num">${displayValue}</div><div class="lbl">${label}</div>`;
    }

    async function renderStatus(files) {
        if (!files || files.length === 0) {
            statusText.textContent = 'Chưa quét Drive';
            statusBox.className = 'popup-status';
            return;
        }

        let issues = 0;
        files.forEach(f => {
            if (f.trashed || f.shared) issues++;
        });

        // Đọc lastScanTime từ chrome.storage (ưu tiên) hoặc fallback về max file modifiedTime
        let scanDate = null;
        try {
            const ns = await import('./modules/account-manager.js').then(({ getActiveAccountId }) => getActiveAccountId()).catch(() => 'default') || 'default';
            const key = 'lastScanTime::' + ns;
            const result = await chrome.storage.local.get([key, 'lastScanTime']);
            if (result[key] || result.lastScanTime) {
                scanDate = new Date(result[key] || result.lastScanTime);
            }
        } catch (_) {}

        if (!scanDate) {
            const latest = files.reduce((max, f) => {
                const t = new Date(f.modifiedTime || f.createdTime).getTime();
                return t > max ? t : max;
            }, 0);
            scanDate = new Date(latest);
        }

        // Format absolute time giống Dashboard
        const now = new Date();
        const timeStr = `${String(scanDate.getHours()).padStart(2,'0')}:${String(scanDate.getMinutes()).padStart(2,'0')}`;

        let dateText;
        if (_isSameDay(scanDate, now)) {
            dateText = `hôm nay, ${timeStr}`;
        } else if (_isYesterday(scanDate, now)) {
            dateText = `Hôm qua, ${timeStr}`;
        } else {
            const d  = String(scanDate.getDate()).padStart(2, '0');
            const m  = String(scanDate.getMonth() + 1).padStart(2, '0');
            const y  = scanDate.getFullYear();
            dateText = `${d}/${m}/${y}, ${timeStr}`;
        }

        statusText.textContent = `Quét lần cuối: ${dateText}`;

        // Màu trạng thái (giữ nguyên)
        if (issues > 10)      statusBox.className = 'popup-status danger';
        else if (issues > 0)  statusBox.className = 'popup-status warn';
        else                  statusBox.className = 'popup-status';
    }

    function _isSameDay(d1, d2) {
        return d1.getFullYear() === d2.getFullYear()
            && d1.getMonth() === d2.getMonth()
            && d1.getDate() === d2.getDate();
    }

    function _isYesterday(d, now) {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        return _isSameDay(d, yesterday);
    }

    function loadCachedFiles() {
        return import('./modules/drive.js')
            .then(({ loadFilesFromCache }) => loadFilesFromCache())
            .catch(() => []);
    }

    function renderMiniChart(files) {
        const canvas = document.getElementById('miniChart');
        if (!canvas || typeof Chart === 'undefined') return;

        // Đảm bảo plugin đã được đăng ký (re-check trong trường hợp timing issue)
        if (typeof ChartDataLabels !== 'undefined') {
            try { Chart.register(ChartDataLabels); } catch (_) { /* already registered */ }
        }

        let image = 0, video = 0, doc = 0, other = 0;

        files.forEach(f => {
            if (f.mimeType?.includes('image'))                                             image++;
            else if (f.mimeType?.includes('video'))                                        video++;
            else if (f.mimeType?.includes('document') || f.mimeType?.includes('sheet'))   doc++;
            else                                                                            other++;
        });

        if (miniChart) miniChart.destroy();

        const dataValues = [image, video, doc, other];
        const total = dataValues.reduce((a, b) => a + b, 0);

        // Không vẽ chart nếu không có data
        if (total === 0) return;

        const COLORS = ['#0052CD', '#1cc88a', '#36b9cc', '#f6c23e'];
        const LABELS = ['Ảnh', 'Video', 'Tài liệu', 'Khác'];

        miniChart = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: LABELS,
                datasets: [{
                    data: dataValues,
                    backgroundColor: COLORS,
                    borderWidth: 2,
                    borderColor: '#fff',
                    hoverOffset: 4,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                cutout: '65%',
                layout: {
                    // Không cần padding lớn vì label ở center/inside
                    padding: 4
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const pct = total > 0 ? Math.round(ctx.raw / total * 100) : 0;
                                return ` ${ctx.label}: ${formatNumber(ctx.raw)} (${pct}%)`;
                            }
                        }
                    },
                    datalabels: {
                        // Đặt label BÊN TRONG arc để tránh clip với canvas nhỏ
                        anchor: 'center',
                        align: 'center',
                        textAlign: 'center',

                        // Màu trắng trên nền màu sẽ luôn đọc được
                        color: '#ffffff',

                        font: {
                            size: 8,
                            weight: '800',
                            family: "'Manrope', sans-serif"
                        },

                        formatter: (value, ctx) => {
                            if (!value || value === 0) return null;

                            const pct = Math.round(value / total * 100);

                            // Ẩn label nếu slice < 8% (quá nhỏ, label bị chồng)
                            if (pct < 8) return null;

                            const label = LABELS[ctx.dataIndex];

                            // Với slice rất nhỏ (8–15%), chỉ hiển thị phần trăm
                            // Với slice lớn hơn, hiển thị cả tên
                            if (pct < 15) return `${pct}%`;
                            return `${label}\n${pct}%`;
                        }
                    }
                }
            }
        });

        // Render mini legend bên dưới chart
        _renderMiniChartLegend(LABELS, COLORS, dataValues, total);
    }

    function _renderMiniChartLegend(labels, colors, values, total) {
        const el = document.getElementById('miniChartLegend');
        if (!el) return;
        el.innerHTML = labels.map((label, i) => {
            const pct = total > 0 ? Math.round(values[i] / total * 100) : 0;
            if (values[i] === 0) return ''; // ẩn mục không có file
            return `
                <span class="mini-legend-item">
                    <span class="mini-legend-dot" style="background:${colors[i]};"></span>
                    ${label} ${pct}%
                </span>`;
        }).join('');
    }

    function initOnboarding() {
        const overlay   = document.getElementById('onboarding-overlay');
        const stepLabel = document.getElementById('onboarding-step-label');
        const titleEl   = document.getElementById('onboarding-title');
        const descEl    = document.getElementById('onboarding-description');
        const permsEl   = document.getElementById('onboarding-permissions');
        const btnPrev   = document.getElementById('onboarding-prev');
        const btnNext   = document.getElementById('onboarding-next');
        if (!overlay || !stepLabel || !titleEl || !descEl || !btnPrev || !btnNext) return;

        const steps = [
            {
                title: 'Chào mừng đến với Wistorix 👋',
                description: 'Wistorix giúp bạn quét Google Drive, phát hiện rủi ro bảo mật và tối ưu dung lượng — ngay trên trình duyệt của bạn.',
                showPerms: false
            },
            {
                title: 'Wistorix cần những quyền gì?',
                description: 'Để hoạt động, Wistorix yêu cầu một số quyền truy cập. Dưới đây là giải thích rõ ràng về từng quyền:',
                showPerms: true
            },
            {
                title: '🔒 Dữ liệu của bạn an toàn',
                description: 'Toàn bộ dữ liệu được xử lý ngay trên trình duyệt của bạn. Wistorix không gửi file hay nội dung Drive lên bất kỳ server nào của chúng tôi.',
                showPerms: false
            },
            {
                title: 'Cấp quyền Google Drive',
                description: 'Nhấn "Tiếp tục" để đăng nhập Google. Bạn sẽ thấy màn hình xác nhận quyền từ Google — hãy chấp nhận để Wistorix có thể hoạt động.',
                showPerms: false
            },
            {
                title: 'Bắt đầu phân tích Drive 🚀',
                description: 'Mọi thứ đã sẵn sàng! Nhấn "Bắt đầu" để mở Dashboard và chạy lần quét đầu tiên của bạn.',
                showPerms: false
            }
        ];

        let currentStep = 0;

        const renderStep = () => {
            const step = steps[currentStep];
            stepLabel.textContent = `Bước ${currentStep + 1}/${steps.length}`;
            titleEl.textContent   = step.title;
            descEl.textContent    = step.description;
            btnPrev.disabled      = currentStep === 0;
            btnNext.textContent   = currentStep === steps.length - 1 ? 'Bắt đầu' : 'Tiếp tục';
            // Hiện/ẩn permissions panel
            if (permsEl) permsEl.style.display = step.showPerms ? 'flex' : 'none';
        };

        chrome.storage.local.get(['onboardingCompleted'], ({ onboardingCompleted }) => {
            if (onboardingCompleted === true) return;
            overlay.classList.remove('hidden');
            overlay.style.display = 'flex';
            renderStep();
        });

        btnPrev.addEventListener('click', () => {
            if (currentStep > 0) {
                currentStep -= 1;
                renderStep();
            }
        });

        btnNext.addEventListener('click', () => {
            if (currentStep < steps.length - 1) {
                currentStep += 1;
                renderStep();
                return;
            }
            chrome.storage.local.set({ onboardingCompleted: true }, () => {
                overlay.classList.add('hidden');
            });
        });
    }
});
