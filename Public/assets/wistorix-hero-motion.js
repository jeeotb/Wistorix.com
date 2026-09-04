/* Wistorix hero · khối bên phải tự chạy vòng lặp 7 nhịp:
   logo chấm → logo đặc → quỹ đạo + 3 icon → 3 slide tính năng → cảnh kết → lặp lại.
   H1 bên trái để cố định, không hiệu ứng chữ.
   Chỉ đổi thuộc tính data-s theo hẹn giờ, chuyển động do CSS lo · tự dừng khi hero ra khỏi màn hình. */
(function(){
  function init(){
    var stage=document.querySelector('.wx-stage');
    if(!stage)return;
    var feats=[].slice.call(document.querySelectorAll('.wx-feat'));
    var SEQ=[['dots',2400],['logo',2100],['orbit',4400],['f1',4800],['f2',4800],['f3',4800],['end',2800]];
    var i=0,timer=null,running=false;

    if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches){
      stage.setAttribute('data-s','orbit');
      return;
    }
    function show(k){
      stage.setAttribute('data-s',SEQ[k][0]);
      for(var n=0;n<feats.length;n++)feats[n].classList.toggle('is-on',feats[n].getAttribute('data-f')===SEQ[k][0]);
    }
    function step(){
      show(i);
      timer=setTimeout(function(){i=(i+1)%SEQ.length;step();},SEQ[i][1]);
    }
    function start(){if(running)return;running=true;step();}
    function stop(){running=false;clearTimeout(timer);}
    /* chỉ chạy khi hero còn trong tầm nhìn, cuộn xuống dưới là tự dừng cho nhẹ máy */
    if('IntersectionObserver' in window){
      new IntersectionObserver(function(en){en[0].isIntersecting?start():stop();},{threshold:.05}).observe(stage);
    }else start();
    document.addEventListener('visibilitychange',function(){document.hidden?stop():start();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
