/* ================================================================
   WISTORIX CLONE — DEMO CTA, LỚP BỔ SUNG
   Gắn thêm các điểm chạm vào đúng thao tác thật của ứng dụng:
   nhóm lẻ, thu hồi toàn bộ quyền theo người, và trục số Drive.
   Cần __mock/cta-demo.js chạy trước.
   ================================================================ */
(function () {
    'use strict';
    if (!window.WistorixMock) return;

    const D = () => window.WistorixCtaDemo;

    /* ── CSS riêng cho lớp bổ sung ───────────────────────── */
    function css() {
        if (document.getElementById('wixctax-style')) return;
        const s = document.createElement('style');
        s.id = 'wixctax-style';
        s.textContent = `
        .wixctax-panel{position:fixed;left:16px;bottom:262px;z-index:2147483000;width:270px;
            background:#0B1220;color:#fff;border-radius:14px;padding:12px 15px 14px;
            font:500 12px/1.45 Manrope,system-ui,sans-serif;box-shadow:0 14px 34px -14px rgba(0,0,0,.6)}
        .wixctax-panel__t{font-weight:800;font-size:12.5px;margin-bottom:9px}
        .wixctax-panel__t span{opacity:.5;font-weight:500}
        .wixctax-panel__grid{display:flex;flex-wrap:wrap;gap:6px}
        .wixctax-panel button{background:rgba(255,255,255,.11);border:0;color:#fff;border-radius:7px;
            padding:6px 10px;font:700 11.5px Manrope,system-ui,sans-serif;cursor:pointer}
        .wixctax-panel button:hover{background:rgba(255,255,255,.22)}
        .wixctax-hint{font-size:10.5px;opacity:.45;line-height:1.5;margin-top:8px}
        .wixctax-note{display:block;margin-top:6px;font:600 11.5px/1.4 Manrope,system-ui,sans-serif;color:#A2560A}
        `;
        document.head.appendChild(s);
    }

    /* ── Nhóm 2 · thao tác lẻ trên một tệp ───────────────── */
    const SINGLE = '.btn-stop-sharing, .btn-delete, .btn-transfer-own, .btn-request-own, .btn-revoke, .file-action-btn--danger';

    function handleSingle(e, btn) {
        const d = D();
        if (!d) return;
        e.preventDefault(); e.stopImmediatePropagation();

        if (d.remaining() <= 0) {
            // Hết hạn mức: đây là lần duy nhất thao tác lẻ được nhắc tới gói
            const ov = d.overlay(
                '<div class="wixcta-tag">Nhóm 2 · hết hạn mức</div>'
                + '<h3>Hôm nay đã dùng hết 25 tệp</h3>'
                + d.meterHtml()
                + '<p>Thao tác này mở lại lúc 00:00. Danh sách vẫn xem và lọc đầy đủ, '
                + 'các tệp đã xử lý vẫn khôi phục được trong 30 ngày.</p>'
                + '<div class="wixcta-row">'
                + '<button class="wixcta-btn" id="wixctax-up">Nâng gói để tiếp tục ngay</button>'
                + '<button class="wixcta-btn wixcta-btn--ghost" id="wixctax-close">Để mai</button>'
                + '</div>'
            );
            ov.querySelector('#wixctax-up').onclick = () => { d.closeOverlay(); window.location.hash = '#/upgrade'; };
            ov.querySelector('#wixctax-close').onclick = d.closeOverlay;
            return;
        }

        // Còn hạn mức: trừ im lặng, không nhắc gói
        d.state.used += 1;
        d.state.backlog = Math.max(0, d.state.backlog - 1);
        d.state.processedTotal += 1;
        d.save();
        d.renderAll();
        d.toast('Đã xử lý 1 tệp · còn ' + d.remaining() + '/' + d.DAILY + ' hôm nay (mô phỏng)');
    }

    /* ── Email được chia sẻ · thu hồi toàn bộ theo người ── */
    function countFilesOfPerson(btn) {
        // Lấy số tệp từ khu vực chứa nút, nếu không có thì dùng số mặc định để demo
        const scope = btn.closest('.file-sidebar, .email-hero, section, div');
        const text = scope ? scope.innerText : '';
        const m = text.match(/(\d+)\s*(tệp|file)/i);
        return m ? parseInt(m[1], 10) : 180;
    }

    function handleHeroRevoke(e, btn) {
        const d = D();
        if (!d) return;
        e.preventDefault(); e.stopImmediatePropagation();

        const total = countFilesOfPerson(btn);
        const now   = Math.min(total, d.remaining());
        const left  = Math.max(0, total - now);
        const days  = Math.ceil(left / d.DAILY);
        const email = (btn.dataset.email || btn.getAttribute('title') || '').trim() || 'người này';

        const ov = d.overlay(
            '<div class="wixcta-tag">Email chia sẻ · CTA mạnh nhất</div>'
            + '<h3>Thu hồi quyền của ' + email + ' trên ' + total + ' tệp?</h3>'
            + d.meterHtml()
            + '<p>Hạn mức hôm nay còn <b>' + d.remaining() + '</b> tệp. Wistorix thu hồi ' + now + ' tệp ngay bây giờ, '
            + (left > 0
                ? '<b>' + left + '</b> tệp còn lại cần thêm <b>' + days + '</b> ngày. '
                  + 'Nâng gói để cắt quyền toàn bộ trong một lần, ngay hôm nay.'
                : 'toàn bộ nằm trong hạn mức hôm nay.')
            + '</p>'
            + '<div class="wixcta-row">'
            + (left > 0
                ? '<button class="wixcta-btn" id="wixctax-buy">Nâng gói, thu hồi cả ' + total + ' tệp</button>'
                  + '<button class="wixcta-btn wixcta-btn--ghost" id="wixctax-part">Thu hồi ' + now + ' tệp hôm nay</button>'
                : '<button class="wixcta-btn" id="wixctax-part">Thu hồi ' + now + ' tệp</button>')
            + '</div>'
            + (left > 0 ? '<p class="wixcta-foot">Cắt quyền dở dang không giải quyết được vấn đề, nên ở đây nút nâng gói đứng trước.</p>' : '')
        );
        const buy = ov.querySelector('#wixctax-buy');
        if (buy) buy.onclick = () => { d.closeOverlay(); window.location.hash = '#/upgrade'; };
        ov.querySelector('#wixctax-part').onclick = () => { d.closeOverlay(); d.applyProcessed(now, 'thu hồi quyền'); };
    }

    /* ── Trục Drive · chặn kết nối Drive thứ hai ─────────── */
    function handleAddAccount(e) {
        const d = D();
        if (!d) return;
        e.preventDefault(); e.stopImmediatePropagation();

        const ov = d.overlay(
            '<div class="wixcta-tag">Trục Drive · Multi-Wistorix</div>'
            + '<h3>Kết nối Drive thứ hai</h3>'
            + '<p>Gói hiện tại quản lý một Drive. Wistorix vẫn kết nối và quét đầy đủ Drive mới để bạn thấy '
            + 'Drive đó đang có bao nhiêu vấn đề, nhưng thao tác dọn dẹp trên Drive thứ hai thuộc gói Multi-Wistorix.</p>'
            + '<div class="wixcta-row">'
            + '<button class="wixcta-btn" id="wixctax-scan">Kết nối và quét thử</button>'
            + '<button class="wixcta-btn wixcta-btn--ghost" id="wixctax-multi">Xem gói Multi-Wistorix</button>'
            + '</div>'
            + '<p class="wixcta-foot">Cho xem trước rồi mới tính tiền, giống cách quét miễn phí đang làm ở gói dưới.</p>'
        );
        ov.querySelector('#wixctax-scan').onclick = () => {
            d.closeOverlay();
            d.toast('Đã kết nối Drive thứ hai ở chế độ chỉ quét (mô phỏng)');
        };
        ov.querySelector('#wixctax-multi').onclick = () => { d.closeOverlay(); window.location.hash = '#/upgrade'; };
    }

    /* ── B3 · dòng trạng thái bảng tệp khi hết lượt ──────── */
    function renderListStatus() {
        const d = D();
        const el = document.getElementById('list-status');
        if (!d || !el) return;
        if (d.remaining() > 0) {
            if (el.dataset.wixctax === '1') { el.textContent = el.dataset.wixctaxOld || ''; delete el.dataset.wixctax; }
            return;
        }
        if (el.dataset.wixctax !== '1') {
            el.dataset.wixctaxOld = el.textContent;
            el.dataset.wixctax = '1';
        }
        el.textContent = 'Hôm nay đã xử lý 25/25 tệp. Danh sách vẫn xem và lọc đầy đủ, thao tác mở lại lúc 00:00 hoặc ngay khi nâng gói.';
    }

    /* ── B4 · nhãn phụ trong panel xem nhanh ─────────────── */
    function renderPreviewNote() {
        const d = D();
        const panel = document.getElementById('filePreview');
        if (!d || !panel) return;
        let note = panel.querySelector('.wixctax-note');
        if (d.remaining() <= 0) {
            if (!note) {
                note = document.createElement('span');
                note.className = 'wixctax-note';
                const host = panel.querySelector('.preview-actions, .file-preview__actions') || panel;
                host.appendChild(note);
            }
            note.textContent = 'Hết lượt hôm nay · nâng gói để xử lý tiếp';
        } else if (note) { note.remove(); }
    }

    /* ── Bảng điều khiển phụ ─────────────────────────────── */
    function panel() {
        if (document.getElementById('wixctax-panel')) return;
        const p = document.createElement('div');
        p.id = 'wixctax-panel';
        p.className = 'wixctax-panel';
        p.innerHTML =
            '<div class="wixctax-panel__t">Điểm chạm mới <span>· lớp bổ sung</span></div>'
            + '<div class="wixctax-panel__grid">'
            + '<button id="wixctax-go-email">Email chia sẻ</button>'
            + '<button id="wixctax-hero">Thu hồi 180 tệp</button>'
            + '</div>'
            + '<div class="wixctax-panel__grid" style="margin-top:6px;">'
            + '<button id="wixctax-adddrive">Thêm Drive thứ 2</button>'
            + '</div>'
            + '<div class="wixctax-hint">Nút hành động lẻ trong bảng đã trừ hạn mức im lặng, chỉ nhắc gói khi hết lượt.</div>';
        document.body.appendChild(p);

        p.querySelector('#wixctax-go-email').onclick = () => { window.location.hash = '#/email-shared'; };
        p.querySelector('#wixctax-hero').onclick = () => {
            const fake = document.createElement('button');
            fake.dataset.email = 'minhanh@congty.vn';
            fake.innerText = '180 tệp';
            handleHeroRevoke({ preventDefault() {}, stopImmediatePropagation() {} }, fake);
        };
        p.querySelector('#wixctax-adddrive').onclick = () => {
            handleAddAccount({ preventDefault() {}, stopImmediatePropagation() {} });
        };
    }

    /* ── Bind ────────────────────────────────────────────── */
    function start() {
        css();
        panel();
        document.addEventListener('click', (e) => {
            const d = D();
            if (!d || !d.state.on) return;

            const hero = e.target.closest('.btn-hero-revoke');
            if (hero) return handleHeroRevoke(e, hero);

            const add = e.target.closest('[data-profile-action="add-account"]');
            if (add) return handleAddAccount(e);

            const single = e.target.closest(SINGLE);
            if (single) return handleSingle(e, single);
        }, true);

        setInterval(() => { renderListStatus(); renderPreviewNote(); }, 900);
        console.info('[cta-demo-extra] Đã gắn CTA cho thao tác lẻ, thu hồi theo người và trục Drive.');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
