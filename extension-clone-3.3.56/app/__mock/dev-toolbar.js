/* ================================================================
   WISTORIX CLONE — THANH CÔNG CỤ DEV
   Chuyển nhanh giữa các màn hình để chỉnh giao diện.
   Ctrl + Shift + D để ẩn/hiện. Không có trong extension thật.
   ================================================================ */
(function () {
    'use strict';
    if (!window.WistorixMock) return;

    const HIDDEN_KEY = '__wistorix_devbar_hidden__';

    const SCREENS = [
        { label: 'Đăng nhập', fn: showAuth },
        { label: 'Bắt đầu quét', fn: () => showScan('scanStart') },
        { label: 'Đang quét', fn: () => showScan('scanProgress') },
        { label: 'Kết quả quét', fn: () => showScan('scanResult') },
        { label: 'Dashboard', fn: () => showScan('dashboard') }
    ];

    const ROUTES = [
        { label: 'My Drive', hash: '#/mydrive' },
        { label: 'Email chia sẻ', hash: '#/email-shared' },
        { label: 'Cài đặt', hash: '#/settings' },
        { label: 'Mời bạn', hash: '#/invite' },
        { label: 'Nâng cấp', hash: '#/upgrade' },
        { label: 'Dọn dẹp', hash: '#/cleanup' }
    ];

    function showAuth() {
        const overlay = document.getElementById('view-auth');
        const wrapper = document.getElementById('wrapper');
        if (overlay) overlay.style.display = 'flex';
        if (wrapper) wrapper.style.display = 'none';
    }

    function showScan(view) {
        const overlay = document.getElementById('view-auth');
        const wrapper = document.getElementById('wrapper');
        if (overlay) overlay.style.display = 'none';
        if (wrapper) wrapper.style.display = '';
        if (window.location.hash && window.location.hash !== '#/dashboard') window.location.hash = '#/dashboard';
        const ctrl = window.ScanFlowController;
        if (ctrl && typeof ctrl._showView === 'function') ctrl._showView(view);
        else {
            const el = document.getElementById('view-' + view.replace(/([A-Z])/g, '-$1').toLowerCase());
            if (el) el.style.display = 'flex';
        }
    }

    function css() {
        return `
        #wixmock-bar{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;flex-direction:column;gap:8px;
            background:rgba(17,24,39,.96);color:#fff;padding:12px 14px;border-radius:14px;
            font:500 12px/1.4 Manrope,system-ui,sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.35);max-width:340px}
        #wixmock-bar[data-collapsed="true"] .wixmock-body{display:none}
        #wixmock-bar .wixmock-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
        #wixmock-bar .wixmock-title{font-weight:700;letter-spacing:.02em}
        #wixmock-bar .wixmock-title span{opacity:.55;font-weight:500}
        #wixmock-bar .wixmock-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
        #wixmock-bar .wixmock-label{opacity:.5;text-transform:uppercase;font-size:10px;letter-spacing:.08em;margin-top:8px}
        #wixmock-bar button{background:rgba(255,255,255,.1);color:#fff;border:0;border-radius:8px;padding:6px 10px;
            cursor:pointer;font:600 11px/1 Manrope,system-ui,sans-serif;transition:background .15s}
        #wixmock-bar button:hover{background:rgba(255,255,255,.22)}
        #wixmock-bar button.wixmock-danger{background:rgba(239,68,68,.25)}
        #wixmock-bar button.wixmock-danger:hover{background:rgba(239,68,68,.45)}
        #wixmock-bar .wixmock-toggle{background:transparent;font-size:14px;padding:2px 6px}
        #wixmock-bar .wixmock-note{opacity:.5;font-size:10px;margin-top:8px;line-height:1.5}
        `;
    }

    function build() {
        if (document.getElementById('wixmock-bar')) return;

        const style = document.createElement('style');
        style.textContent = css();
        document.head.appendChild(style);

        const bar = document.createElement('div');
        bar.id = 'wixmock-bar';
        // mặc định thu gọn, để bảng nổi không che phân trang của bảng file
        bar.dataset.collapsed = localStorage.getItem(HIDDEN_KEY) === '0' ? 'false' : 'true';

        const head = document.createElement('div');
        head.className = 'wixmock-head';
        head.innerHTML = '<div class="wixmock-title">Wistorix clone <span>· dữ liệu mẫu</span></div>';

        const toggle = document.createElement('button');
        toggle.className = 'wixmock-toggle';
        toggle.textContent = bar.dataset.collapsed === 'true' ? '▲' : '▼';
        toggle.title = 'Ẩn/hiện (Ctrl + Shift + D)';
        toggle.addEventListener('click', () => {
            const collapsed = bar.dataset.collapsed === 'true';
            bar.dataset.collapsed = collapsed ? 'false' : 'true';
            toggle.textContent = collapsed ? '▼' : '▲';
            localStorage.setItem(HIDDEN_KEY, collapsed ? '0' : '1');
        });
        head.appendChild(toggle);
        bar.appendChild(head);

        const body = document.createElement('div');
        body.className = 'wixmock-body';

        body.appendChild(labelEl('Màn hình'));
        body.appendChild(rowEl(SCREENS.map(s => btn(s.label, s.fn))));

        body.appendChild(labelEl('Trang'));
        body.appendChild(rowEl(ROUTES.map(r => btn(r.label, () => { window.location.hash = r.hash; }))));

        body.appendChild(labelEl('Dữ liệu'));
        const reset = btn('Nạp lại dữ liệu mẫu', () => window.WistorixMock.reset());
        reset.className = 'wixmock-danger';
        const clearScan = btn('Xoá cache quét', () => window.WistorixMock.clearScanState());
        clearScan.className = 'wixmock-danger';
        body.appendChild(rowEl([reset, clearScan]));

        const note = document.createElement('div');
        note.className = 'wixmock-note';
        note.textContent = 'Bản clone offline · mọi số liệu là giả lập, không kết nối Google Drive.';
        body.appendChild(note);

        bar.appendChild(body);
        document.body.appendChild(bar);

        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
                e.preventDefault();
                toggle.click();
            }
        });
    }

    function btn(label, onClick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', onClick);
        return b;
    }
    function rowEl(children) {
        const row = document.createElement('div');
        row.className = 'wixmock-row';
        children.forEach(c => row.appendChild(c));
        return row;
    }
    function labelEl(text) {
        const el = document.createElement('div');
        el.className = 'wixmock-label';
        el.textContent = text;
        return el;
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
})();
