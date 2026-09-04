/* ================================================================
   WISTORIX · HƯỚNG DẪN BẢN CẬP NHẬT HẠN MỨC NGÀY
   Popup "có gì mới" + tour 4 bước trỏ vào đúng phần tử thật.
   Chạy một lần cho mỗi phiên bản, lưu ở localStorage.
   ================================================================ */
(function () {
    'use strict';
    if (!window.WistorixMock) return;

    const KEY = '__wistorix_tour__';
    const VERSION = 'han-muc-ngay-v1';

    const seen = () => { try { return localStorage.getItem(KEY) === VERSION; } catch (_) { return false; } };
    const markSeen = () => { try { localStorage.setItem(KEY, VERSION); } catch (_) {} };

    /* Bốn bước, mỗi bước trỏ vào một phần tử có thật trên màn hình.
       fallback: nếu không tìm thấy phần tử thì hiện giữa màn hình. */
    const STEPS = [
        {
            sel: '#wixq',
            title: 'Hạn mức nằm ở đây',
            body: 'Mỗi ngày bạn dọn được 25 tệp. Con số này là đã dùng bao nhiêu.',
            place: 'bottom',
        },
        {
            sel: '#wixq',
            title: 'Bấm vào xem chi tiết',
            body: 'Còn bao nhiêu tệp phải xử lý, và mấy giờ hạn mức hoàn lại.',
            place: 'bottom',
            before: () => { if (!document.getElementById('wixq-pop')) document.getElementById('wixq')?.click(); },
            after:  () => { document.getElementById('wixq-pop')?.remove(); },
            anchor: '#wixq-pop',
        },
        {
            sel: '.risk-action-btn',
            title: 'Chọn quá hạn mức vẫn bấm được',
            body: 'Wistorix làm 25 tệp trước, phần còn lại chờ hạn mức hoàn lại. Không khoá nút nào.',
            place: 'top',
        },
        {
            sel: 'a[data-route="/upgrade"]',
            title: 'Cần xong trong hôm nay?',
            body: 'Gói tháng bỏ giới hạn số tệp mỗi ngày.',
            place: 'right',
        },
    ];

    /* ── CSS ─────────────────────────────────────────────── */
    function css() {
        if (document.getElementById('wixtour-style')) return;
        const s = document.createElement('style');
        s.id = 'wixtour-style';
        s.textContent = `
        .wixtour-mask{position:fixed;inset:0;z-index:2147483400;background:rgba(9,16,27,.6);
            backdrop-filter:blur(1.5px);animation:wixtourIn .2s ease}
        @keyframes wixtourIn{from{opacity:0}to{opacity:1}}
        .wixtour-hole{position:fixed;z-index:2147483401;border-radius:10px;pointer-events:none;
            box-shadow:0 0 0 9999px rgba(9,16,27,.6), 0 0 0 3px #2563EB;
            transition:top .25s ease,left .25s ease,width .25s ease,height .25s ease}
        .wixtour-tip{position:fixed;z-index:2147483402;width:296px;background:#fff;border-radius:12px;
            padding:17px 18px 16px;box-shadow:0 22px 50px -20px rgba(9,16,27,.6);
            font-family:Manrope,system-ui,sans-serif;color:#0F172A;animation:wixtourIn .2s ease}
        .wixtour-tip__step{font:700 10.5px Manrope,system-ui,sans-serif;letter-spacing:.1em;
            text-transform:uppercase;color:#2563EB;margin-bottom:6px}
        .wixtour-tip__t{font-size:16px;font-weight:800;margin:0 0 5px;line-height:1.3}
        .wixtour-tip__b{margin:0;font-size:13.5px;line-height:1.55;color:#475569}
        .wixtour-tip__foot{display:flex;align-items:center;gap:10px;margin-top:15px}
        .wixtour-dots{display:flex;gap:5px;margin-right:auto}
        .wixtour-dots i{width:6px;height:6px;border-radius:50%;background:#CBD5E1;display:block}
        .wixtour-dots i.on{background:#2563EB;width:16px;border-radius:99px}
        .wixtour-btn{border:0;border-radius:8px;padding:8px 14px;cursor:pointer;
            font:800 12.5px Manrope,system-ui,sans-serif;background:#2563EB;color:#fff}
        .wixtour-btn:hover{background:#1D4ED8}
        .wixtour-btn--ghost{background:transparent;color:#64748B;padding:8px 6px;font-weight:700}
        .wixtour-btn--ghost:hover{color:#0F172A}

        .wixtour-new{position:fixed;inset:0;z-index:2147483450;display:flex;align-items:center;
            justify-content:center;padding:24px;background:rgba(9,16,27,.6);backdrop-filter:blur(2px)}
        .wixtour-new__card{background:#fff;border-radius:16px;max-width:432px;width:100%;
            padding:28px 30px 26px;box-shadow:0 26px 64px -24px rgba(9,16,27,.6);
            font-family:Manrope,system-ui,sans-serif;color:#0F172A;animation:wixtourIn .22s ease}
        .wixtour-new__tag{display:inline-block;font:700 10.5px Manrope,system-ui,sans-serif;
            letter-spacing:.1em;text-transform:uppercase;color:#2563EB;background:#DBEAFE;
            padding:4px 9px;border-radius:5px;margin-bottom:13px}
        .wixtour-new__card h3{margin:0 0 16px;font-size:22px;font-weight:800;line-height:1.2}
        .wixtour-new__list{display:flex;flex-direction:column;gap:13px;margin:0 0 20px}
        .wixtour-new__item{display:flex;gap:11px;align-items:flex-start}
        .wixtour-new__n{flex-shrink:0;width:21px;height:21px;border-radius:6px;background:#EEF4FF;
            color:#2563EB;font:800 11px Manrope,system-ui,sans-serif;display:flex;
            align-items:center;justify-content:center;margin-top:1px}
        .wixtour-new__item b{display:block;font-size:14px;font-weight:700;margin-bottom:1px}
        .wixtour-new__item span{font-size:13px;color:#475569;line-height:1.5}
        .wixtour-new__row{display:flex;align-items:center;gap:10px}
        `;
        document.head.appendChild(s);
    }

    /* ── Popup "có gì mới" ───────────────────────────────── */
    function openWhatsNew() {
        css();
        const ov = document.createElement('div');
        ov.className = 'wixtour-new';
        ov.id = 'wixtour-new';
        ov.innerHTML =
            '<div class="wixtour-new__card">'
          + '<div class="wixtour-new__tag">Bản cập nhật</div>'
          + '<h3>Wistorix đổi sang hạn mức ngày</h3>'
          + '<div class="wixtour-new__list">'
          + '<div class="wixtour-new__item"><span class="wixtour-new__n">1</span><div>'
          + '<b>25 tệp mỗi ngày</b><span>Một bộ đếm chung cho xoá, thu hồi quyền, chuyển chủ sở hữu.</span></div></div>'
          + '<div class="wixtour-new__item"><span class="wixtour-new__n">2</span><div>'
          + '<b>Quét vẫn miễn phí</b><span>Quét, xem, lọc, tải xuống không giới hạn như cũ.</span></div></div>'
          + '<div class="wixtour-new__item"><span class="wixtour-new__n">3</span><div>'
          + '<b>Hoàn lại sau 24 giờ</b><span>Tính từ lúc bạn dùng hết lượt, không phải 00:00.</span></div></div>'
          + '</div>'
          + '<div class="wixtour-new__row">'
          + '<button class="wixtour-btn" id="wixtour-start">Xem nhanh 4 bước</button>'
          + '<button class="wixtour-btn wixtour-btn--ghost" id="wixtour-skip">Để sau</button>'
          + '</div>'
          + '</div>';
        document.body.appendChild(ov);
        ov.querySelector('#wixtour-start').onclick = () => { ov.remove(); startTour(); };
        ov.querySelector('#wixtour-skip').onclick  = () => { ov.remove(); markSeen(); };
    }

    /* ── Tour ────────────────────────────────────────────── */
    let idx = 0, mask, hole, tip;

    function endTour() {
        const st = STEPS[idx];
        if (st && st.after) { try { st.after(); } catch (_) {} }
        [mask, hole, tip].forEach(el => el && el.remove());
        mask = hole = tip = null;
        window.removeEventListener('resize', place);
        window.removeEventListener('scroll', place, true);
        document.removeEventListener('keydown', onKey, true);
        markSeen();
    }
    function onKey(e) { if (e.key === 'Escape') endTour(); }

    function startTour() {
        css();
        idx = 0;
        mask = document.createElement('div'); mask.className = 'wixtour-mask';
        hole = document.createElement('div'); hole.className = 'wixtour-hole';
        tip  = document.createElement('div'); tip.className  = 'wixtour-tip';
        document.body.append(mask, hole, tip);
        mask.addEventListener('click', endTour);
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        document.addEventListener('keydown', onKey, true);
        show();
    }

    function show() {
        const st = STEPS[idx];
        if (st.before) { try { st.before(); } catch (_) {} }
        tip.innerHTML =
            '<div class="wixtour-tip__step">Bước ' + (idx + 1) + '/' + STEPS.length + '</div>'
          + '<h4 class="wixtour-tip__t">' + st.title + '</h4>'
          + '<p class="wixtour-tip__b">' + st.body + '</p>'
          + '<div class="wixtour-tip__foot">'
          + '<div class="wixtour-dots">'
          + STEPS.map((_, i) => '<i class="' + (i === idx ? 'on' : '') + '"></i>').join('')
          + '</div>'
          + '<button class="wixtour-btn wixtour-btn--ghost" id="wixtour-end">Bỏ qua</button>'
          + '<button class="wixtour-btn" id="wixtour-next">'
          + (idx === STEPS.length - 1 ? 'Xong' : 'Tiếp') + '</button>'
          + '</div>';
        tip.querySelector('#wixtour-end').onclick  = endTour;
        tip.querySelector('#wixtour-next').onclick = () => {
            if (st.after) { try { st.after(); } catch (_) {} }
            if (idx === STEPS.length - 1) { endTour(); return; }
            idx++; show();
        };
        setTimeout(place, 30);
    }

    function place() {
        if (!tip) return;
        const st = STEPS[idx];
        const el = document.querySelector(st.anchor || st.sel);
        if (!el) {                                   // không thấy phần tử thì đặt giữa màn hình
            hole.style.cssText = 'display:none';
            tip.style.left = (window.innerWidth / 2 - 148) + 'px';
            tip.style.top  = (window.innerHeight / 2 - 90) + 'px';
            return;
        }
        el.scrollIntoView({ block: 'center', behavior: 'auto' });
        const r = el.getBoundingClientRect();
        const pad = 6;
        hole.style.display = 'block';
        hole.style.top    = (r.top - pad) + 'px';
        hole.style.left   = (r.left - pad) + 'px';
        hole.style.width  = (r.width + pad * 2) + 'px';
        hole.style.height = (r.height + pad * 2) + 'px';

        const th = tip.offsetHeight || 170, tw = 296, gap = 14;
        let top, left;
        if (st.place === 'top')        { top = r.top - th - gap;  left = r.left; }
        else if (st.place === 'right') { top = r.top;             left = r.right + gap; }
        else                           { top = r.bottom + gap;    left = r.left; }
        top  = Math.max(12, Math.min(top,  window.innerHeight - th - 12));
        left = Math.max(12, Math.min(left, window.innerWidth  - tw - 12));
        tip.style.top  = top + 'px';
        tip.style.left = left + 'px';
    }

    /* ── Khởi động ───────────────────────────────────────── */
    function boot() {
        if (seen()) return;
        const wait = setInterval(() => {
            if (document.getElementById('wixq')) { clearInterval(wait); setTimeout(openWhatsNew, 500); }
        }, 400);
        setTimeout(() => clearInterval(wait), 15000);
    }

    window.WistorixTour = { open: openWhatsNew, start: startTour, reset: () => { try { localStorage.removeItem(KEY); } catch (_) {} } };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
