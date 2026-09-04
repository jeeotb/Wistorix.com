/* Wistorix · hiện dần các module tính năng khi cuộn tới.
   Chỉ thêm class khi JS chạy được, nếu tắt JS thì nội dung vẫn hiện đầy đủ. */
(function () {
  'use strict';
  var rows = document.querySelectorAll('.wxm-row');
  if (!rows.length) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) return;

  document.documentElement.classList.add('wxm-js');

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });

  Array.prototype.forEach.call(rows, function (r) { io.observe(r); });

  /* phòng trường hợp trang được mở giữa chừng: sau 2,5s cứ hiện hết */
  setTimeout(function () {
    Array.prototype.forEach.call(rows, function (r) { r.classList.add('is-in'); });
  }, 2500);
})();
