/* ================================================================
   WISTORIX CLONE · DEMO CTA THEO MÔ HÌNH 25 TỆP MỖI THÁNG
   Lớp phủ độc lập, không sửa file gốc của extension.
   Tắt bằng cách xoá dòng <script src="__mock/cta-demo.js"> trong
   dashboard.html, hoặc bấm "Tắt demo" trên bảng điều khiển.
   ================================================================ */
(function () {
    'use strict';
    if (!window.WistorixMock) return;   // chỉ chạy trên bản clone offline

    const LS_KEY = '__wistorix_cta_demo__';
    const LIMIT  = 25;          // 25 tệp mỗi THÁNG cho gói miễn phí

    const DEFAULTS = { on: true, month: 1, used: 0, backlog: 88, remind: false, processedTotal: 0, exhaustedAt: null, plan: 'free' };

    function load() {
        try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(LS_KEY)) || {}); }
        catch (_) { return Object.assign({}, DEFAULTS); }
    }
    function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (_) {} }

    const state = load();
    // Trạng thái tắt không được lưu qua các lần tải trang, tránh demo im lặng mãi mãi
    if (state.on === false) { state.on = true; save(); }

    const PLANS = { free: 'Miễn phí', one: 'ONE-WISTORIX', multi: 'MULTI-WISTORIX' };
    const isPaid = () => state.plan !== 'free';
    const remaining  = () => (isPaid() ? Infinity : Math.max(0, LIMIT - state.used));

    /* Hạn mức theo THÁNG: 25 tệp, làm mới vào ngày 1 của tháng kế tiếp. */
    const pad = n => (n < 10 ? '0' : '') + n;
    function resetAt() {
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    }
    function resetClock() {
        const d = new Date(resetAt());
        return pad(d.getDate()) + '/' + pad(d.getMonth() + 1);
    }
    function resetText() { return 'hạn mức làm mới ngày ' + resetClock(); }
    function markUsage() {                 // gọi ngay sau mỗi lần trừ hạn mức
        if (remaining() === 0 && !state.exhaustedAt) state.exhaustedAt = Date.now();
    }
    function tickReset() { /* trong bản demo, chuyển tháng bằng nút trên bảng điều khiển */ }
    const selectedCount = () => (window.UIController && window.UIController._selectedFileIds)
        ? window.UIController._selectedFileIds.size : 0;

    /* ── CSS ────────────────────────────────────────────── */
    function injectCss() {
        if (document.getElementById('wixcta-style')) return;
        const s = document.createElement('style');
        s.id = 'wixcta-style';
        s.textContent = `
        .wixcta-note{display:block;margin-top:8px;font:600 11.5px/1.4 Manrope,system-ui,sans-serif;color:#A2560A}
        .wixcta-note--muted{color:#64748B;font-weight:500}

        /* chip hạn mức trên thanh trên cùng */
        .wixq{display:inline-flex;align-items:center;gap:8px;border:1px solid #DBE2EC;background:#fff;
            border-radius:99px;padding:7px 14px 7px 9px;cursor:pointer;
            font:700 13px Manrope,system-ui,sans-serif;color:#0F172A;transition:border-color .15s,background .15s}
        .wixq:hover{border-color:#94A3B8}
        .wixq__ring{width:17px;height:17px;border-radius:50%;flex-shrink:0;position:relative;
            background:conic-gradient(#2563EB calc(var(--p,0)*1%), #E2E8F0 0)}
        .wixq__ring::after{content:'';position:absolute;inset:4px;border-radius:50%;background:#fff}
        .wixq__n{font-variant-numeric:tabular-nums}
        .wixq.is-full{border-color:#FCD34D;background:#FFFBEB;color:#92400E}
        .wixq.is-pro{border-color:#BFDBFE;background:#EFF6FF;color:#1D4ED8}
        .wixq__ring.is-pro{background:#2563EB}
        .wixq.is-pro .wixq__ring::after{background:#EFF6FF}
        .wixq-pop__cta--ghost{background:#F1F5F9;color:#334155}
        .wixq-pop__cta--ghost:hover{background:#E2E8F0}
        .wixq.is-full .wixq__ring{background:#F59E0B}
        .wixq.is-full .wixq__ring::after{background:#FFFBEB}

        .wixq-pop{position:fixed;z-index:2147483200;width:300px;background:#fff;border:1px solid #E2E8F0;
            border-radius:12px;box-shadow:0 20px 48px -20px rgba(9,16,27,.55);padding:17px 18px 18px;
            font-family:Manrope,system-ui,sans-serif;color:#0F172A;animation:wixctaIn .16s ease}
        .wixq-pop__l{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#94A3B8;font-weight:700}
        .wixq-pop__n{font-size:27px;font-weight:800;letter-spacing:-.02em;margin-top:3px;font-variant-numeric:tabular-nums}
        .wixq-pop__n span{font-size:14px;font-weight:600;color:#64748B;letter-spacing:0}
        .wixq-pop__bar{height:8px;border-radius:99px;background:#E2E8F0;overflow:hidden;margin:11px 0 8px}
        .wixq-pop__fill{display:block;height:100%;border-radius:99px;background:#2563EB}
        .wixq-pop__fill.is-full{background:#F59E0B}
        .wixq-pop__sub{font-size:12.5px;color:#64748B}
        .wixq-pop__row{margin-top:11px;padding-top:11px;border-top:1px solid #E2E8F0;font-size:13.5px;color:#475569}
        .wixq-pop__row b{color:#0F172A;font-weight:700}
        .wixq-pop__cta{margin-top:13px;width:100%;border:0;border-radius:8px;padding:10px 14px;cursor:pointer;
            background:#2563EB;color:#fff;font:800 13px Manrope,system-ui,sans-serif}
        .wixq-pop__cta:hover{background:#1D4ED8}

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
        .wixcta-price{margin:16px 0 4px;border:1px solid #E2E8F0;border-radius:10px;padding:14px 16px 13px}
        .wixcta-price__top{display:flex;align-items:center;justify-content:space-between;gap:12px}
        .wixcta-price__name{font:800 13px Manrope,system-ui,sans-serif;color:#0F172A}
        .wixcta-price__off{font:800 12px Manrope,system-ui,sans-serif;color:#05684B;
            background:#D9F0E7;padding:3px 9px;border-radius:99px}
        .wixcta-price__nums{display:flex;align-items:baseline;gap:9px;margin-top:8px;
            font-variant-numeric:tabular-nums}
        .wixcta-price__nums s{color:#94A3B8;font-size:14px}
        .wixcta-price__nums b{font-size:26px;font-weight:800;letter-spacing:-.02em;color:#0F172A}
        .wixcta-price__nums span{font-size:13.5px;color:#64748B}
        .wixcta-price__unit{margin-top:3px;font-size:12.5px;color:#94A3B8}
        .wixcta-tag{display:inline-block;font:700 10.5px Manrope,system-ui,sans-serif;letter-spacing:.08em;
            text-transform:uppercase;color:#2563EB;background:#DBEAFE;padding:3px 8px;border-radius:5px;margin-bottom:12px}

        .wixcta-osnotif{position:fixed;top:18px;right:18px;z-index:2147483100;width:340px;background:#fff;
            border-radius:12px;box-shadow:0 18px 44px -18px rgba(9,16,27,.55);padding:14px 16px;
            font-family:Manrope,system-ui,sans-serif;border:1px solid #E2E8F0;animation:wixctaIn .25s ease}
        @keyframes wixctaIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
        .wixcta-osnotif__src{font-size:11px;color:#94A3B8;display:flex;align-items:center;gap:6px;margin-bottom:6px}
        .wixcta-osnotif__t{font-size:14px;font-weight:800;color:#0F172A;margin-bottom:3px}
        .wixcta-osnotif__b{font-size:13px;color:#475569;line-height:1.5}

        .wixcta-panel{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:270px;
            background:#0B1220;color:#fff;border-radius:14px;padding:13px 15px 15px;
            font:500 12px/1.45 Manrope,system-ui,sans-serif;box-shadow:0 14px 34px -14px rgba(0,0,0,.6)}
        .wixcta-panel[data-min="true"] .wixcta-panel__body{display:none}
        .wixcta-panel__head{display:flex;align-items:center;justify-content:space-between;gap:8px;
            cursor:grab;user-select:none;touch-action:none}
        .wixcta-panel.is-drag,.wixcta-panel.is-drag .wixcta-panel__head{cursor:grabbing}
        .wixcta-panel.is-drag{opacity:.92;box-shadow:0 22px 48px -16px rgba(0,0,0,.75)}
        .wixcta-panel__grip{opacity:.35;font-size:12px;letter-spacing:-1px;margin-right:2px}
        .wixcta-panel__head button{flex-shrink:0}
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

    /* ── B1: thẻ sidebar giờ chỉ là lối vào, con số dồn hết lên chip ── */
    function renderSidebarQuota() {
        const card = document.querySelector('a[data-route="/cleanup"]');
        if (!card) return;
        const title = card.querySelector('.sidebar__card-title');
        const sub   = card.querySelector('.sidebar__card-sub');
        const bar   = card.querySelector('.sidebar__progress-bar');
        const foot  = card.querySelector('.sidebar__card-footnote');
        if (title) title.textContent = 'Hạn mức tháng này';
        if (sub) { sub.textContent = 'Xem lịch sử'; sub.style.color = ''; }
        if (bar && bar.parentNode) bar.parentNode.style.display = 'none';
        if (foot) foot.textContent = '';
    }

    /* ── Q · chip hạn mức, chỗ duy nhất hiện con số ─────── */
    function quotaPct() { return Math.min(100, Math.round(state.used / LIMIT * 100)); }

    function renderQuotaChip() {
        const host = document.querySelector('.dash-header__actions')
                  || document.querySelector('.dash-header__top');
        if (!host) return;
        let chip = document.getElementById('wixq');
        if (!chip) {
            chip = document.createElement('button');
            chip.type = 'button';
            chip.id = 'wixq';
            chip.className = 'wixq';
            chip.setAttribute('aria-haspopup', 'dialog');
            chip.addEventListener('click', (e) => { e.stopPropagation(); toggleQuotaPanel(); });
        }
        if (chip.parentNode !== host) host.insertBefore(chip, host.firstChild);
        const full = !isPaid() && remaining() === 0;
        chip.classList.toggle('is-full', full);
        chip.classList.toggle('is-pro', isPaid());
        chip.title = isPaid() ? PLANS[state.plan] : 'Hạn mức tháng này';
        chip.innerHTML = isPaid()
            ? '<span class="wixq__ring is-pro"></span><span class="wixq__n">Không giới hạn</span>'
            : '<span class="wixq__ring" style="--p:' + quotaPct() + '"></span>'
              + '<span class="wixq__n">' + state.used + '/' + LIMIT + '</span>';
        if (document.getElementById('wixq-pop')) renderQuotaPanel();
    }

    function closeQuotaPanel() {
        const pop = document.getElementById('wixq-pop');
        if (pop) pop.remove();
        document.removeEventListener('click', _outsideQuota, true);
        document.removeEventListener('keydown', _escQuota, true);
    }
    function _outsideQuota(e) {
        const pop = document.getElementById('wixq-pop');
        if (pop && !pop.contains(e.target) && !e.target.closest('#wixq')) closeQuotaPanel();
    }
    function _escQuota(e) { if (e.key === 'Escape') closeQuotaPanel(); }

    function toggleQuotaPanel() {
        if (document.getElementById('wixq-pop')) { closeQuotaPanel(); return; }
        const pop = document.createElement('div');
        pop.id = 'wixq-pop';
        pop.className = 'wixq-pop';
        pop.setAttribute('role', 'dialog');
        document.body.appendChild(pop);
        renderQuotaPanel();
        document.addEventListener('click', _outsideQuota, true);
        document.addEventListener('keydown', _escQuota, true);
    }

    function renderQuotaPanel() {
        const pop = document.getElementById('wixq-pop');
        const chip = document.getElementById('wixq');
        if (!pop || !chip) return;
        const r = chip.getBoundingClientRect();
        pop.style.top  = (r.bottom + 10) + 'px';
        pop.style.left = Math.max(12, Math.min(r.left, window.innerWidth - 312)) + 'px';
        if (isPaid()) {
            pop.innerHTML =
                '<div class="wixq-pop__l">Gói đang dùng</div>'
              + '<div class="wixq-pop__n" style="font-size:20px">' + PLANS[state.plan] + '</div>'
              + '<div class="wixq-pop__sub" style="margin-top:6px">Dọn dẹp không giới hạn số tệp mỗi ngày</div>'
              + '<div class="wixq-pop__row">Đã dọn <b>' + state.processedTotal + '</b> tệp'
              + (state.backlog > 0 ? ' · còn <b>' + state.backlog + '</b> tệp' : ' · Drive đã sạch') + '</div>'
              + '<button type="button" class="wixq-pop__cta wixq-pop__cta--ghost" id="wixq-up">Quản lý gói</button>';
            pop.querySelector('#wixq-up').onclick = () => { closeQuotaPanel(); window.location.hash = '#/upgrade'; };
            return;
        }
        const full = remaining() === 0;
        const clock = resetClock();
        pop.innerHTML =
            '<div class="wixq-pop__l">Hạn mức tháng này</div>'
          + '<div class="wixq-pop__n">' + state.used + '<span>/' + LIMIT + ' tệp</span></div>'
          + '<div class="wixq-pop__bar"><span class="wixq-pop__fill' + (full ? ' is-full' : '')
          + '" style="width:' + quotaPct() + '%"></span></div>'
          + '<div class="wixq-pop__sub">' + (full
                ? 'Làm mới ngày <b>' + clock + '</b>'
                : 'Làm mới ngày <b>' + clock + '</b>') + '</div>'
          + (state.backlog > 0
                ? '<div class="wixq-pop__row">Còn <b>' + state.backlog + '</b> tệp cần xử lý</div>'
                : '<div class="wixq-pop__row">Drive đã sạch</div>')
          + '<button type="button" class="wixq-pop__cta" id="wixq-up">Nâng gói · 59.000đ/tháng</button>';
        pop.querySelector('#wixq-up').onclick = () => { closeQuotaPanel(); window.location.hash = '#/upgrade'; };
    }

    /* ── Giao diện theo gói đang dùng ────────────────────── */
    function renderPlanUi() {
        const card = document.querySelector('a[data-route="/upgrade"]');
        if (card) {
            const t = card.querySelector('.sidebar__card-title');
            const sub = card.querySelector('.sidebar__card-sub');
            if (isPaid()) {
                if (t) t.textContent = PLANS[state.plan];
                if (sub) sub.textContent = 'Đang hoạt động · không giới hạn';
            } else {
                if (t) t.textContent = 'Nâng cấp Pro';
            }
        }
        const planFree = document.querySelector('.current-plan');
        if (planFree && !isPaid()) {
            const prog = planFree.querySelector('.plan-progress');
            const btn  = planFree.querySelector('.plan-right button, .plan-right .plan-btn');
            if (prog) prog.style.display = '';
            if (btn) btn.style.display = '';
        }
        const plan = document.querySelector('.current-plan');
        if (plan && isPaid()) {
            const h = plan.querySelector('h2');
            const d = plan.querySelector('.plan-desc');
            const r = plan.querySelector('.plan-right small');
            const btn = plan.querySelector('.plan-right button, .plan-right .plan-btn');
            const prog = plan.querySelector('.plan-progress');
            if (h) h.textContent = 'Wistorix ' + PLANS[state.plan];
            if (d) d.textContent = 'Dọn dẹp không giới hạn số tệp mỗi ngày. Quét toàn bộ Drive.';
            if (r) r.textContent = 'Hiệu lực đến 03/10/2026';
            if (btn) btn.style.display = 'none';
            if (prog) prog.style.display = 'none';
        }
        // đang có gói thì không chào bán lượt lẻ nữa
        const daypass = document.querySelector('.daypass');
        if (daypass) daypass.style.display = isPaid() ? 'none' : '';

        // huy hiệu cạnh avatar
        const badge = document.querySelector('.sidebar__profile-badge');
        if (badge) badge.textContent = isPaid() ? PLANS[state.plan] : 'STANDARD';

        // ba thẻ giá: đánh dấu đúng gói đang dùng
        const oneBtn = document.querySelector('.plan-btn[data-plan="one_wistorix_v3"]');
        if (oneBtn) {
            const isCurrent = state.plan === 'one';
            oneBtn.textContent = isCurrent ? 'Gói hiện tại' : 'Nâng cấp';
            oneBtn.disabled = isCurrent;
            oneBtn.style.opacity = isCurrent ? '.55' : '';
            oneBtn.style.cursor  = isCurrent ? 'default' : '';
        }
        const stdBtn = [...document.querySelectorAll('.pricing-card-u .plan-btn')]
            .find(b => !b.dataset.plan && !b.dataset.consultationPlan);
        if (stdBtn) stdBtn.textContent = isPaid() ? 'Gói miễn phí' : 'Gói hiện tại';
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
                note.textContent = n + ' tệp · vượt hạn mức tháng này ' + (n - remaining()) + ' tệp';
            } else if (note) {
                note.remove();
            }
        });
    }

    /* ── A1: modal xác nhận khi lô vượt hạn mức ──────────── */
    // Thanh liền theo phần trăm, không phụ thuộc hạn mức là 25 hay 100 hay 500
    function meterHtml() {
        const pct  = Math.min(100, Math.round(state.used / LIMIT * 100));
        const full = state.used >= LIMIT;
        return '<div class="wixcta-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '">'
             + '<span class="wixcta-bar__fill' + (full ? ' is-full' : '') + '" style="width:' + pct + '%"></span>'
             + '</div>'
             + '<div class="wixcta-barlabel"><span>Hạn mức tháng này</span>'
             + '<b>' + state.used + '/' + LIMIT + ' tệp · ' + pct + '%</b></div>';
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
        if (willDo === 0) {          // đã dùng hết hạn mức của tháng
            const ov0 = overlay(
                '<div class="wixcta-tag">A1 · hết hạn mức</div>'
                + '<h3>Hạn mức tháng này đã dùng hết</h3>'
                + meterHtml()
                + '<p>Bạn đã chọn <b>' + count + '</b> tệp. Hạn mức làm mới ngày <b>'
                + resetClock() + '</b>. Mua một lượt 24 giờ hoặc nâng gói để xử lý ngay.</p>'
                + '<div class="wixcta-row">'
                + '<button class="wixcta-btn" id="wixcta-up0">Nâng gói · 59.000đ/tháng</button>'
                + '<button class="wixcta-btn wixcta-btn--ghost" id="wixcta-pass0">Mua 1 lượt · 40.000đ</button>'
                + '</div>'
                + '<p class="wixcta-foot">Mọi thao tác hoàn tác được trong 30 ngày, Wistorix không xoá vĩnh viễn.</p>'
            );
            ov0.querySelector('#wixcta-up0').onclick = () => { closeOverlay(); window.location.hash = '#/upgrade'; };
            ov0.querySelector('#wixcta-pass0').onclick = () => { closeOverlay(); window.location.hash = '#/upgrade'; };
            return;
        }

        const body = left > 0
            ? 'Bạn đã chọn <b>' + count + '</b> tệp. Hạn mức tháng này còn <b>' + remaining()
              + '</b> lượt. <b>' + left + '</b> tệp còn lại chờ tháng sau, hoặc mua một lượt 24 giờ. '
              + 'Mọi thao tác đều hoàn tác được trong 30 ngày, Wistorix không xoá vĩnh viễn.'
            : 'Bạn đã chọn <b>' + count + '</b> tệp, vẫn nằm trong hạn mức tháng này. '
              + 'Mọi thao tác đều hoàn tác được trong 30 ngày, Wistorix không xoá vĩnh viễn.';

        const ov = overlay(
            '<div class="wixcta-tag">A1 · modal xác nhận</div>'
            + '<h3>Xử lý ' + willDo + ' tệp?</h3>'
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
        markUsage();
        save();
        renderAll();
        toast('Đã xử lý ' + n + ' tệp' + (label ? ' · ' + label : '') + ' (mô phỏng, không đụng dữ liệu)');
        if (!isPaid() && remaining() === 0 && state.backlog > 0) setTimeout(openDayEnd, 900);
    }

    function toast(msg) {
        if (window.Toast && typeof window.Toast.success === 'function') { window.Toast.success(msg); return; }
        const n = document.createElement('div');
        n.className = 'wixcta-osnotif';
        n.innerHTML = '<div class="wixcta-osnotif__b">' + msg + '</div>';
        document.body.appendChild(n);
        setTimeout(() => n.remove(), 3200);
    }

    /* ── A4: thêm Drive thứ hai, mời Multi-Wistorix ──────── */
    function openMultiOffer() {
        const ov = overlay(
            '<div class="wixcta-tag">A4 · thêm Drive thứ hai</div>'
            + '<h3>Thêm Drive thứ hai?</h3>'
            + '<p>Gói hiện tại dùng được <b>1 Drive</b>. Drive mới vẫn quét đầy đủ, '
            + 'nhưng dọn dẹp trên đó cần Multi-Wistorix.</p>'
            + '<div class="wixcta-row">'
            + '<button class="wixcta-btn" id="wixcta-multi">Xem Multi-Wistorix</button>'
            + '<button class="wixcta-btn wixcta-btn--ghost" id="wixcta-adddrive">Vẫn thêm, chỉ để quét</button>'
            + '</div>'
            + '<p class="wixcta-foot">Multi-Wistorix tính theo số Drive kết nối.</p>'
        );
        ov.querySelector('#wixcta-multi').onclick = () => { closeOverlay(); window.location.hash = '#/upgrade'; };
        ov.querySelector('#wixcta-adddrive').onclick = () => {
            closeOverlay();
            toast('Đã thêm Drive ở chế độ chỉ quét (mô phỏng, không kết nối Google thật)');
        };
    }

    /* ── C1 và C2: popup cuối ngày ───────────────────────── */
    function openDayEnd() {
        // Mời mua chỉ có nghĩa khi phần việc còn lại đủ lớn. Còn 1 ngày thì mua
        // cũng không tiết kiệm được bao nhiêu, nên quay về thông điệp chốt ngày.
        // Ngưỡng tính theo khối lượng tệp còn lại, không quy ra số ngày
        // sang tháng thứ hai liên tiếp mà vẫn dùng hết thì mời gói năm
        if (state.month >= 2) return openC2();

        const softLine = '<div class="wixcta-up">Còn <b>' + state.backlog + '</b> tệp cần xử lý. '
            + '<a id="wixcta-c1up">Xem gói không giới hạn</a></div>';

        const ov = overlay(
            '<div class="wixcta-tag">C1 · hết hạn mức tháng</div>'
            + '<h3>Đã dùng hết 25 tệp của tháng này</h3>'
            + meterHtml()
            + '<p>Hạn mức làm mới ngày <b>' + resetClock() + '</b>. Cần làm tiếp ngay thì mua một lượt '
            + '24 giờ không giới hạn, hoặc chuyển sang gói tháng. '
            + 'Các tệp vừa xử lý vẫn khôi phục được trong 30 ngày.</p>'
            + '<div class="wixcta-row">'
            + '<button class="wixcta-btn" id="wixcta-buy1">Mua 1 lượt · 40.000đ</button>'
            + '<button class="wixcta-btn wixcta-btn--ghost" id="wixcta-close">Để tháng sau</button>'
            + '</div>'
            + softLine
        );
        const buy1 = ov.querySelector('#wixcta-buy1');
        if (buy1) buy1.onclick = () => { closeOverlay(); window.location.hash = '#/upgrade'; };
        ov.querySelector('#wixcta-close').onclick = closeOverlay;
        const up = ov.querySelector('#wixcta-c1up');
        if (up) up.onclick = () => { closeOverlay(); window.location.hash = '#/upgrade'; };
    }

    function openC2() {
        const ov = overlay(
            '<div class="wixcta-tag">C2 · lời mời mua chính</div>'
            + '<h3>' + state.month + ' tháng liên tiếp bạn dùng hết hạn mức</h3>'
            + meterHtml()
            + '<p>Còn <b>' + state.backlog + '</b> tệp cần xử lý.</p>'
            + '<div class="wixcta-price">'
            +   '<div class="wixcta-price__top">'
            +     '<span class="wixcta-price__name">Gói năm</span>'
            +     '<span class="wixcta-price__off">−40%</span>'
            +   '</div>'
            +   '<div class="wixcta-price__nums">'
            +     '<s>708.000đ</s><b>429.000đ</b><span>/năm</span>'
            +   '</div>'
            +   '<div class="wixcta-price__unit">35.750đ mỗi tháng</div>'
            + '</div>'
            + '<div class="wixcta-row">'
            + '<button class="wixcta-btn" id="wixcta-buy">Chuyển sang gói năm</button>'
            + '<button class="wixcta-btn wixcta-btn--ghost" id="wixcta-close">Bỏ qua</button>'
            + '</div>'
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
            + '<div class="wixcta-osnotif__t">Hạn mức tháng mới · ' + state.used + '/' + LIMIT + '</div>';
        document.body.appendChild(n);
        setTimeout(() => n.remove(), 6000);
    }

    /* ── Chặn hành động thật, chuyển sang modal demo ─────── */
    function bindIntercepts() {
        document.addEventListener('click', (e) => {
            if (!state.on) return;
            if (isPaid()) {                       // đã có gói thì không chặn gì, trừ lời mời Multi
                if (state.plan === 'one' && e.target.closest('[data-profile-action="add-account"]')) {
                    e.preventDefault(); e.stopImmediatePropagation();
                    openMultiOffer();
                }
                return;
            }

            // Nhóm A4 · thêm Drive thứ hai, chỉ mời Multi chứ không chặn
            if (e.target.closest('[data-profile-action="add-account"]')) {
                e.preventDefault(); e.stopImmediatePropagation();
                openMultiOffer();
                return;
            }

            // Nhóm A · mọi hành động hàng loạt, ở cả ba màn hình
            const bulk = e.target.closest(
                '#bulk-btn-delete, #bulk-btn-revoke, #bulk-btn-transfer, #bulk-btn-request-ownership,'
                + '#mydrive-bulk-btn-revoke, #mydrive-bulk-btn-transfer, #mydrive-bulk-btn-delete,'
                + '.btn-hero-revoke'
            );
            if (bulk) {
                e.preventDefault(); e.stopImmediatePropagation();
                let n = selectedCount();
                if (bulk.id && bulk.id.indexOf('mydrive-') === 0) {
                    // My Drive giữ danh sách chọn riêng, đọc từ nhãn của thanh hành động
                    const label = document.getElementById('mydrive-bulk-count');
                    const m = label ? (label.textContent || '').match(/(\d+)/) : null;
                    n = m ? parseInt(m[1], 10) : document.querySelectorAll('#mydrive-tbody input[type="checkbox"]:checked').length;
                }
                if (bulk.classList.contains('btn-hero-revoke')) {
                    // Thu hồi toàn bộ quyền của một người: số tệp đọc từ khu vực chứa nút
                    const scope = bulk.closest('section, .file-sidebar, div') || document.body;
                    const m = (scope.innerText || '').match(/(\d+)\s*(tệp|file)/i);
                    n = m ? parseInt(m[1], 10) : 0;
                }
                if (!n) { toast('Chọn vài tệp trong bảng trước đã, hoặc bấm "Chọn nhanh 46 tệp" trên bảng demo.'); return; }
                openConfirm(n, bulk.textContent.trim());
                return;
            }

            // Nhóm B · thao tác lẻ trên một tệp: trừ hạn mức im lặng, không nhắc gói
            const single = e.target.closest('.btn-stop-sharing, .btn-delete, .btn-transfer-own, .btn-request-own, .btn-revoke, .file-action-btn--danger');
            if (single) {
                e.preventDefault(); e.stopImmediatePropagation();
                if (remaining() <= 0) {
                    toast('Hết hạn mức tháng này · ' + resetText());
                    return;
                }
                state.used += 1;
                state.backlog = Math.max(0, state.backlog - 1);
                state.processedTotal += 1;
                markUsage();
                save();
                renderAll();
                if (!isPaid() && remaining() === 0 && state.backlog > 0) setTimeout(openDayEnd, 900);
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
            p.dataset.min = localStorage.getItem(MIN_KEY) === '0' ? 'false' : 'true';
            document.body.appendChild(p);
        }
        p.innerHTML =
            '<div class="wixcta-panel__head">'
            + '<div class="wixcta-panel__title"><span class="wixcta-panel__grip">⠿</span> Demo CTA <span>· mô phỏng</span></div>'
            + '<button id="wixcta-home" title="Thả về góc phải dưới" '
            +   'style="background:transparent;padding:2px 5px;font-size:12px;">⤡</button>'
            + '<button id="wixcta-min" style="background:transparent;padding:2px 6px;font-size:13px;">'
            + (p.dataset.min === 'true' ? '▲' : '▼') + '</button>'
            + '</div>'
            + '<div class="wixcta-panel__body">'
            + '<div class="wixcta-panel__day">'
            + '<button id="wixcta-dayminus">−</button><b>Tháng ' + state.month + '</b><button id="wixcta-dayplus">+</button>'
            + '<span style="margin-left:auto;opacity:.6;">' + (state.remind ? 'đã bật nhắc' : 'chưa bật nhắc') + '</span>'
            + '</div>'
            + '<div class="wixcta-panel__stat">Tháng này đã dùng <b>' + state.used + '/' + LIMIT + '</b> tệp'
            + '<br>Việc tồn đọng <b>' + state.backlog + '</b> tệp'
            + '<br>Làm mới ngày <b>' + resetClock() + '</b></div>'
            + '<div class="wixcta-panel__grid" style="align-items:center;">'
            + '<span style="opacity:.6;">Tồn đọng</span><input type="number" id="wixcta-backlog" min="0" max="9999" value="' + state.backlog + '">'
            + '</div>'
            + '<div class="wixcta-panel__grid" style="align-items:center;">'
            + '<span style="opacity:.6;">Gói</span>'
            + ['free', 'one', 'multi'].map(k =>
                '<button data-plan="' + k + '"' + (state.plan === k ? ' class="pri"' : '') + '>'
                + (k === 'free' ? 'Miễn phí' : k === 'one' ? 'One' : 'Multi') + '</button>').join('')
            + '</div>'
            + '<div class="wixcta-panel__grid">'
            + '<button id="wixcta-pick">Chọn nhanh 46 tệp</button>'
            + '<button id="wixcta-burn">Dùng hết lượt</button>'
            + '</div>'
            + '<div class="wixcta-panel__grid">'
            + '<button class="pri" id="wixcta-next">Sang tháng mới</button>'
            + '<button id="wixcta-reset">Đặt lại</button>'
            + '<button id="wixcta-off">Tắt demo</button>'
            + '<button id="wixcta-tour">Xem lại hướng dẫn</button>'
            + '<button id="wixcta-survey">Khảo sát onboarding</button>'
            + '</div>'
            + '<div class="wixcta-panel__hint">Gói miễn phí: 25 tệp mỗi tháng, làm mới ngày 1. '
            + 'C1 hiện khi hết hạn mức tháng · C2 mời gói năm từ tháng thứ 2 liên tiếp. '
            + 'Bản demo bỏ luật một popup mỗi phiên để xem lại nhiều lần.</div>'
            + '</div>';

        bindDrag(p);
        p.querySelector('#wixcta-home').onclick = homePanel;
        p.querySelector('#wixcta-min').onclick = () => {
            p.dataset.min = p.dataset.min === 'true' ? 'false' : 'true';
            try { localStorage.setItem(MIN_KEY, p.dataset.min === 'true' ? '1' : '0'); } catch (_) {}
            renderPanel();
        };
        p.querySelector('#wixcta-dayminus').onclick = () => { state.month = Math.max(1, state.month - 1); save(); renderAll(); };
        p.querySelector('#wixcta-dayplus').onclick  = () => { state.month += 1; save(); renderAll(); };
        p.querySelector('#wixcta-backlog').onchange = (e) => {
            state.backlog = Math.max(0, parseInt(e.target.value, 10) || 0); save(); renderAll();
        };
        p.querySelectorAll('[data-plan]').forEach(b => {
            b.onclick = () => { state.plan = b.dataset.plan; save(); closeQuotaPanel(); renderAll(); };
        });
        p.querySelector('#wixcta-pick').onclick = () => pickFiles(46);
        p.querySelector('#wixcta-burn').onclick = () => {
            const n = remaining();
            if (!n) { toast('Hôm nay đã hết lượt rồi. Bấm "Sang ngày mới".'); return; }
            applyProcessed(Math.min(n, state.backlog || n), '');
        };
        p.querySelector('#wixcta-next').onclick = () => {
            state.month += 1; state.used = 0; state.exhaustedAt = null; save();
            renderAll();
            if (state.remind) showMorningNotice();
        };
        p.querySelector('#wixcta-reset').onclick = () => {
            Object.assign(state, DEFAULTS); save(); renderAll(); toast('Đã đặt lại demo về ngày 1');
        };
        p.querySelector('#wixcta-survey').onclick = () => {
            if (window.WistorixOnboarding) {
                window.WistorixOnboarding.reset();
                toast('Đã xoá câu trả lời. Mở màn hình "Đang quét" trên bảng dữ liệu mẫu để hỏi lại.');
            }
        };
        p.querySelector('#wixcta-tour').onclick = () => {
            if (window.WistorixTour) { window.WistorixTour.reset(); window.WistorixTour.open(); }
        };
        p.querySelector('#wixcta-off').onclick = () => {
            // Chỉ tắt trong phiên này: lưu lại với on = true để tải lại trang là bật lại
            state.on = false;
            try { localStorage.setItem(LS_KEY, JSON.stringify(Object.assign({}, state, { on: true }))); } catch (_) {}
            ['wixq', 'wixq-pop', 'wixcta-panel'].forEach(id => {
                const el = document.getElementById(id); if (el) el.remove();
            });
            document.querySelectorAll('.wixcta-note').forEach(n => n.remove());
            closeOverlay();
            document.title = document.title.replace(/^\(\d+\)\s*/, '');
            toast('Đã tắt demo CTA trong phiên này. Tải lại trang (F5) là bật lại.');
        };
    }

    /* hai bảng demo xếp chồng ở góc phải cho gọn */
    /* ── Bảng demo kéo được, nhớ vị trí ──────────────────── */
    const POS_KEY = '__wistorix_panel_pos__';
    const MIN_KEY = '__wistorix_panel_min__';
    let panelPos = null;
    try { panelPos = JSON.parse(localStorage.getItem(POS_KEY)); } catch (_) {}

    function clampPos(pos, p) {
        const w = p.offsetWidth || 270, h = p.offsetHeight || 120;
        return {
            left: Math.max(8, Math.min(pos.left, innerWidth  - w - 8)),
            top:  Math.max(8, Math.min(pos.top,  innerHeight - h - 8)),
        };
    }

    function applyPos(p) {
        if (!panelPos) return false;
        const c = clampPos(panelPos, p);
        p.style.left = c.left + 'px';
        p.style.top  = c.top + 'px';
        p.style.right = 'auto';
        p.style.bottom = 'auto';
        return true;
    }

    function homePanel() {
        panelPos = null;
        try { localStorage.removeItem(POS_KEY); } catch (_) {}
        const p = document.getElementById('wixcta-panel');
        if (!p) return;
        p.style.left = 'auto'; p.style.top = 'auto'; p.style.right = '16px';
        stackPanel();
    }

    function stackPanel() {
        const p = document.getElementById('wixcta-panel');
        if (!p) return;
        // thanh hành động hàng loạt cũng nằm dưới cùng, đẩy hai bảng demo lên trên nó
        const bulk = document.getElementById('bulk-action-bar');
        const bulkH = (bulk && bulk.classList.contains('is-visible'))
            ? bulk.getBoundingClientRect().height : 0;
        const base = bulkH ? bulkH + 24 : 16;

        const bar = document.getElementById('wixmock-bar');
        if (bar) bar.style.bottom = base + 'px';

        if (applyPos(p)) { reserveBottom(); return; }   // người dùng đã kéo thì giữ nguyên
        const h = bar ? bar.getBoundingClientRect().height : 0;
        p.style.bottom = (h ? base + h + 8 : base) + 'px';
        reserveBottom();
    }

    function bindDrag(p) {
        const head = p.querySelector('.wixcta-panel__head');
        if (!head || head._wixDrag) return;
        head._wixDrag = true;
        head.addEventListener('pointerdown', (ev) => {
            if (ev.target.closest('button')) return;   // nút thu gọn, nút về góc
            ev.preventDefault();
            const r = p.getBoundingClientRect();
            const dx = ev.clientX - r.left, dy = ev.clientY - r.top;
            p.classList.add('is-drag');
            head.setPointerCapture(ev.pointerId);

            const move = (e) => {
                panelPos = clampPos({ left: e.clientX - dx, top: e.clientY - dy }, p);
                p.style.left = panelPos.left + 'px';
                p.style.top  = panelPos.top + 'px';
                p.style.right = 'auto';
                p.style.bottom = 'auto';
            };
            const up = () => {
                p.classList.remove('is-drag');
                head.removeEventListener('pointermove', move);
                head.removeEventListener('pointerup', up);
                try { localStorage.setItem(POS_KEY, JSON.stringify(panelPos)); } catch (_) {}
            };
            head.addEventListener('pointermove', move);
            head.addEventListener('pointerup', up);
        });
    }

    /* Bảng demo nổi ở góc phải dưới cũng che phân trang. Đo phần nó lấn lên
       rồi ghi vào --wix-demo-reserve, CSS của app lấy max với phần của thanh
       hành động hàng loạt. Bản thật không có lớp demo nên biến này luôn 0. */
    function reserveBottom() {
        let intrude = 0;
        ['wixmock-bar', 'wixcta-panel'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const r = el.getBoundingClientRect();     // position:fixed nên không dùng offsetParent
            if (r.height < 2 || getComputedStyle(el).display === 'none') return;
            const anchored = (id === 'wixcta-panel' && !panelPos) || innerHeight - r.bottom <= 40;
            if (!anchored) return;                   // đã kéo đi chỗ khác thì không cần chừa
            if (r.right < innerWidth * 0.45) return;  // chỉ tính phần nằm bên phải
            intrude = Math.max(intrude, innerHeight - r.top);
        });

        // app đã có biến --wix-bulk-reserve cho thanh hành động, đây là phần của lớp demo
        document.documentElement.style.setProperty(
            '--wix-demo-reserve', (intrude ? Math.round(intrude) + 14 : 0) + 'px');
    }

    addEventListener('resize', () => {
        const p = document.getElementById('wixcta-panel');
        if (p) applyPos(p);
        reserveBottom();
    });

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
    }

    /* ── Vòng render ─────────────────────────────────────── */
    function renderAll() {
        if (!state.on) return;
        injectCss();
        renderQuotaChip();
        renderSidebarQuota();
        renderUpgradeCard();
        renderPlanUi();
        renderRiskNotes();
        renderTitleBadge();
        renderPanel();
        stackPanel();
    }

    function start() {
        if (!state.on) return;
        tickReset();
        injectCss();
        bindIntercepts();
        renderAll();
        // App tự render lại sidebar và bảng, nên áp lại định kỳ
        setInterval(() => { if (state.on) { tickReset(); renderSidebarQuota(); renderUpgradeCard(); renderPlanUi(); renderRiskNotes(); renderQuotaChip(); renderTitleBadge(); stackPanel(); } }, 900);
        console.info('[cta-demo] Demo CTA đang bật. Bảng điều khiển ở góc dưới bên trái.');
    }

    // Mở API cho lớp bổ sung __mock/cta-demo-extra.js
    window.WistorixCtaDemo = {
        LIMIT, state, save,
        remaining, resetAt, resetClock, resetText, markUsage, tickReset,
        openConfirm, openDayEnd, openC2, openMultiOffer, showMorningNotice, toggleQuotaPanel,
        overlay, closeOverlay, toast,
        applyProcessed, renderAll, meterHtml
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
