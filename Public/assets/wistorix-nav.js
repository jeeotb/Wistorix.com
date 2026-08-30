/* Wistorix · hành vi thanh nav dùng chung cho mọi trang
   Vuốt xuống: ẩn thanh nav · vuốt lên: hiện lại.
   Không ẩn khi đang mở menu mobile hoặc dropdown. */
(function(){
  function init(){
    var nav=document.querySelector('.navbar');
    if(!nav) return;
    var last=window.pageYOffset||document.documentElement.scrollTop||0,
        ticking=false, TOP=80, DELTA=6;
    function busy(){
      return !!nav.querySelector('.w--open') || !!document.querySelector('.w-nav-overlay .w-nav-menu');
    }
    function update(){
      ticking=false;
      var y=window.pageYOffset||document.documentElement.scrollTop||0;
      if(y<0) y=0;
      if(Math.abs(y-last)<=DELTA) return;
      if(busy()){ nav.classList.remove('wx-nav-up'); last=y; return; }
      if(y>last && y>TOP) nav.classList.add('wx-nav-up');
      else nav.classList.remove('wx-nav-up');
      last=y;
    }
    window.addEventListener('scroll',function(){
      if(!ticking){ ticking=true; requestAnimationFrame(update); }
    },{passive:true});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
