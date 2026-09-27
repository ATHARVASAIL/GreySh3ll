/* =========================================================
   landing-motion.js  —  GreySh3ll landing "Signal" motion layer
   (index.html only). Pure enhancement over home.js: it never
   touches app data or logic, only presentation and motion.

   CSP-safe: no inline styles or scripts are ever written. All
   dynamic values go through element.style.setProperty(), exactly
   like the app's own applyCspStyles(). Everything is gated behind
   prefers-reduced-motion and degrades to a static, fully usable page.
========================================================= */
(function(){
  'use strict';

  var reduce = window.matchMedia &&
               window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- helpers ---- */
  function el(tag, cls){ var n = document.createElement(tag); if(cls) n.className = cls; return n; }
  function setVar(node, name, val){ if(node) node.style.setProperty(name, val); }

  /* -------------------------------------------------------
     1. ATMOSPHERE — drifting aurora + grain, injected once.
        (The engineered grid reuses the existing .bg-grid.)
  ------------------------------------------------------- */
  function injectAtmosphere(){
    if(document.querySelector('.l-atmos')) return;
    var wrap = el('div', 'l-atmos');
    wrap.setAttribute('aria-hidden', 'true');
    ['a1','a2','a3'].forEach(function(k){ wrap.appendChild(el('div', 'l-aurora ' + k)); });
    wrap.appendChild(el('div', 'l-grain'));
    document.body.appendChild(wrap);
  }

  /* -------------------------------------------------------
     2. STAGGERED LOAD REVEALS — index the .l-load elements so
        their animation-delay cascades in DOM order.
  ------------------------------------------------------- */
  function indexLoad(){
    var nodes = document.querySelectorAll('.l-load');
    for(var i=0;i<nodes.length;i++){ setVar(nodes[i], '--i', String(i)); }
  }

  /* -------------------------------------------------------
     3. SCROLL REVEALS — IntersectionObserver toggles .in-view.
        Children of a [data-reveal-group] get a staggered --i.
  ------------------------------------------------------- */
  function initReveals(){
    var targets = document.querySelectorAll('.l-reveal');
    if(reduce || !('IntersectionObserver' in window)){
      for(var j=0;j<targets.length;j++){ targets[j].classList.add('in-view'); }
      return;
    }
    // stagger index within each group
    document.querySelectorAll('[data-reveal-group]').forEach(function(group){
      var kids = group.querySelectorAll('.l-reveal');
      for(var k=0;k<kids.length;k++){ setVar(kids[k], '--i', String(k)); }
    });
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(e.isIntersecting){ e.target.classList.add('in-view'); io.unobserve(e.target); }
      });
    }, { threshold:0.12, rootMargin:'0px 0px -8% 0px' });
    for(var t=0;t<targets.length;t++){ io.observe(targets[t]); }
  }

  /* -------------------------------------------------------
     4. POINTER GLOW — cards track the cursor for a soft spotlight.
        Sets --mx/--my (percent) consumed by the ::before gradient.
  ------------------------------------------------------- */
  function initPointerGlow(){
    if(reduce) return;
    document.addEventListener('pointermove', function(ev){
      var card = ev.target && ev.target.closest &&
                 ev.target.closest('.domain-card, .l-flow-card');
      if(!card) return;
      var r = card.getBoundingClientRect();
      setVar(card, '--mx', ((ev.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      setVar(card, '--my', ((ev.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    }, { passive:true });
  }

  /* -------------------------------------------------------
     5. MAGNETIC BUTTONS — the primary CTAs lean toward the cursor.
        rAF-throttled; resets on leave.
  ------------------------------------------------------- */
  function initMagnetic(){
    if(reduce) return;
    var btns = document.querySelectorAll('[data-magnetic]');
    btns.forEach(function(btn){
      var raf = 0;
      btn.addEventListener('pointermove', function(ev){
        if(raf) return;
        raf = requestAnimationFrame(function(){
          raf = 0;
          var r = btn.getBoundingClientRect();
          var dx = (ev.clientX - (r.left + r.width/2)) / (r.width/2);
          var dy = (ev.clientY - (r.top + r.height/2)) / (r.height/2);
          btn.style.setProperty('transform', 'translate(' + (dx*7).toFixed(1) + 'px,' + (dy*7).toFixed(1) + 'px)');
        });
      });
      btn.addEventListener('pointerleave', function(){
        btn.style.setProperty('transform', 'translate(0,0)');
      });
    });
  }

  /* -------------------------------------------------------
     6. HERO PARALLAX — layers drift slightly as the page scrolls.
        rAF-throttled scroll; sets --py on [data-parallax] nodes.
  ------------------------------------------------------- */
  function initParallax(){
    if(reduce) return;
    var layers = document.querySelectorAll('[data-parallax]');
    if(!layers.length) return;
    var ticking = false;
    function update(){
      ticking = false;
      var y = window.pageYOffset || 0;
      layers.forEach(function(layer){
        var speed = parseFloat(layer.getAttribute('data-parallax')) || 0.1;
        setVar(layer, '--py', (y * speed * -1).toFixed(1) + 'px');
      });
    }
    window.addEventListener('scroll', function(){
      if(!ticking){ ticking = true; requestAnimationFrame(update); }
    }, { passive:true });
    update();
  }

  /* -------------------------------------------------------
     7. TICKER — clone the track once so the marquee loops seamlessly
        (the -50% keyframe assumes the content is duplicated).
  ------------------------------------------------------- */
  function initTicker(){
    var track = document.querySelector('.l-ticker-track');
    if(!track || track.getAttribute('data-cloned') === '1') return;
    track.setAttribute('data-cloned', '1');
    var kids = Array.prototype.slice.call(track.children);
    kids.forEach(function(node){
      var c = node.cloneNode(true);
      c.setAttribute('aria-hidden', 'true');
      track.appendChild(c);
    });
  }

  /* -------------------------------------------------------
     8. STAT COUNT-UP — the hero stat trio counts up on first view.
        Values live in data-count; respects reduced-motion.
  ------------------------------------------------------- */
  function countUp(node){
    var to = parseInt(node.getAttribute('data-count'), 10);
    if(isNaN(to)) return;
    if(reduce){ node.textContent = to.toLocaleString(); return; }
    var dur = 1100, start = 0;
    function step(now){
      if(!start) start = now;
      var t = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - t, 3);
      node.textContent = Math.round(to * eased).toLocaleString();
      if(t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function initStatCount(){
    var stats = document.querySelectorAll('[data-count]');
    if(!stats.length) return;
    if(reduce || !('IntersectionObserver' in window)){
      stats.forEach(countUp); return;
    }
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(e.isIntersecting){ countUp(e.target); io.unobserve(e.target); }
      });
    }, { threshold:0.6 });
    stats.forEach(function(s){ io.observe(s); });
  }

  /* -------------------------------------------------------
     BOOT — run presentation setup now; re-tag the dashboard once
     home.js has populated it (domain grid / charts are async).
  ------------------------------------------------------- */
  function tagDashboardReveals(){
    // Give the runtime-built dashboard blocks scroll-reveal behaviour.
    var groups = [
      ['.dash-overview', 1],
      ['.dash-sev-row', 1],
      ['.dash-charts', 1],
      ['.dash-cta', 0],
      ['.dash-search', 0],
      ['#domainGrid', 1]
    ];
    groups.forEach(function(pair){
      var host = document.querySelector(pair[0]);
      if(!host || host.getAttribute('data-revealed') === '1') return;
      host.setAttribute('data-revealed', '1');
      if(pair[1]){
        host.setAttribute('data-reveal-group', '');
        var kids = host.children;
        for(var i=0;i<kids.length;i++){ kids[i].classList.add('l-reveal'); }
      } else {
        host.classList.add('l-reveal');
      }
    });
    initReveals();
  }

  function boot(){
    injectAtmosphere();
    indexLoad();
    initTicker();
    initReveals();
    initPointerGlow();
    initMagnetic();
    initParallax();
    initStatCount();

    // The domain grid is filled by home.js after loadAllData() resolves.
    // Watch for it, then wire reveals onto the freshly-built cards.
    var grid = document.getElementById('domainGrid');
    if(grid){
      if(grid.children.length){
        tagDashboardReveals();
      } else {
        var mo = new MutationObserver(function(){
          if(grid.children.length){ mo.disconnect(); tagDashboardReveals(); }
        });
        mo.observe(grid, { childList:true });
        // safety net in case the observer misses (e.g. data cached instantly)
        setTimeout(tagDashboardReveals, 1500);
      }
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
