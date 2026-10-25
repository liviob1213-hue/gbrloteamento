/* LoteVivo — modo Realista: a planta e os lotes registrados sobre a foto aérea real */
window.LV = window.LV || {};
(function (LV) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  /* ---------- homografia (plano da planta → pixels da foto) ---------- */
  LV.homography = function (src, dst) {
    const A = [], b = [];
    for (let i = 0; i < src.length; i++) {
      const [x, y] = src[i], [X, Y] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.push(X);
      A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.push(Y);
    }
    // mínimos quadrados: resolve (AᵀA) h = Aᵀb  (8×8), funciona com 4+ pares
    const n = 8, N = new Array(n).fill(0).map(() => new Array(n + 1).fill(0));
    for (let i = 0; i < A.length; i++) for (let r = 0; r < n; r++) { for (let c = 0; c < n; c++) N[r][c] += A[i][r] * A[i][c]; N[r][n] += A[i][r] * b[i]; }
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(N[r][c]) > Math.abs(N[p][c])) p = r;
      [N[c], N[p]] = [N[p], N[c]]; const pv = N[c][c] || 1e-9;
      for (let k = c; k <= n; k++) N[c][k] /= pv;
      for (let r = 0; r < n; r++) { if (r === c) continue; const f = N[r][c]; for (let k = c; k <= n; k++) N[r][k] -= f * N[c][k]; }
    }
    const h = N.map((r) => r[n]); return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  };
  LV.applyH = function (H, x, y) { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; };
  LV.matrix3d = function (H) {
    return `matrix3d(${H[0]},${H[3]},0,${H[6]}, ${H[1]},${H[4]},0,${H[7]}, 0,0,1,0, ${H[2]},${H[5]},0,${H[8]})`;
  };
  LV.realPoints = function (p) {
    const r = p && p.realista;
    if (r && r.points && r.points.length >= 4) return r.points;
    return null;
  };
  LV.realH = function (p) {
    const pts = LV.realPoints(p); if (!pts) return null;
    return LV.homography(pts.map((q) => [q[0], q[1]]), pts.map((q) => [q[2], q[3]]));
  };

  /* ---------- pan/zoom por transform CSS (serve para camadas mistas: img + img matrix3d + svg) ---------- */
  class WorldPan {
    constructor(el, world, W, H, onTap) {
      this.el = el; this.world = world; this.W = W; this.H = H; this.onTap = onTap;
      this.s = 1; this.x = 0; this.y = 0; this.ptrs = new Map();
      this.fit();
      el.addEventListener('wheel', (e) => { e.preventDefault(); const r = el.getBoundingClientRect(); this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.pow(1.0017, -e.deltaY)); }, { passive: false });
      el.addEventListener('pointerdown', (e) => { this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: e.target }); if (this.ptrs.size === 2) this.pinch = this._pinch(); });
      el.addEventListener('pointermove', (e) => {
        const p = this.ptrs.get(e.pointerId); if (!p) return;
        if (this.ptrs.size === 1) { if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 4) { p.moved = true; try { el.setPointerCapture(e.pointerId); } catch (_) {} } if (p.moved) { this.x += e.clientX - p.x; this.y += e.clientY - p.y; this.apply(); } }
        p.x = e.clientX; p.y = e.clientY;
        if (this.ptrs.size === 2 && this.pinch) { const n = this._pinch(); const r = el.getBoundingClientRect(); this.zoomAt(n.cx - r.left, n.cy - r.top, n.d / this.pinch.d); this.pinch = n; this.ptrs.forEach((q) => (q.moved = true)); }
      });
      const up = (e) => { const p = this.ptrs.get(e.pointerId); this.ptrs.delete(e.pointerId); if (this.ptrs.size < 2) this.pinch = null; if (p && !p.moved && this.onTap && e.type === 'pointerup') this.onTap(e, p.t); };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      this._ro = new ResizeObserver(() => this.clamp()); this._ro.observe(el);
    }
    _pinch() { const [a, b] = [...this.ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; }
    fit() { const r = this.el.getBoundingClientRect(); const s = Math.max(r.width / this.W, r.height / this.H); this.s = s; this.x = (r.width - this.W * s) / 2; this.y = (r.height - this.H * s) / 2; this.min = s; this.apply(); }
    zoomAt(cx, cy, f) { const ns = Math.min(this.min * 8, Math.max(this.min, this.s * f)); f = ns / this.s; this.x = cx - (cx - this.x) * f; this.y = cy - (cy - this.y) * f; this.s = ns; this.clamp(); }
    clamp() { const r = this.el.getBoundingClientRect(); const w = this.W * this.s, h = this.H * this.s; this.x = w <= r.width ? (r.width - w) / 2 : Math.min(0, Math.max(r.width - w, this.x)); this.y = h <= r.height ? (r.height - h) / 2 : Math.min(0, Math.max(r.height - h, this.y)); this.apply(); }
    apply() { this.world.style.transform = `translate(${this.x.toFixed(2)}px,${this.y.toFixed(2)}px) scale(${this.s.toFixed(5)})`; if (this.onChange) this.onChange(this); }
    toWorld(cx, cy) { const r = this.el.getBoundingClientRect(); return [(cx - r.left - this.x) / this.s, (cy - r.top - this.y) / this.s]; }
    focus(bx, by, bw, bh, pad) {
      pad = pad || 3;
      const r = this.el.getBoundingClientRect(); const s = Math.min(this.min * 8, Math.max(this.min * 1.6, Math.min(r.width / (bw * pad), r.height / (bh * pad))));
      const from = { s: this.s, x: this.x, y: this.y }; const cx = bx + bw / 2, cy = by + bh / 2;
      const to = { s, x: r.width / 2 - cx * s, y: r.height / 2 - cy * s }; const t0 = performance.now();
      const step = (now) => { const k = Math.min(1, (now - t0) / 550), e = 1 - Math.pow(1 - k, 3); this.s = from.s + (to.s - from.s) * e; this.x = from.x + (to.x - from.x) * e; this.y = from.y + (to.y - from.y) * e; this.apply(); if (k < 1) requestAnimationFrame(step); else this.clamp(); };
      requestAnimationFrame(step);
    }
  }
  LV.WorldPan = WorldPan;

  /* ---------- visualização Realista ---------- */
  class RealScene {
    constructor(el, hooks) { this.el = el; this.hooks = hooks || {}; this.blend = 0.65; this.sel = null; this.mode = 'status'; }
    async load(p) {
      this.p = p; this.el.innerHTML = '';
      const r = p.realista; const H = LV.realH(p);
      if (!r || !H) { this.el.innerHTML = '<div class="real-empty">A foto aérea ainda não foi calibrada no editor.</div>'; return; }
      this.H = H; this.W = r.w; this.Hh = r.h;
      const world = this.world = document.createElement('div'); world.className = 'rz-world'; world.style.width = r.w + 'px'; world.style.height = r.h + 'px';
      const aer = document.createElement('img'); aer.className = 'rz-aerial'; aer.src = r.image; aer.draggable = false;
      const plan = this.plan = document.createElement('img'); plan.className = 'rz-plan'; plan.src = p.image || ('mapas/' + (r.planImage || '')); plan.draggable = false;
      plan.style.transform = LV.matrix3d(H); plan.style.width = p.W + 'px'; plan.style.height = p.H + 'px';
      const svg = this.svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'rz-lots'); svg.setAttribute('viewBox', `0 0 ${r.w} ${r.h}`); svg.setAttribute('preserveAspectRatio', 'none');
      world.appendChild(aer); world.appendChild(plan); world.appendChild(svg);
      this.el.appendChild(world);
      this._lots(svg, H, p);
      this._labels(svg, H, p);
      this.pan = new LV.WorldPan(this.el, world, r.w, r.h, (e, t) => {
        const qg = t && t.closest && t.closest('g.q');
        if (qg) { const q = qg.dataset.q; if (this.hooks.onQuadra) this.hooks.onQuadra(q); else this.focusQuadra(q); return; }
        const id = t && t.dataset && t.dataset.id;
        if (this.hooks.onSelect) this.hooks.onSelect(id ? p.lots.find((l) => l.id === id) : null);
      });
      this.pan.onChange = (pan) => this._zoomed(pan);
      this._zoomed(this.pan);
      this.setBlend(this.blend); this.setMode(this.mode);
      if (this.sel) this.select(this.sel, false);
      if (this.hooks.onReady) this.hooks.onReady();
    }
    _lots(svg, H, p) {
      this.paths = new Map();
      const g = el('g', { class: 'rz-lotg' }, svg);
      for (const l of p.lots) {
        if (!l.poly || l.poly.length < 3) continue;
        const d = 'M' + l.poly.map((v) => LV.applyH(H, v[0], v[1]).map((n) => n.toFixed(1)).join(',')).join('L') + 'Z';
        const col = (LV.STATUS[l.status] || {}).color || '#888';
        const n = el('path', { d, fill: col, class: 'rz-lot st-' + l.status }, g); n.dataset.id = l.id;
        this.paths.set(l.id, n);
      }
    }

    /* numeração sobre a foto: quadra sempre à vista, número do lote quando o zoom entra */
    _labels(svg, H, p) {
      this.gLbl = el('g', { class: 'rz-lbl' }, svg);
      this.gQuad = el('g', { class: 'rz-quads' }, svg);
      this.lbls = []; this._qs = null;
      for (const l of p.lots) {
        if (!l.poly || l.poly.length < 3) continue;
        const pts = l.poly.map((v) => LV.applyH(H, v[0], v[1]));
        const c = LV.geo.centroid(pts), bb = LV.geo.bbox(pts), fs = Math.min(bb.w, bb.h) * 0.42;
        const t = el('text', { x: c[0].toFixed(1), y: c[1].toFixed(1), 'font-size': fs.toFixed(2) }, this.gLbl);
        t.textContent = LV.fmt.pad(l.lote);
        this.lbls.push({ t, fs });
      }
      this.quads = LV.quadrasOf(p).map((qd) => {
        const g = el('g', { class: 'q' }, this.gQuad); g.dataset.q = qd.q;
        const txt = 'Q' + qd.q, w = 13 + txt.length * 8.4, h = 22;
        el('rect', { class: 'hit', x: (-w / 2 - 7).toFixed(1), y: (-h / 2 - 6).toFixed(1), width: (w + 14).toFixed(1), height: h + 12, rx: 14 }, g);
        el('rect', { x: (-w / 2).toFixed(1), y: (-h / 2).toFixed(1), width: w.toFixed(1), height: h, rx: h / 2 }, g);
        el('text', { x: 0, y: 0 }, g).textContent = txt;
        el('title', null, g).textContent = 'Quadra ' + qd.q + ' · ' + qd.livres + ' de ' + qd.lots.length + ' lotes livres';
        const pts = [];
        qd.lots.forEach((l) => { if (l.poly) l.poly.forEach((v) => pts.push(LV.applyH(H, v[0], v[1]))); });
        return { qd, g, w, h, c: LV.applyH(H, qd.c[0], qd.c[1]), bbox: pts.length ? LV.geo.bbox(pts) : null };
      });
      this.qOrder = this.quads.slice().sort((a, b) => b.qd.lots.length - a.qd.lots.length);
    }
    _zoomed(pan) {
      const s = pan.s;
      if (!isFinite(s) || s <= 0) return; // a aba ainda está escondida: mede quando aparecer
      this.el.classList.toggle('z-lbl', s > (pan.min || s) * 2.1);
      if (!this.quads || Math.abs(s - (this._qs || 0)) < 1e-5) return;
      this._qs = s;
      const k = (LV.lblScale() / s).toFixed(5);
      this.quads.forEach((o) => o.g.setAttribute('transform', 'translate(' + o.c[0].toFixed(1) + ',' + o.c[1].toFixed(1) + ') scale(' + k + ')'));
      LV.declutter(this.qOrder, +k);
      const max = 20 / s;
      this.lbls.forEach((o) => o.t.setAttribute('font-size', Math.min(o.fs, max).toFixed(2)));
    }
    focusQuadra(q) {
      const it = this.quads && this.quads.find((x) => x.qd.q === String(q));
      if (!it || !it.bbox || !this.pan) return;
      // a aba pode estar escondida (e sem medidas): guarda a quadra e enquadra quando ela abrir
      if (!this.el.getBoundingClientRect().width) { this._pendingQ = String(q); return; }
      this._pendingQ = null;
      this.pan.focus(it.bbox.x0, it.bbox.y0, it.bbox.w, it.bbox.h, 1.55);
    }
    setBlend(t) {
      this.blend = t;
      if (this.plan) this.plan.style.opacity = Math.max(0, (t - 0.15) / 0.85);        // planta só entra depois de 15%
      if (this.svg) this.svg.style.setProperty('--lotop', (0.22 + t * 0.5).toFixed(2)); // marcações ganham corpo com o projeto
      if (this.el) this.el.style.setProperty('--grade', (0.15 + t * 0.35).toFixed(2));
    }
    setMode(m) {
      this.mode = m; if (!this.paths) return;
      const lots = this.p.lots.filter((l) => l.area && l.preco); const v = lots.map((l) => l.preco / l.area), lo = Math.min(...v), hi = Math.max(...v);
      const ramp = ['#19b3a6', '#7fd36b', '#f2c14e', '#ff7a45'];
      this.p.lots.forEach((l) => { const n = this.paths.get(l.id); if (!n) return; let c = (LV.STATUS[l.status] || {}).color;
        if (m === 'valor') { if (l.status !== 'disponivel' || !l.area) c = '#5d6166'; else { const t = hi > lo ? ((l.preco / l.area - lo) / (hi - lo)) * 3 : 1.5, i = Math.min(2, Math.floor(t)); c = mix(ramp[i], ramp[i + 1], t - i); } }
        n.setAttribute('fill', c); });
    }
    setFilter(ids) {
      this.filter = ids;
      if (this.paths) this.paths.forEach((n, id) => n.classList.toggle('dim', !!ids && !ids.has(id)));
      if (this.quads) this.quads.forEach((o) => o.g.classList.toggle('dim', !!ids && !o.qd.lots.some((l) => ids.has(l.id))));
    }
    select(id, fly) {
      this.sel = id; if (id) this._pendingQ = null;
      if (!this.paths) return;
      this.paths.forEach((n, k) => n.classList.toggle('sel', k === id));
      const l = id && this.p.lots.find((x) => x.id === id);
      if (l && l.poly && fly !== false && this.pan) { const pts = l.poly.map((v) => LV.applyH(this.H, v[0], v[1])); const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); const x0 = Math.min(...xs), y0 = Math.min(...ys); this.pan.focus(x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0); }
      const n = id && this.paths.get(id); if (n) n.parentNode.appendChild(n);
    }
    reveal() { if (!this.plan) return; this.el.classList.add('revealing'); setTimeout(() => this.el.classList.remove('revealing'), 1400); }
    resize() {
      if (!this.pan) return;
      const r = this.el.getBoundingClientRect(); if (!r.width) return;
      if (!this.pan.s || !isFinite(this.pan.s) || this.pan.s <= 0 || !this._fit) { this.pan.W = this.W; this.pan.H = this.Hh; this.pan.fit(); this._fit = true; } else this.pan.clamp();
      if (this._pendingQ) this.focusQuadra(this._pendingQ);
    }
  }
  function mix(a, b, t) { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t); return 'rgb(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ')'; }
  LV.RealScene = RealScene;

  /* ---------- calibrador (editor): arraste os pontos sobre a foto até as ruas baterem ---------- */
  class Calibrator {
    constructor(el, p, onChange) {
      this.el = el; this.p = p; this.onChange = onChange || (() => {});
      const r = p.realista;
      this.pts = r.points.map((q) => q.slice());
      el.innerHTML = '';
      const world = this.world = document.createElement('div'); world.className = 'rz-world'; world.style.width = r.w + 'px'; world.style.height = r.h + 'px';
      const aer = document.createElement('img'); aer.className = 'rz-aerial'; aer.src = r.image; aer.draggable = false;
      const plan = this.plan = document.createElement('img'); plan.className = 'rz-plan cal'; plan.src = p.image; plan.draggable = false; plan.style.width = p.W + 'px'; plan.style.height = p.H + 'px';
      const svg = this.svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'rz-lots'); svg.setAttribute('viewBox', `0 0 ${r.w} ${r.h}`); svg.setAttribute('preserveAspectRatio', 'none');
      world.appendChild(aer); world.appendChild(plan); world.appendChild(svg);
      this.handles = document.createElement('div'); this.handles.className = 'rz-handles';
      el.appendChild(world); el.appendChild(this.handles);
      this.pan = new LV.WorldPan(el, world, r.w, r.h, null);
      // a página pode medir zero antes do primeiro layout, e aí a foto fica invisível:
      // quando o tamanho chega, refaz o enquadramento
      this._ro = new ResizeObserver(() => {
        if (this.pan.s > 0 && isFinite(this.pan.s)) return;
        if (!el.getBoundingClientRect().width) return;
        this.pan.fit(); this._handlePos();
      });
      this._ro.observe(el);
      this.opacity = 0.5;
      this._apply();
      this._mkHandles();
      const redraw = () => { this._handlePos(); }; this.pan._ro && null;
      el.addEventListener('pointermove', redraw, true); el.addEventListener('wheel', () => setTimeout(redraw, 0), true);
    }
    _H() { return LV.homography(this.pts.map((q) => [q[0], q[1]]), this.pts.map((q) => [q[2], q[3]])); }
    _apply() {
      const H = this.H = this._H();
      this.plan.style.transform = LV.matrix3d(H); this.plan.style.opacity = this.opacity;
      // contornos dos lotes para conferência
      this.svg.innerHTML = '';
      this.p.lots.forEach((l) => { if (!l.poly) return; const d = 'M' + l.poly.map((v) => LV.applyH(H, v[0], v[1]).map((n) => n.toFixed(1)).join(',')).join('L') + 'Z'; const n = document.createElementNS(NS, 'path'); n.setAttribute('d', d); n.setAttribute('class', 'rz-lot cal'); this.svg.appendChild(n); });
    }
    setOpacity(o) { this.opacity = o; this.plan.style.opacity = o; }
    _mkHandles() {
      this.handles.innerHTML = '';
      this.hEls = this.pts.map((p, i) => { const h = document.createElement('div'); h.className = 'rz-h'; h.textContent = i + 1; this.handles.appendChild(h); this._drag(h, i); return h; });
      this._handlePos();
    }
    _handlePos() { this.hEls && this.hEls.forEach((h, i) => { const s = this.pan.s, x = this.pts[i][2] * s + this.pan.x, y = this.pts[i][3] * s + this.pan.y; h.style.left = x + 'px'; h.style.top = y + 'px'; }); }
    _drag(h, i) {
      h.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault(); h.setPointerCapture(e.pointerId);
        const move = (ev) => { const w = this.pan.toWorld(ev.clientX, ev.clientY); this.pts[i][2] = Math.round(w[0]); this.pts[i][3] = Math.round(w[1]); this._apply(); this._handlePos(); };
        const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); this.onChange(this.pts.map((q) => q.slice())); };
        h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
      });
    }
    addPoint() { const H = this._H(); const cx = this.p.W / 2, cy = this.p.H / 2; const a = LV.applyH(H, cx, cy); this.pts.push([Math.round(cx), Math.round(cy), Math.round(a[0]), Math.round(a[1])]); this._apply(); this._mkHandles(); this.onChange(this.pts.map((q) => q.slice())); }
    points() { return this.pts.map((q) => q.slice()); }
  }
  LV.Calibrator = Calibrator;
})(window.LV);
