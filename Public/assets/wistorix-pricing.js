/* ============================================================
   WISTORIX PRICING · NGUỒN DUY NHẤT CHO BẢNG GIÁ TRÊN WEBSITE
   Sửa giá/tên gói/bullet ở ĐÂY, mọi trang (index, pricing) tự cập nhật.
   Nguồn số liệu: app v5.7 (Settings > Thanh toán, module pay-per-scan).
   LƯU Ý SEO: nếu đổi GIÁ, sửa thêm JSON-LD offers trong <head> của
   pricing.html và index.html + meta description pricing.html.
   ============================================================ */
window.WISTORIX_PRICING = {
  head: {
    title: "Bắt đầu miễn phí, nâng cấp khi bạn cần",
    sub: "Dùng thử để biết Drive của bạn đang có gì. Trả phí khi cần quét sâu hơn, xử lý hàng loạt và tự động hoá.",
    yearNote: "Trả theo năm tiết kiệm ~40%"
  },
  plans: {
    free: {
      name: "Free",
      desc: "Trải nghiệm miễn phí: quét sạch và kiểm tra lỗ hổng trên 1 Drive.",
      price: "Miễn phí",
      features: [
        "Tối đa 1 Drive",
        "Quét file mồ côi · trùng · lỗ hổng",
        "Báo cáo trực quan dung lượng rác",
        "Xử lý thủ công tối đa 100 file"
      ],
      cta: "Cài miễn phí"
    },
    standard: {
      name: "Standard",
      desc: "Dọn dẹp thường xuyên với tự động hoá cơ bản cho 1 Drive.",
      price: "59.000đ",
      unit: "/Drive/tháng",
      features: [
        "Toàn bộ tính năng gói Free",
        "Xử lý nhiều hơn gói Free",
        "Tự động dọn dẹp theo lịch tuần, tháng",
        "Hỗ trợ ưu tiên qua email"
      ],
      cta: "Dùng thử Standard"
    },
    one: {
      badge: "★ Phổ biến nhất",
      name: "One-Wistorix",
      desc: "Không giới hạn dọn dẹp và tự động bảo vệ chất xám trên 1 Drive chính.",
      price: "69.000đ",
      unit: "/Drive/tháng",
      features: [
        "<b>Không giới hạn</b>&nbsp;số file dọn dẹp", /* phần tử có data-wx-html="1" */
        "Auto-Offboarding: chuyển quyền & thu hồi",
        "Báo cáo kiểm toán dữ liệu định kỳ",
        "Direct Interface (sắp có)",
        "AI Assistant gợi ý dọn dẹp (sắp có)"
      ],
      cta: "Chọn One-Wistorix"
    }
  },
  /* Mua theo lượt quét · bậc thang từ app v5.7: 1-4 = 40k · 5-9 = 36k · 10+ = 32k */
  payg: {
    title: "Mua theo lượt quét",
    desc: "Không muốn đăng ký định kỳ? Mua lẻ từng lượt quét Drive, trả bao nhiêu dùng bấy nhiêu, không hết hạn.",
    badge: "Không auto-gia hạn",
    customLabel: "Chọn số lượt tuỳ ý",
    cta: "Mua lượt quét",
    packs: [
      { qty: 1,  total: "40.000đ",  per: "40.000đ/lượt" },
      { qty: 5,  total: "180.000đ", per: "36.000đ/lượt · tiết kiệm 10%", badge: "Phổ biến" },
      { qty: 10, total: "320.000đ", per: "32.000đ/lượt · tiết kiệm 20%", badge: "Tiết kiệm nhất" }
    ],
    /* đơn giá bậc thang, dùng cho ô "Chọn số lượt tuỳ ý" */
    rate: function (q) { return q >= 10 ? 32000 : q >= 5 ? 36000 : 40000; },
    note: "Giá bậc thang: 1–4 lượt = 40.000đ/lượt · 5–9 lượt = 36.000đ/lượt · từ 10 lượt = 32.000đ/lượt. Mỗi lượt là một lần quét toàn bộ Drive. Bạn có 5 lượt miễn phí khi cài, mời 1 người bạn cài và quét lần đầu là thêm 1 lượt."
  },
  multi: {
    title: "Multi-Wistorix · cho tổ chức nhiều Drive",
    desc: "Nhiều Drive trong một Admin Console: quét liên tài khoản, rà soát quyền khi nhân sự nghỉ việc, chuẩn hoá cấu hình. Giá theo quy mô, trả theo năm tiết kiệm khoảng 40%.",
    cta: "Liên hệ tư vấn"
  }
};

(function () {
  var P = window.WISTORIX_PRICING;

  function vnd(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "đ";
  }

  /* Điền text từ data vào các phần tử data-wx */
  function fill() {
    var els = document.querySelectorAll("[data-wx]");
    for (var i = 0; i < els.length; i++) {
      var path = els[i].getAttribute("data-wx").split(".");
      var v = P;
      for (var j = 0; j < path.length && v != null; j++) v = v[path[j]];
      if (typeof v === "string") {
        if (els[i].getAttribute("data-wx-html") === "1") els[i].innerHTML = v;
        else els[i].textContent = v;
      }
    }
  }

  /* Chọn pack + stepper + tổng tiền */
  function payg() {
    var wrap = document.getElementById("wxpPacks");
    if (!wrap) return;
    var qtyEl = document.getElementById("wxpQty");
    var totalEl = document.getElementById("wxpTotal");
    var chosenEl = document.getElementById("wxpChosen");
    var perEl = document.getElementById("wxpCustomPer");
    var customQty = 1;

    function update(q) {
      var total = q * P.payg.rate(q);
      totalEl.textContent = "Tổng: " + vnd(total);
      chosenEl.innerHTML = 'Đã chọn <b style="color:#fff">' + q + " lượt quét</b> · dùng dần, không giới hạn thời gian";
    }
    function select(pack) {
      var packs = wrap.querySelectorAll(".wxp-pack");
      for (var i = 0; i < packs.length; i++) packs[i].classList.remove("wxp-sel");
      pack.classList.add("wxp-sel");
      var q = pack.getAttribute("data-wxq");
      update(q === "custom" ? customQty : parseInt(q, 10));
    }
    wrap.addEventListener("click", function (e) {
      var pack = e.target.closest(".wxp-pack");
      if (pack) select(pack);
    });
    function step(d) {
      customQty = Math.max(1, customQty + d);
      qtyEl.textContent = customQty;
      perEl.textContent = vnd(P.payg.rate(customQty)) + "/lượt";
      select(wrap.querySelector('[data-wxq="custom"]'));
    }
    document.getElementById("wxpMinus").addEventListener("click", function (e) { e.stopPropagation(); step(-1); });
    document.getElementById("wxpPlus").addEventListener("click", function (e) { e.stopPropagation(); step(1); });
  }

  function init() { try { fill(); payg(); } catch (e) { /* không chặn trang */ } }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
