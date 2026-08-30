/* ================================================================
   WISTORIX CLONE — DEMO CTA THEO MÔ HÌNH 25 TỆP MỖI NGÀY
   Lớp phủ độc lập, không sửa file gốc của extension.
   Tắt bằng cách xoá dòng <script src="__mock/cta-demo.js"> trong
   dashboard.html, hoặc bấm "Tắt demo" trên bảng điều khiển.
   ================================================================ */
(function () {
    'use strict';
    if (!window.WistorixMock) return;   // chỉ chạy trên bản clone offline

    const LS_KEY = '__wistorix_cta_demo__';
    const DAILY  = 25;

    const DEFAULTS = { on: true, day: 1, used: 0, backlog: 88, remind: false, processedTotal: 0 };

    function load() {
        try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(LS_KEY)) || {}); }
        catch (_) { return Object.assign({}, DEFAULTS); }
    }
    function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (_) {} }

    const state = load();

    const remaining  = () => Math.max(0, DAILY - state.used);
    const daysLeft   = () => Math.ceil(state.backlog / DAILY);
    const selectedCount = () => (window.UIController && window.UIController._selectedFileIds)
        ? window.UIController._selectedFileIds.size : 0;

    /* ── CSS ────────────────────────────────────────────── */
    function injectCss() {
        if (document.getElementById('wixcta-style')) return;
        const s = document.createElement('style');
        s.id = 'wixcta-style';
        s.textContent = `
        .wixcta-greet{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;margin:0 0 4px;
            padding:11px 16px;border-radius:8px;background:#EEF4FF;border:1px solid #CBDCFF;
            font:500 13.5px/1.45 Manrope,system-ui,sans-serif;color:#1E3A8A}
        .wixcta-greet b{font-weight:800}
        .wixcta-greet .wixcta-greet__prog{margin-left:auto;font-size:12.5px;color:#3B5BA5}
        .wixcta-note{display:block;margin-top:8px;font:600 11.5px/1.4 Manrope,system-ui,sans-serif;color:#A2560A}
        .wixcta-note--muted{color:#64748B;font-weight:500}
        .wixcta-bulknote{width:100%;margin-top:6px;font:600 12px/1.4 Manrope,system-ui,sans-serif;color:#FBBF24}
        .wixcta-bulknote a{color:#fff;text-decoration:underline;cursor:pointer}

        .wixcta-ov{position:fixed;inset:0;background:rgba(9,16,27,.55);backdrop-filter:blur(2px);
            z-index:2147482000;display:flex;align-items:center;justify-content:center;padding:24px}
        .wixcta-modal{background:#fff;border-radius:14px;max-width:460px;width:100%;padding:26px 28px;
            box-shadow:0 24px 60px -20px rgba(9,16,27,.5);font-family:Manrope,system-ui,sans-serif;color:#0F172A}
        .wixcta-modal h3{margin:0 0 10px;font-size:19px;font-weight:800;line-height:1.25}
        .wixcta-modal p{margin:0 0 14px;font-size:14.5px;line-height:1.6;color:#475569}
        .wixcta-bar{height:8px;border-radius:99px;background:#E2E8F0;overflow:hidden;margin:2px 0 7px}
        .wixcta-bar__fill{display:block;height:100%;border-radius:99px;background:#2563EB;transition:width .45s ease}
        .wixcta-bar__fill.is-full{background:#F59E0B}
        .wixcta-barlabel{display:flex;justify-content:space-between;gap:12px;margin:0 0 16px;
            font-size:12.5px;color:#64748B}
        .wixcta-barlabel b{color:#0F172A;font-weight:700;font-variant-numeric:tabular-nums}
        .wixcta-row{display:flex;flex-wrap:wrap;gap:9px;margin-top:4px}
        .wixcta-btn{border:0;border-radius:8px;padding:11px 16px;font:800 13.5px Manrope,system-ui,sans-serif;
            cursor:pointer;background:#2563EB;color:#fff}
        .wixcta-btn:hover{background:#1D4ED8}
        .wixcta-btn--ghost{background:#F1F5F9;color:#334155}
        .wixcta-btn--ghost:hover{background:#E2E8F0}
        .wixcta-foot{margin:14px 0 0;font-size:12px;color:#94A3B8}
        .wixcta-up{margin:14px 0 0;padding-top:13px;border-top:1px solid #E2E8F0;font-size:13.5px;color:#334155}
        .wixcta-up a{color:#2563EB;font-weight:700;text-decoration:none;cursor:pointer}
        .wixcta-tag{display:inline-block;font:700 10.5px Manrope,system-ui,sans-serif;letter-spacing:.08em;
            text-transform:uppercase;color:#2563EB;background:#DBEAFE;padding:3px 8px;border-radius:5px;margin-bottom:12px}

        .wixcta-osnotif{position:fixed;top:18px;right:18px;z-index:2147483100;width:340px;background:#fff;
            border-radius:12px;box-shadow:0 18px 44px -18px rgba(9,16,27,.55);padding:14px 16px;
            font-family:Manrope,system-ui,sans-serif;border:1px solid #E2E8F0;animation:wixctaIn .25s ease}
        @keyframes wixctaIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
        .wixcta-osnotif__src{font-size:11px;color:#94A3B8;display:flex;align-items:center;gap:6px;margin-bottom:6px}
        .wixcta-osnotif__t{font-size:14px;font-weight:800;color:#0F172A;margin-bottom:3px}
        .wixcta-osnotif__b{font-size:13px;color:#475569;line-height:1.5}

        .wixcta-panel{position:fixed;left:16px;bottom:16px;z-index:2147483000;width:270px;
            background:#0B1220;color:#fff;border-radius:14px;padding:13px 15px 15px;
            font:500 12px/1.45 Manrope,system-ui,sans-serif;box-shadow:0 14px 34px -14px rgba(0,0,0,.6)}
        .wixcta-panel[data-min="true"] .wixcta-panel__body{display:none}
        .wixcta-panel__head{display:flex;align-items:center;justify-content:space-between;gap:8px}
        .wixcta-panel__title{font-weight:800;font-size:12.5px}
        .wixcta-panel__title span{opacity:.5;font-weight:500}
        .wixcta-panel__body{margin-top:11px;display:flex;flex-direction:column;gap:9px}
        .wixcta-panel__day{display:flex;align-items:center;gap:8px}
        .wixcta-panel__day b{font-size:15px;font-weight:800;min-width:58px;text-align:center}
        .wixcta-panel__stat{font-size:11.5px;opacity:.65;line-height:1.5}
        .wixcta-panel__stat b{opacity:1;font-weight:700}
        .wixcta-panel input[type=number]{width:64px;background:rgba(255,255,255,.1);border:0;color:#fff;
            border-radius:6px;padding:4px 7px;font:600 12px Manrope,system-ui,sans-serif}
        .wixcta-panel button{background:rgba(255,255,255,.11);border:0;color:#fff;border-radius:7px;
            padding:6px 10px;font:700 11.5px Manrope,system-ui,sans-serif;cursor:pointer}
        .wixcta-panel button:hover{background:rgba(255,255,255,.22)}
        .wixcta-panel button.pri{background:#2563EB}
        .wixcta-panel button.pri:hover{background:#1D4ED8}
        .wixcta-panel__grid{display:flex;flex-wrap:wrap;gap:6px}
        .wixcta-panel__hint{font-size:10.5px;opacity:.45;line-height:1.5}
        `;
        document.head.appendChild(s);
    }

    /* ── E2 giả lập: số việc tồn trên tiêu đề tab ────────── */
    function renderTitleBadge() {
        const base = document.title.replace(/^\(\d+\)\s*/, '');
        document.title = state.backlog > 0 ? '(' + state.backlog + ') ' + base : base;
    }

    /* ── E3: dòng chào phiên đầu tiên trong ngày ─────────── */
    function renderGreeting() {
        const header = document.querySelector('#view-dashboard .dash-header');
        if (!header) return;
        let el = document.getElementById('wixcta-greet');
        if (!el) {
            el = document.createElement('div');
            el.id = 'wixcta-greet';
            el.className = 'wixcta-greet';
            const tabs = header.querySelector('.dash-header__tabs');
            header.insertBefore(el, tabs || null);
        }
        const done = state.processedTotal;
        const total = done + state.backlog;
        if (state.backlog === 0) {
            el.innerHTML = 'Drive đã sạch. Wistorix sẽ báo khi có tệp mới cần xử lý.'
                + '<span class="wixcta-greet__prog">Đã dọn <b>' + done + '</b> mục</span>';
            return;
        }
        const head = remaining() === 0
            ? 'Hôm nay đã dùng hết 25 tệp, hạn mức mở lại lúc 00:00. '
            : 'Hạn mức đã làm mới, <b>' + remaining() + '</b> tệp cho hôm nay. ';
        el.innerHTML = head
            + 'Còn khoảng <b>' + daysLeft() + '</b> ngày nữa là Drive sạch.'
            + '<span class="wixcta-greet__prog">Đã dọn <b>' + done + '</b>/' + total + ' mục · ngày thứ <b>' + state.day + '</b></span>';
    }

    /* ── B1: thẻ hạn mức ở sidebar ───────────────────────── */
    function renderSidebarQuota() {
        const card = document.querySelector('a[data-route="/cleanup"]');
        if (!card) return;
        const title = card.querySelector('.sidebar__card-title');
        const sub   = card.querySelector('.sidebar__card-sub');
        const bar   = card.querySelector('.sidebar__progress-bar');
        const foot  = card.querySelector('.sidebar__card-footnote');
        if (title) title.textContent = 'Hạn mức hôm nay';
        if (sub) {
            sub.textContent = remaining() === 0
                ? 'Đã dùng hết 25 tệp'
                : 'Còn ' + remaining() + '/' + DAILY + ' tệp';
            sub.style.color = remaining() === 0 ? '#F87171' : (remaining() <= 5 ? '#FBBF24' : '');
        }
        if (bar) bar.style.width = Math.round(state.used / DAILY * 100) + '%';
        if (foot) {
            foot.textContent = remaining() === 0
                ? 'Mở lại lúc 00:00 · nâng gói để tiếp tục ngay'
                : (remaining() <= 5 ? 'Làm mới lúc 00:00 · nâng gói để không phải chờ' : 'Làm mới lúc 00:00');
        }
    }

    /* ── D1: sửa phụ đề thẻ nâng cấp ─────────────────────── */
    function renderUpgradeCard() {
        const sub = document.querySelector('a[data-route="/upgrade"] .sidebar__card-sub');
        if (sub && sub.textContent !== 'Dọn dẹp không giới hạn số tệp') {
            sub.textContent = 'Dọn dẹp không giới hạn số tệp';
        }
    }

    /* ── B2: chú thích dưới ba nút thẻ rủi ro ────────────── */
    function renderRiskNotes() {
        document.querySelectorAll('.risk-action-btn').forEach(btn => {
            const card = btn.closest('.issue-card');
            if (!card) return;
            const valueEl = card.querySelector('.issue-card-value, [class*="issue-card-value"]');
            const n = valueEl ? parseInt(String(valueEl.textContent).replace(/\D/g, ''), 10) || 0 : 0;
            let note = card.querySelector('.wixcta-note');
            if (n > remaining() && n > 0) {
                if (!note) {
                    note = document.createElement('span');
                    note.className = 'wixcta-note';
                    btn.parentNode.insertBefore(note, btn.nextSibling);
                }
                note.textContent = n + ' tệp · vượt hạn mức hôm nay ' + (n - remaining()) + ' tệp';
            } else if (note) {
                note.remove();
            }
        });
    }

    /* ── A3: chú thích dưới nút xử lý hết ────────────────── */
    function renderFixAllNote() {
        const btn = document.getElementById('deductions-fix-btn');
        if (!btn) return;
        let note = document.getElementById('wixcta-fixall');
        if (state.backlog > remaining() && state.backlog > 0) {
            if (!note) {
                note = document.createElement('span');
                note.id = 'wixcta-fixall';
                note.className = 'wixcta-note';
                note.style.color = '#FCD34D';
                btn.parentNode.insertBefore(note, btn.nextSibling);
            }
            note.textContent = state.backlog + ' mục đang trừ điểm · với hạn mức miễn phí cần khoảng '
                + daysLeft() + ' ngày. Nâng gói để đưa điểm về 100 ngay hôm nay.';
        } else if (note) { note.remove(); }
    }

    /* ── A2: dòng phụ trong thanh chọn hàng loạt ─────────── */
    function renderBulkNote() {
        const bar = document.getElementById('bulk-action-bar');
        if (!bar) return;
        const n = selectedCount();
        let note = document.getElementById('wixcta-bulknote');
        if (n > remaining()) {
            if (!note) {
                note = document.createElement('div');
                note.id = 'wixcta-bulknote';
                note.className = 'wixcta-bulknote';
                bar.appendChild(note);
            }
            note.innerHTML = n + ' tệp đã chọn · vượt ' + (n - remaining())
                + ' tệp so với hạn mức hôm nay. <a id="wixcta-bulkup">Nâng gói để xử lý hết trong một lần</a>';
            const link = document.getElementById('wixcta-bulkup');
            if (link) link.onclick = () => { window.location.hash = '#/upgrade'; };
        } else if (note) { note.remove(); }
    }

    /* ── A1: modal xác nhận khi lô vượt hạn mức ──────────── */
    // Thanh liền theo phần trăm, không phụ thuộc hạn mức là 25 hay 100 hay 500
    function meterHtml() {
        const pct  = Math.min(100, Math.round(state.used / DAILY * 100));
        const full = state.used >= DAILY;
        return '<div class="wixcta-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '">'
             + '<span class="wixcta-bar__fill' + (full ? ' is-full' : '') + '" style="width:' + pct + '%"></span>'
             + '</div>'
             + '<div class="wixcta-barlabel"><span>Hạn mức hôm nay</span>'
             + '<b>' + state.used + '/' + DAILY + ' tệp · ' + pct + '%</b></div>';
    }

    function closeOverlay() {
        const ov = document.getElementById('wixcta-ov');
        if (ov) ov.remove();
    }

    function overlay(html) {
        closeOverlay();
        const ov = document.createElement('div');
        ov.id = 'wixcta-ov';
        ov.className = 'wixcta-ov';
        ov.innerHTML = '<div class="wixcta-modal" role="dialog" aria-modal="true">' + html + '</div>';
        ov.addEventListener('click', e => { if (e.target === ov) closeOverlay(); });
        document.body.appendChild(ov);
        return ov;
    }

    function openConfirm(count, label) {
        const willDo = Math.min(count, remaining());
        const left   = Math.max(0, count - willDo);
        const body = left > 0
            ? 'Bạn đã chọn <b>' + count + '</b> tệp. Hạn mức hôm nay còn <b>' + remaining()
              + '</b> lượt, <b>' + left + '</b> tệp còn lại sẽ chờ tới 00:00. '
              + 'Mọi thao tác đều hoàn tác được trong 30 ngày, Wistorix không xoá vĩnh viễn.'
            : 'Bạn đã chọn <b>' + count + '</b> tệp, vẫn nằm trong hạn mức hôm nay. '
              + 'Mọi thao tác đều hoàn tác được trong 30 ngày, Wistorix không xoá vĩnh viễn.';

        const ov = overlay(
            '<div class="wixcta-tag">A1 · modal xác nhận</div>'
            + '<h3>' + (left > 0 ? 'Xử lý ' + willDo + ' tệp trong hôm nay?' : 'Xử lý ' + willDo + ' tệp?') + '</h3>'
            + meterHtml()
            + '<p>' + body + '</p>'
            + '<div class="wixcta-row">'
            + '<button class="wixcta-btn" id="wixcta-go">Xử lý ' + willDo + ' tệp ngay</button>'
            + (left > 0 ? '<button class="wixcta-btn wixcta-btn--ghost" id="wixcta-up">Nâng gói, xong cả ' + count + ' tệp</button>' : '<button class="wixcta-btn wixcta-btn--ghost" id="wixcta-cancel">Huỷ</button>')
            + '</div>'
            + (left > 0 ? '<p class="wixcta-foot">59.000đ/tháng · huỷ bất cứ lúc nào</p>' : '')
        );

        ov.querySelector('#wixcta-go').onclick = () => {
            closeOverlay();
            applyProcessed(willDo, label);
        };
        const up = ov.querySelector('#wixcta-up');
        if (up) up.onclick = () => { closeOverlay(); window.location.hash = '#/upgrade'; };
        const cancel = ov.querySelector('#wixcta-cancel');
        if (cancel) cancel.onclick = closeOverlay;
    }

    function applyProcessed(n, label) {
        state.used += n;
        state.backlog = Math.max(0, state.backlog - n);
        state.processedTotal += n;
        save();
        renderAll();
        toast('Đã xử lý ' + n + ' tệp' + (label ? ' · ' + label : '') + ' (mô phỏng, không đụng dữ liệu)');
        if (remaining() === 0 && state.backlog > 0) setTimeout(openDayEnd, 900);
    }

    function toast(msg) {
        if (window.Toast && typeof window.Toast.success === 'function') { window.Toast.success(msg); return; }
        const n = document.createElement('div');
        n.className = 'wixcta-osnotif';
        n.innerHTML = '<div class="wixcta-osnotif__b">' + msg + '</div>';
        document.body.appendChild(n);
        setTimeout(() => n.remove(), 3200);
    }

    /* ── C1 và C2: popup cuối ngày ───────────────────────── */
    function openDayEnd() {
        // Mời mua chỉ có nghĩa khi phần việc còn lại đủ lớn. Còn 1 ngày thì mua
        // cũng không tiết kiệm được bao nhiêu, nên quay về thông điệp chốt ngày.
        const sellHard = (state.day >= 5 || daysLeft() >= 5) && daysLeft() >= 2;
        if (sellHard) return openC2();

        const softLine = state.day >= 3
            ? '<div class="wixcta-up">Với nhịp này, còn khoảng <b>' + daysLeft()
              + '</b> ngày nữa là Drive sạch. <a id="wixcta-c1up">Nâng gói để xong ngay hôm nay</a></div>'
            : '';

        const ov = overlay(
            '<div class="wixcta-tag">C1 · chốt ngày' + (state.day >= 3 ? ' + mời nhẹ' : ' · không bán') + '</div>'
            + '<h3>Đã xử lý xong 25 tệp hôm nay</h3>'
            + meterHtml()
            + '<p>Còn <b>' + state.backlog + '</b> tệp trong danh sách, hạn mức làm mới lúc 00:00. '
            + 'Các tệp vừa xử lý vẫn khôi phục được trong 30 ngày.</p>'
            + '<div class="wixcta-row">'
            + (state.remind
                ? '<button class="wixcta-btn wixcta-btn--ghost" id="wixcta-close">Đóng</button>'
                : '<button class="wixcta-btn" id="wixcta-remind">Nhắc tôi vào sáng mai</button>'
                  + '<button class="wixcta-btn wixcta-btn--ghost" id="wixcta-close">Đóng</button>')
            + '</div>'
            + softLine
        );
        const r = ov.querySelector('#wixcta-remind');
        if (r) r.onclick = () => {
            state.remind = true; save(); closeOverlay();
            toast('Đã bật nhắc mỗi sáng. Bấm "Sang ngày mới" trên bảng demo để xem thông báo.');
            renderPanel();
        };
        ov.querySelector('#wixcta-close').onclick = closeOverlay;
        const up = ov.querySelector('#wixcta-c1up');
        if (up) up.onclick = () => { closeOverlay(); window.location.hash = '#/upgrade'; };
    }

    function openC2() {
        const ov = overlay(
            '<div class="wixcta-tag">C2 · lời mời mua chính</div>'
            + '<h3>' + state.day + ' ngày liên tiếp bạn dùng hết hạn mức</h3>'
            + meterHtml()
            + '<p>Wistorix đã xử lý <b>' + state.processedTotal + '</b> tệp cho bạn, còn <b>' + state.backlog
            + '</b> tệp nữa, tức khoảng <b>' + daysLeft() + '</b> ngày. '
            + 'Gói tháng bỏ giới hạn số tệp mỗi ngày, bạn xử lý hết trong một buổi thay vì chia ra nhiều hôm.</p>'
            + '<div class="wixcta-row">'
            + '<button class="wixcta-btn" id="wixcta-buy">Nâng gói · 59.000đ/tháng</button>'
            + '<button class="wixcta-btn wixcta-btn--ghost" id="wixcta-close">Tôi cứ làm dần mỗi ngày</button>'
            + '</div>'
            + '<p class="wixcta-foot">429.000đ/năm nếu trả theo năm · tiết kiệm khoảng 40%</p>'
        );
        ov.querySelector('#wixcta-buy').onclick = () => { closeOverlay(); window.location.hash = '#/upgrade'; };
        ov.querySelector('#wixcta-close').onclick = closeOverlay;
    }

    /* ── E1: thông báo mỗi sáng ──────────────────────────── */
    function showMorningNotice() {
        const old = document.querySelector('.wixcta-osnotif');
        if (old) old.remove();
        const n = document.createElement('div');
        n.className = 'wixcta-osnotif';
        n.innerHTML = '<div class="wixcta-osnotif__src">E1 · thông báo hệ thống · Wistorix</div>'
            + '<div class="wixcta-osnotif__t">Hạn mức hôm nay đã sẵn sàng</div>'
            + '<div class="wixcta-osnotif__b">Còn ' + state.backlog + ' tệp cần xử lý, khoảng '
            + daysLeft() + ' ngày nữa là xong. Mở Wistorix để làm 25 tệp hôm nay.</div>';
        document.body.appendChild(n);
        setTimeout(() => n.remove(), 6000);
    }

    /* ── Chặn hành động thật, chuyển sang modal demo ─────── */
    function bindIntercepts() {
        document.addEventListener('click', (e) => {
            if (!state.on) return;

            const bulk = e.target.closest('#bulk-btn-delete, #bulk-btn-revoke, #bulk-btn-transfer, #bulk-btn-request-ownership');
            if (bulk) {
                e.preventDefault(); e.stopImmediatePropagation();
                const n = selectedCount();
                if (!n) { toast('Chọn vài tệp trong bảng trước đã, hoặc bấm "Chọn nhanh 46 tệp" trên bảng demo.'); return; }
                openConfirm(n, bulk.textContent.trim());
                return;
            }

            const risk = e.target.closest('.risk-action-btn');
            if (risk) {
                e.preventDefault(); e.stopImmediatePropagation();
                const card = risk.closest('.issue-card');
                const valueEl = card && card.querySelector('.issue-card-value, [class*="issue-card-value"]');
                const n = valueEl ? parseInt(String(valueEl.textContent).replace(/\D/g, ''), 10) || 0 : 0;
                openConfirm(Math.max(n, 1), risk.textContent.trim());
                return;
            }

            const fixAll = e.target.closest('#deductions-fix-btn');
            if (fixAll) {
                e.preventDefault(); e.stopImmediatePropagation();
                openConfirm(Math.max(state.backlog, 1), 'xử lý hết');
            }
        }, true);
    }

    /* ── Bảng điều khiển demo ────────────────────────────── */
    function renderPanel() {
        let p = document.getElementById('wixcta-panel');
        if (!p) {
            p = document.createElement('div');
            p.id = 'wixcta-panel';
            p.className = 'wixcta-panel';
            p.dataset.min = 'false';
            document.body.appendChild(p);
        }
        p.innerHTML =
            '<div class="wixcta-panel__head">'
            + '<div class="wixcta-panel__title">Demo CTA <span>· mô phỏng</span></div>'
            + '<button id="wixcta-min" style="background:transparent;padding:2px 6px;font-size:13px;">'
            + (p.dataset.min === 'true' ? '▲' : '▼') + '</button>'
            + '</div>'
            + '<div class="wixcta-panel__body">'
            + '<div class="wixcta-panel__day">'
            + '<button id="wixcta-dayminus">−</button><b>Ngày ' + state.day + '</b><button id="wixcta-dayplus">+</button>'
            + '<span style="margin-left:auto;opacity:.6;">' + (state.remind ? 'đã bật nhắc' : 'chưa bật nhắc') + '</span>'
            + '</div>'
            + '<div class="wixcta-panel__stat">Hôm nay đã dùng <b>' + state.used + '/' + DAILY + '</b> tệp'
            + '<br>Việc tồn đọng <b>' + state.backlog + '</b> · còn <b>' + daysLeft() + '</b> ngày</div>'
            + '<div class="wixcta-panel__grid" style="align-items:center;">'
            + '<span style="opacity:.6;">Tồn đọng</span><input type="number" id="wixcta-backlog" min="0" max="9999" value="' + state.backlog + '">'
            + '</div>'
            + '<div class="wixcta-panel__grid">'
            + '<button id="wixcta-pick">Chọn nhanh 46 tệp</button>'
            + '<button id="wixcta-burn">Dùng hết lượt</button>'
            + '</div>'
            + '<div class="wixcta-panel__grid">'
            + '<button class="pri" id="wixcta-next">Sang ngày mới</button>'
            + '<button id="wixcta-reset">Đặt lại</button>'
            + '<button id="wixcta-off">Tắt demo</button>'
            + '</div>'
            + '<div class="wixcta-panel__hint">Ngày 1 và 2 không mời mua · ngày 3 và 4 mời nhẹ · từ ngày 5 popup C2. '
            + 'Bản demo bỏ luật một popup mỗi phiên để xem lại nhiều lần.</div>'
            + '</div>';

        p.querySelector('#wixcta-min').onclick = () => {
            p.dataset.min = p.dataset.min === 'true' ? 'false' : 'true';
            renderPanel();
        };
        p.querySelector('#wixcta-dayminus').onclick = () => { state.day = Math.max(1, state.day - 1); save(); renderAll(); };
        p.querySelector('#wixcta-dayplus').onclick  = () => { state.day += 1; save(); renderAll(); };
        p.querySelector('#wixcta-backlog').onchange = (e) => {
            state.backlog = Math.max(0, parseInt(e.target.value, 10) || 0); save(); renderAll();
        };
        p.querySelector('#wixcta-pick').onclick = () => pickFiles(46);
        p.querySelector('#wixcta-burn').onclick = () => {
            const n = remaining();
            if (!n) { toast('Hôm nay đã hết lượt rồi. Bấm "Sang ngày mới".'); return; }
            applyProcessed(Math.min(n, state.backlog || n), '');
        };
        p.querySelector('#wixcta-next').onclick = () => {
            state.day += 1; state.used = 0; save();
            renderAll();
            if (state.remind) showMorningNotice();
            const g = document.getElementById('wixcta-greet');
            if (g) { g.style.transition = 'none'; g.style.background = '#DBEAFE'; setTimeout(() => { g.style.transition = 'background .6s'; g.style.background = ''; }, 60); }
        };
        p.querySelector('#wixcta-reset').onclick = () => {
            Object.assign(state, DEFAULTS); save(); renderAll(); toast('Đã đặt lại demo về ngày 1');
        };
        p.querySelector('#wixcta-off').onclick = () => {
            state.on = false; save();
            ['wixcta-greet', 'wixcta-fixall', 'wixcta-bulknote', 'wixcta-panel'].forEach(id => {
                const el = document.getElementById(id); if (el) el.remove();
            });
            document.querySelectorAll('.wixcta-note').forEach(n => n.remove());
            closeOverlay();
            document.title = document.title.replace(/^\(\d+\)\s*/, '');
            toast('Đã tắt demo CTA. Tải lại trang để bật lại.');
        };
    }

    function pickFiles(n) {
        const ui = window.UIController;
        const pool = (ui && (ui._pagination?.totalFiles || ui.allScannedFiles)) || [];
        if (!ui || !pool.length) {
            toast('Mở tab "Phân tích chi tiết" để có danh sách tệp, rồi bấm lại.');
            return;
        }
        // Bảng có phân trang nên tick checkbox hiển thị là không đủ.
        // Chọn thẳng trên tập dữ liệu của UIController rồi đồng bộ lại giao diện.
        ui._selectedFileIds.clear();
        pool.slice(0, n).forEach(f => ui._selectedFileIds.add(f.id));
        document.querySelectorAll('#issues-tbody .row-chk').forEach(b => {
            b.checked = ui._selectedFileIds.has(b.dataset.fileId);
        });
        if (window.BulkActionBar && typeof window.BulkActionBar.update === 'function') window.BulkActionBar.update();
        const bar = document.getElementById('bulk-action-bar');
        if (bar) {
            bar.classList.add('bulk-bar--visible', 'is-visible', 'show', 'active');
            if (getComputedStyle(bar).display === 'none') bar.style.display = 'flex';
        }
        const label = bar && bar.querySelector('#bulk-count');
        if (label) label.textContent = ui._selectedFileIds.size + ' file đã chọn';
        toast('Đã chọn ' + ui._selectedFileIds.size + ' tệp. Bấm một nút hành động trên thanh dưới cùng để xem A1.');
        setTimeout(renderBulkNote, 120);
    }

    /* ── Vòng render ─────────────────────────────────────── */
    function renderAll() {
        if (!state.on) return;
        injectCss();
        renderGreeting();
        renderSidebarQuota();
        renderUpgradeCard();
        renderRiskNotes();
        renderFixAllNote();
        renderBulkNote();
        renderTitleBadge();
        renderPanel();
    }

    function start() {
        if (!state.on) return;
        injectCss();
        bindIntercepts();
        renderAll();
        // App tự render lại sidebar và bảng, nên áp lại định kỳ
        setInterval(() => { if (state.on) { renderSidebarQuota(); renderUpgradeCard(); renderRiskNotes(); renderFixAllNote(); renderBulkNote(); renderTitleBadge(); renderGreeting(); } }, 900);
        console.info('[cta-demo] Demo CTA đang bật. Bảng điều khiển ở góc dưới bên trái.');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
