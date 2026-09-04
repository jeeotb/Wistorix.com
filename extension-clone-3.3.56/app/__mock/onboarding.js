/* ================================================================
   WISTORIX · KHẢO SÁT NHU CẦU TRONG LÚC QUÉT
   - Câu hỏi nằm ngay giữa màn hình quét, vẫn thấy dữ liệu đang chạy.
   - Quét xong sớm cũng chưa vào dashboard: giữ lại tới khi trả lời.
   - Người dùng chỉ trả lời MỘT LẦN DUY NHẤT, lần sau không hỏi nữa.
   - KHÔNG bán gì ở đây. Câu trả lời chỉ để hiểu người dùng. Việc mời mua
     nằm trọn trong cây quyết định C1/C2 ở cta-demo.js.
   ================================================================ */
(function () {
    'use strict';
    if (!window.WistorixMock) return;

    const KEY = '__wistorix_onboarding__';
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } };
    const put  = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) {} };
    let A = load();

    const Q = [
        {
            id: 'role', q: 'Bạn dọn Drive cho ai?',
            opts: [
                { v: 'agency',     t: 'Agency',        d: 'Nhiều khách, nhiều Drive' },
                { v: 'inhouse',    t: 'Team in-house', d: 'Một công ty' },
                { v: 'freelancer', t: 'Freelancer',    d: 'Drive cá nhân' },
            ],
        },
        {
            id: 'size', q: 'Bao nhiêu người dùng chung Drive này?',
            opts: [
                { v: 's', t: '0 tới 5' },
                { v: 'm', t: '5 tới 10' },
                { v: 'l', t: 'Trên 10' },
            ],
        },
    ];

    /* ── CSS ─────────────────────────────────────────────── */
    function css() {
        if (document.getElementById('wixob-style')) return;
        const s = document.createElement('style');
        s.id = 'wixob-style';
        s.textContent = `
        /* thẻ khảo sát: nền sáng như card trong app, hoà vào nền tối bằng độ trong */
        .wixob-q{width:100%;max-width:600px;margin:16px auto 0;padding:17px 20px 18px;
            background:rgba(255,255,255,.93);
            -webkit-backdrop-filter:blur(14px) saturate(1.3);backdrop-filter:blur(14px) saturate(1.3);
            border:1px solid rgba(255,255,255,.55);border-radius:14px;
            box-shadow:0 20px 46px -18px rgba(2,8,23,.7);
            font-family:Manrope,system-ui,sans-serif;color:#0F172A;text-align:left;
            animation:wixobIn .3s ease}
        @keyframes wixobIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

        .wixob-q__head{display:flex;align-items:center;gap:10px;margin-bottom:3px}
        .wixob-q__eyebrow{font:800 10px Manrope,system-ui,sans-serif;letter-spacing:.11em;
            text-transform:uppercase;color:#2563EB}
        .wixob-q__nav{margin-left:auto;display:flex;align-items:center;gap:8px}
        .wixob-q__count{font:800 11.5px Manrope,system-ui,sans-serif;color:#475569;
            font-variant-numeric:tabular-nums}
        .wixob-q__dots{display:flex;gap:4px}
        .wixob-q__dots i{width:6px;height:6px;border-radius:50%;background:#CBD5E1;display:block;
            transition:width .18s,background .18s}
        .wixob-q__dots i.done{background:#93B4FF}
        .wixob-q__dots i.on{background:#2563EB;width:16px;border-radius:99px}

        .wixob-q__t{font-size:16px;font-weight:800;margin:0;letter-spacing:-.01em}
        .wixob-q__hint{margin:4px 0 0;font-size:12.5px;color:#64748B}

        .wixob-q__opts{display:flex;flex-wrap:wrap;gap:8px;margin-top:13px}
        .wixob-q__opt{flex:1 1 155px;text-align:left;border:1px solid #E2E8F0;
            background:#fff;border-radius:10px;padding:11px 13px;cursor:pointer;
            font-family:inherit;color:#0F172A;transition:border-color .14s,background .14s,box-shadow .14s}
        .wixob-q__opt:hover{border-color:#2563EB;background:#F5F8FF;
            box-shadow:0 0 0 3px rgba(37,99,235,.1)}
        .wixob-q__opt b{display:block;font-size:13.5px;font-weight:700}
        .wixob-q__opt span{display:block;font-size:11.5px;color:#64748B;margin-top:1px}

        .wixob-q__back{margin-top:12px;border:0;background:transparent;cursor:pointer;padding:0;
            font:700 12px Manrope,system-ui,sans-serif;color:#94A3B8}
        .wixob-q__back:hover{color:#334155}

        .wixob-q__done{margin:0;font-size:14px;color:#334155;line-height:1.55}
        .wixob-q__done b{color:#0F172A;font-weight:700}
        .wixob-q__go{margin-top:14px;width:100%;border:0;border-radius:9px;padding:12px 16px;
            cursor:pointer;background:#2563EB;color:#fff;
            font:800 14px Manrope,system-ui,sans-serif}
        .wixob-q__go:hover{background:#1D4ED8}

        `;
        document.head.appendChild(s);
    }

    /* ── Giữ người dùng ở màn hình quét tới khi trả lời ───── */
    const SHELL = ['view-dashboard', 'view-scan-start', 'view-scan-progress', 'view-scan-result'];
    let armed   = false;    // đã nhìn thấy màn hình quét ít nhất một lần
    let pending = null;     // màn hình mà app muốn nhảy tới trong lúc bị giữ

    const answered = () => Boolean(A.done);
    const vis = (el) => el && getComputedStyle(el).display !== 'none';
    function onShell() {
        const h = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
        return h === '' || h === 'dashboard';
    }

    function guard() {
        if (answered() || !onShell()) return;
        const sp = document.getElementById('view-scan-progress');
        if (!sp) return;
        if (!armed) { if (vis(sp)) armed = true; return; }

        let jumped = false;
        SHELL.forEach(id => {
            if (id === 'view-scan-progress') return;
            const el = document.getElementById(id);
            if (vis(el)) { pending = id; el.style.display = 'none'; jumped = true; }
        });
        if (jumped || !vis(sp)) sp.style.display = 'flex';
    }

    function release() {
        A.done = true; put(A);
        const target = document.getElementById(pending || 'view-dashboard');
        const sp = document.getElementById('view-scan-progress');
        const box = document.getElementById('wixob-q');
        if (box) box.remove();
        if (sp && target && target !== sp) sp.style.display = 'none';
        if (target) target.style.display = 'flex';
    }

    /* ── Khảo sát trong màn hình quét ────────────────────── */
    function step() {
        for (let i = 0; i < Q.length; i++) if (!A[Q[i].id]) return i;
        return Q.length;
    }

    function renderSurvey() {
        if (answered()) { const b = document.getElementById('wixob-q'); if (b) b.remove(); return; }
        const host = document.querySelector('#view-scan-progress .scan-progress__content');
        if (!host) return;
        const anchor = host.querySelector('#scan-file-panel');
        let box = document.getElementById('wixob-q');
        if (!box) {
            box = document.createElement('div');
            box.id = 'wixob-q';
            box.className = 'wixob-q';
            host.insertBefore(box, anchor || null);
        }

        const i = step();
        if (i >= Q.length) {
            box.innerHTML =
                '<div class="wixob-q__head"><span class="wixob-q__eyebrow">Đã xong khảo sát</span>'
              +   '<div class="wixob-q__nav"><span class="wixob-q__count">' + Q.length + ' / ' + Q.length + '</span>'
              +   '<div class="wixob-q__dots">' + Q.map(() => '<i class="done"></i>').join('') + '</div></div></div>'
              + '<p class="wixob-q__done">Cảm ơn bạn. Wistorix ghi lại để <b>hiểu cách bạn dùng Drive</b>. '
              +   'Không có gì phải mua lúc này.</p>'
              + '<button class="wixob-q__go" type="button">Vào dashboard xem</button>';
            box.querySelector('.wixob-q__go').onclick = release;
            return;
        }

        const q = Q[i];
        const eyebrow = pending ? 'Quét xong · còn 1 bước' : 'Trong lúc quét';
        box.innerHTML =
            '<div class="wixob-q__head">'
          +   '<span class="wixob-q__eyebrow">' + eyebrow + '</span>'
          +   '<div class="wixob-q__nav">'
          +     '<span class="wixob-q__count">Câu ' + (i + 1) + ' / ' + Q.length + '</span>'
          +     '<div class="wixob-q__dots">'
          +       Q.map((_, k) => '<i class="' + (k === i ? 'on' : k < i ? 'done' : '') + '"></i>').join('')
          +     '</div>'
          +   '</div>'
          + '</div>'
          + '<p class="wixob-q__t">' + q.q + '</p>'
          + '<p class="wixob-q__hint">' + Q.length + ' câu, bạn chỉ trả lời một lần duy nhất.</p>'
          + '<div class="wixob-q__opts">'
          + q.opts.map(o => '<button class="wixob-q__opt" type="button" data-v="' + o.v + '"><b>' + o.t + '</b>'
                + (o.d ? '<span>' + o.d + '</span>' : '') + '</button>').join('')
          + '</div>'
          + (i > 0 ? '<button class="wixob-q__back" type="button">← Quay lại câu trước</button>' : '');

        box.querySelectorAll('.wixob-q__opt').forEach(b => {
            b.onclick = () => { A[q.id] = b.dataset.v; put(A); renderSurvey(); };
        });
        const back = box.querySelector('.wixob-q__back');
        if (back) back.onclick = () => { delete A[Q[i - 1].id]; put(A); renderSurvey(); };
    }

    /* ── Vòng lặp ────────────────────────────────────────── */
    const shown = (id) => {
        const el = document.getElementById(id);
        return el && el.style.display !== 'none' && el.offsetParent !== null;
    };

    css();
    // bắt ngay lúc app đổi màn hình, không đợi hết chu kỳ 800ms
    try {
        const mo = new MutationObserver(() => guard());
        SHELL.forEach(id => {
            const el = document.getElementById(id);
            if (el) mo.observe(el, { attributes: true, attributeFilter: ['style'] });
        });
    } catch (_) {}

    setInterval(() => {
        css();
        guard();
        if (shown('view-scan-progress')) renderSurvey();
    }, 400);

    window.WistorixOnboarding = {
        reset: () => {
            A = {}; put(A);
            armed = false; pending = null;
            const q = document.getElementById('wixob-q'); if (q) q.remove();
        },
        answers: () => A,
    };
})();
