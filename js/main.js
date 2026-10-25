/* =========================================================
   GRUPO GBR — interações e animações (GSAP + ScrollTrigger + Lenis)
   ========================================================= */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasGSAP = typeof window.gsap !== 'undefined';
  if (hasGSAP && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ---------------------------------------------------------
     0. Ano no rodapé
  --------------------------------------------------------- */
  var yr = $('#year'); if (yr) yr.textContent = new Date().getFullYear();

  /* ---------------------------------------------------------
     1. Hero video — só aparece quando o arquivo existir
  --------------------------------------------------------- */
  (function heroVideo() {
    var v = $('#heroVideo');
    if (!v || !window.fetch) return;

    var candidates = [v.getAttribute('data-src'), v.getAttribute('data-src-webm')].filter(Boolean);

    // Sonda cada arquivo antes de usar: sem vídeo, o fundo gradiente permanece
    // e nada aparece como erro no console.
    (function probe(i) {
      if (i >= candidates.length) return;
      fetch(candidates[i], { method: 'HEAD' })
        .then(function (res) {
          if (!res.ok) throw new Error('404');
          v.src = candidates[i];
          v.addEventListener('loadeddata', function () { v.style.opacity = '1'; }, { once: true });
          v.addEventListener('error', function () { v.style.display = 'none'; }, { once: true });
          v.load();
          var p = v.play && v.play();
          if (p && p.catch) p.catch(function () { /* autoplay bloqueado: segue o gradiente */ });
        })
        .catch(function () { probe(i + 1); });
    })(0);
  })();

  /* ---------------------------------------------------------
     2. Smooth scroll (Lenis) + ponte com o ScrollTrigger
  --------------------------------------------------------- */
  var lenis = null;
  if (!reduce && typeof window.Lenis !== 'undefined' && window.innerWidth > 1024) {
    lenis = new Lenis({ duration: 1.15, smoothWheel: true, touchMultiplier: 1.6 });
    if (hasGSAP) {
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
      gsap.ticker.lagSmoothing(0);
    } else {
      (function raf(t) { lenis.raf(t); requestAnimationFrame(raf); })(0);
    }
  }

  function scrollToEl(el) {
    var y = el.getBoundingClientRect().top + window.pageYOffset - 70;
    if (lenis) lenis.scrollTo(y, { duration: 1.2 });
    else window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
  }

  /* ---------------------------------------------------------
     3. Preloader
  --------------------------------------------------------- */
  var started = false;
  function startSite() {
    if (started) return;
    started = true;
    var pre = $('#preloader'); if (pre) pre.remove();
    document.body.style.removeProperty('overflow');
    heroIntro();
    buildScrollAnimations();
    if (hasGSAP) ScrollTrigger.refresh();
    var wa = $('#wa'); if (wa) setTimeout(function () { wa.classList.add('is-in'); }, 900);
  }

  (function preloader() {
    var pre = $('#preloader');
    if (!pre) { startSite(); return; }
    if (reduce || !hasGSAP) { startSite(); return; }

    document.body.style.overflow = 'hidden';
    // Failsafe: aba em segundo plano congela o requestAnimationFrame.
    // Se a timeline não terminar, o site destrava sozinho.
    setTimeout(startSite, 4000);
    var bar = $('.pre__bar span', pre), num = $('.pre__num', pre);
    var state = { v: 0 };

    var tl = gsap.timeline({ onComplete: function () { pre.remove(); startSite(); } });
    tl.to(bar, { width: '100%', duration: 1.25, ease: 'power2.inOut' }, 0)
      .to(state, {
        v: 100, duration: 1.25, ease: 'power2.inOut',
        onUpdate: function () { num.textContent = String(Math.round(state.v)).padStart(2, '0'); }
      }, 0)
      .to('.pre__inner', { y: -18, opacity: 0, duration: .45, ease: 'power2.in' }, '+=.12')
      .to(pre, { yPercent: -100, duration: .8, ease: 'expo.inOut' }, '-=.15');
  })();

  /* ---------------------------------------------------------
     4. Entrada do hero
  --------------------------------------------------------- */
  function heroIntro() {
    if (!hasGSAP || reduce) return;
    var lines = $$('.hero .line-mask > *');
    var tl = gsap.timeline({ defaults: { ease: 'expo.out' } });

    gsap.set(lines, { yPercent: 115 });
    tl.to('.hero .overline', { opacity: 1, y: 0, duration: .8 }, .12)
      .to(lines, { yPercent: 0, duration: 1.25, stagger: .09 }, .2)
      .to('.hero__sub', { opacity: 1, y: 0, duration: .9 }, .72)
      .to('.hero__actions', { opacity: 1, y: 0, duration: .9 }, .85)
      .to('.hero .stat', { opacity: 1, y: 0, duration: .8, stagger: .08 }, .95)
      .from('.hero__media', { scale: 1.12, duration: 2.2, ease: 'power2.out' }, 0);
  }

  /* ---------------------------------------------------------
     5. Animações de scroll
  --------------------------------------------------------- */
  function buildScrollAnimations() {
    if (!hasGSAP || reduce) {
      $$('[data-anim]').forEach(function (el) { el.style.opacity = 1; el.style.transform = 'none'; });
      $$('.reveal-img').forEach(function (b) {
        b.classList.add('is-revealed');
        var i = $('img', b); if (i) i.style.transform = 'none';
      });
      return;
    }

    /* 5.1 — reveals genéricos (fora do hero) */
    $$('[data-stagger]').forEach(function (group) {
      var items = $$('[data-anim]', group);
      if (!items.length) return;
      gsap.to(items, {
        opacity: 1, y: 0, duration: .95, ease: 'expo.out', stagger: .09,
        scrollTrigger: { trigger: group, start: 'top 82%' }
      });
    });

    $$('[data-anim]').forEach(function (el) {
      if (el.closest('.hero') || el.closest('[data-stagger]')) return;
      gsap.to(el, {
        opacity: 1, y: 0, duration: .95, ease: 'expo.out',
        scrollTrigger: { trigger: el, start: 'top 88%' }
      });
    });

    /* 5.2 — reveal de imagens: cortina dourada + zoom-out + parallax */
    $$('.reveal-img').forEach(function (box) {
      var img = $('img', box);

      ScrollTrigger.create({
        trigger: box, start: 'top 85%', once: true,
        onEnter: function () { box.classList.add('is-revealed'); }
      });

      if (!img) return;
      gsap.to(img, {
        scale: 1, duration: 1.7, ease: 'expo.out', delay: .15,
        scrollTrigger: { trigger: box, start: 'top 85%' }
      });
      if (box.classList.contains('spot__panel')) return; // logomarca centralizada: sem parallax
      gsap.to(img, {
        yPercent: -6, ease: 'none',
        scrollTrigger: { trigger: box, start: 'top bottom', end: 'bottom top', scrub: true }
      });
    });

    /* 5.3 — contadores */
    $$('[data-count]').forEach(function (el) {
      if (el.hasAttribute('data-plain')) return;
      var end = parseFloat(el.getAttribute('data-count'));
      var obj = { v: 0 };
      gsap.to(obj, {
        v: end, duration: 1.8, ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 92%' },
        onUpdate: function () { el.textContent = Math.round(obj.v); }
      });
    });

    /* 5.4 — títulos das seções com leve parallax */
    $$('.section--dark .sec-head__txt, .section--navy .sec-head__txt').forEach(function (el) {
      gsap.to(el, {
        yPercent: -6, ease: 'none',
        scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true }
      });
    });

    /* 5.5 — hero parallax de saída */
    gsap.to('.hero__inner', {
      yPercent: 14, opacity: .35, ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true }
    });
    gsap.to('.hero__media', {
      yPercent: 16, ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true }
    });

    /* 5.6 — nav ativa */
    $$('main section[id]').forEach(function (sec) {
      var link = $('.nav a[href="#' + sec.id + '"]');
      if (!link) return;
      ScrollTrigger.create({
        trigger: sec, start: 'top 45%', end: 'bottom 45%',
        onToggle: function (self) { link.classList.toggle('is-active', self.isActive); }
      });
    });
  }

  /* ---------------------------------------------------------
     6. Header: sticky, auto-hide e progresso
  --------------------------------------------------------- */
  (function header() {
    var header = $('#header'), prog = $('#scrollProgress');
    var last = 0;
    function onScroll() {
      var y = window.pageYOffset;
      header.classList.toggle('is-stuck', y > 40);
      header.classList.toggle('is-hidden', y > 420 && y > last && !document.body.classList.contains('nav-open'));
      last = y;
      if (prog) {
        var h = document.documentElement.scrollHeight - window.innerHeight;
        prog.style.transform = 'scaleX(' + (h > 0 ? y / h : 0) + ')';
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  })();

  /* ---------------------------------------------------------
     7. Menu mobile
  --------------------------------------------------------- */
  (function drawer() {
    var burger = $('#burger'), drawerEl = $('#drawer');
    if (!burger || !drawerEl) return;

    function setOpen(open) {
      document.body.classList.toggle('nav-open', open);
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
      document.body.style.overflow = open ? 'hidden' : '';
      if (lenis) open ? lenis.stop() : lenis.start();
    }

    burger.addEventListener('click', function () {
      setOpen(!document.body.classList.contains('nav-open'));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setOpen(false);
    });
    $$('.drawer__nav a, .drawer__foot a').forEach(function (a) {
      a.addEventListener('click', function () { setOpen(false); });
    });
    window.__closeDrawer = function () { setOpen(false); };
  })();

  /* ---------------------------------------------------------
     8. Âncoras suaves
  --------------------------------------------------------- */
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href');
    if (!id || id === '#') return;
    var target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    if (document.body.classList.contains('nav-open') && window.__closeDrawer) {
      window.__closeDrawer();
      setTimeout(function () { scrollToEl(target); }, 420);
    } else {
      scrollToEl(target);
    }
  });

  /* ---------------------------------------------------------
     9. Marquee infinito (reage à direção do scroll)
  --------------------------------------------------------- */
  (function marquee() {
    var track = $('#marquee');
    if (!track) return;
    var group = $('.marquee__group', track);
    if (!group) return;

    for (var i = 0; i < 4; i++) track.appendChild(group.cloneNode(true));
    if (!hasGSAP || reduce) return;

    var w = group.offsetWidth;
    var tween = gsap.to(track, { x: -w, duration: 24, ease: 'none', repeat: -1,
      modifiers: { x: function (x) { return (parseFloat(x) % w) + 'px'; } } });

    var dir = 1, lastY = 0;
    window.addEventListener('scroll', function () {
      var y = window.pageYOffset;
      var d = y > lastY ? 1 : -1;
      if (d !== dir) { dir = d; gsap.to(tween, { timeScale: d, duration: .5 }); }
      lastY = y;
    }, { passive: true });

    window.addEventListener('resize', function () { w = group.offsetWidth; });
  })();

  /* ---------------------------------------------------------
     10. Acordeão de serviços
  --------------------------------------------------------- */
  (function pillars() {
    var wrap = $('#pillars');
    if (!wrap) return;
    var items = $$('.pillar', wrap);

    function setHeight(p, open) {
      var panel = $('.pillar__panel', p);
      var inner = $('.pillar__panel-in', p);
      var h = open ? inner.offsetHeight : 0;
      if (hasGSAP && !reduce) {
        gsap.to(panel, { height: h, duration: .6, ease: 'expo.inOut',
          onComplete: function () { if (window.ScrollTrigger) ScrollTrigger.refresh(); } });
        gsap.to($$('li', inner), open
          ? { opacity: 1, x: 0, duration: .5, stagger: .035, ease: 'power2.out', delay: .12 }
          : { opacity: 0, x: -10, duration: .2 });
      } else {
        panel.style.height = h ? 'auto' : '0px';
      }
    }

    items.forEach(function (p) {
      var open = p.classList.contains('is-open');
      var inner = $('.pillar__panel-in', p);
      if (hasGSAP && !reduce) gsap.set($$('li', inner), { opacity: open ? 1 : 0, x: open ? 0 : -10 });
      $('.pillar__panel', p).style.height = open ? inner.offsetHeight + 'px' : '0px';

      $('.pillar__head', p).addEventListener('click', function () {
        var isOpen = p.classList.contains('is-open');
        items.forEach(function (o) {
          if (o === p) return;
          if (o.classList.contains('is-open')) {
            o.classList.remove('is-open');
            $('.pillar__head', o).setAttribute('aria-expanded', 'false');
            setHeight(o, false);
          }
        });
        p.classList.toggle('is-open', !isOpen);
        this.setAttribute('aria-expanded', String(!isOpen));
        setHeight(p, !isOpen);
      });
    });

    window.addEventListener('resize', function () {
      items.forEach(function (p) {
        if (!p.classList.contains('is-open')) return;
        $('.pillar__panel', p).style.height = $('.pillar__panel-in', p).offsetHeight + 'px';
      });
    });
  })();

  /* ---------------------------------------------------------
     11. Botões magnéticos (desktop)
  --------------------------------------------------------- */
  (function magnetic() {
    if (!hasGSAP || reduce || !window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
    $$('[data-magnetic]').forEach(function (el) {
      var strength = 0.28;
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        gsap.to(el, {
          x: (e.clientX - (r.left + r.width / 2)) * strength,
          y: (e.clientY - (r.top + r.height / 2)) * strength,
          duration: .5, ease: 'power3.out'
        });
      });
      el.addEventListener('mouseleave', function () {
        gsap.to(el, { x: 0, y: 0, duration: .7, ease: 'elastic.out(1,.4)' });
      });
    });
  })();

  /* ---------------------------------------------------------
     12. Formulário → WhatsApp (MVP sem backend)
  --------------------------------------------------------- */
  (function form() {
    var f = $('#contactForm');
    if (!f) return;
    var WA = '5531995100776'; // nº comercial — trocar se necessário

    function invalid(field, cond) {
      field.classList.toggle('is-invalid', cond);
      return cond;
    }

    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var nome = $('#nome'), tel = $('#telefone'), mail = $('#email');
      var bad = false;

      bad = invalid(nome.closest('.field'), nome.value.trim().length < 3) || bad;
      bad = invalid(tel.closest('.field'), tel.value.replace(/\D/g, '').length < 10) || bad;
      bad = invalid(mail.closest('.field'), mail.value.trim() !== '' && !/^\S+@\S+\.\S+$/.test(mail.value)) || bad;

      if (bad) {
        var first = $('.field.is-invalid', f);
        if (first && hasGSAP) gsap.fromTo(first, { x: -7 }, { x: 0, duration: .5, ease: 'elastic.out(1,.35)' });
        if (first) $('input,textarea,select', first).focus();
        return;
      }

      var msg =
        'Olá! Vim pelo site do Grupo GBR.\n\n' +
        'Nome: ' + nome.value.trim() + '\n' +
        'WhatsApp: ' + tel.value.trim() + '\n' +
        (mail.value.trim() ? 'E-mail: ' + mail.value.trim() + '\n' : '') +
        'Interesse: ' + $('#interesse').value + '\n' +
        ($('#mensagem').value.trim() ? 'Mensagem: ' + $('#mensagem').value.trim() : '');

      f.classList.add('is-sent');
      window.open('https://wa.me/' + WA + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
    });

    $$('input,textarea,select', f).forEach(function (el) {
      el.addEventListener('input', function () { el.closest('.field').classList.remove('is-invalid'); });
    });

    // Máscara simples de telefone
    var tel = $('#telefone');
    tel.addEventListener('input', function () {
      var v = tel.value.replace(/\D/g, '').slice(0, 11);
      if (v.length > 6) v = '(' + v.slice(0, 2) + ') ' + v.slice(2, v.length - 4) + '-' + v.slice(-4);
      else if (v.length > 2) v = '(' + v.slice(0, 2) + ') ' + v.slice(2);
      else if (v.length) v = '(' + v;
      tel.value = v;
    });
  })();

})();
