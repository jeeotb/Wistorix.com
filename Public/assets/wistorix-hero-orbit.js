/* Wistorix hero orbit · phần việc của JS chỉ có ba thứ, còn lại CSS lo hết:
   1. Thu phóng sân khấu 640x640 cho vừa cột bên phải (biến --k).
   2. Lặp lại sau mỗi 24 giây, vì các animation đều là một lần rồi thôi.
   3. Tạm dừng khi hero ra khỏi màn hình hoặc khi đổi tab, cho nhẹ máy.
   Cặp đôi: assets/wistorix-hero-orbit.css */
(function(){
  var DUR = 24000;

  function init(){
    var box = document.querySelector('.wxo');
    var stage = box && box.querySelector('.wxo-stage');
    if(!stage) return;

    /* --- 1. vừa khung --- */
    function fit(){
      var w = box.clientWidth;
      /* Cho phep phong to hon 1 tren man rong, neu khoa o 1 thi man 1900px
         van chi ve san khau 640 nen nhin trong tenh va man app be. */
      if(w) box.style.setProperty('--k', Math.min(1.22, w / 640));
    }
    fit();
    if('ResizeObserver' in window) new ResizeObserver(fit).observe(box);
    else addEventListener('resize', fit, {passive:true});

    if(!document.getAnimations) return;   /* trình duyệt cũ: giữ khung hình cuối, vẫn đẹp */
    if(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    /* --- 2 và 3. vòng lặp, chỉ chạy khi còn nhìn thấy --- */
    var running = false, timer = null;

    function mine(){
      return document.getAnimations().filter(function(a){
        var t = a.effect && a.effect.target;
        /* pseudo-element trả về chính phần tử chủ, nên closest vẫn bắt được */
        return t && t.closest && t.closest('.wxo');
      });
    }
    function restart(){
      mine().forEach(function(a){ try{ a.currentTime = 0; a.play(); }catch(e){} });
    }
    function start(){
      if(running) return;
      running = true;
      restart();
      timer = setInterval(restart, DUR);
    }
    function stop(){
      if(!running) return;
      running = false;
      clearInterval(timer);
      mine().forEach(function(a){ try{ a.pause(); }catch(e){} });
    }

    if('IntersectionObserver' in window){
      new IntersectionObserver(function(en){
        en[0].isIntersecting ? start() : stop();
      }, {threshold:.05}).observe(box);
    } else start();

    document.addEventListener('visibilitychange', function(){
      document.hidden ? stop() : start();
    });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
