/* LoteVivo — mapa 2D em SVG + pan/zoom compartilhado com o editor */
window.LV = window.LV || {};
(function (LV) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  LV.svg = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  LV.polyD = (p) => 'M' + p.map((v) => v[0].toFixed(2) + ',' + v[1].toFixed(2)).join('L') + 'Z';

  /* pan/zoom por viewBox: roda do mouse, arrastar, pinça */
  class PanZoom {
    constructor(svg, W, H, onChange) {
      this.svg = svg; this.W = W; this.H = H; this.onChange = onChange || (() => {});
      this.ptrs = new Map(); this.locked = false; this.onTap = null;
      this.fit();
      svg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const [x, y] = this.toUnits(e.clientX, e.clientY);
        this.zoomAt(x, y, Math.pow(1.0018, e.deltaY));
      }, { passive: false });
      svg.addEventListener('pointerdown', (e) => {
        if (e.button === 2) return;
        this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: e.target });
        if (this.ptrs.size === 2) this.pinch = this._pinch();
      });
      svg.addEventListener('pointermove', (e) => {
        const p = this.ptrs.get(e.pointerId);
        if (!p) return;
        if (this.ptrs.size === 1 && !this.locked) {
          if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 4) { p.moved = true; try { svg.setPointerCapture(e.pointerId); } catch (_) {} }
          if (p.moved) {
            const r = svg.getBoundingClientRect(), k = this.vb.w / r.width;
            const kk = Math.max(k, this.vb.h / r.height);
            this.vb.x -= (e.clientX - p.x) * kk; this.vb.y -= (e.clientY - p.y) * kk; this.apply();
          }
        }
        p.x = e.clientX; p.y = e.clientY;
        if (this.ptrs.size === 2 && this.pinch) {
          const n = this._pinch();
          const [x, y] = this.toUnits(n.cx, n.cy);
          this.zoomAt(x, y, this.pinch.d / n.d); this.pinch = n;
          this.ptrs.forEach((q) => (q.moved = true));
        }
      });
      const up = (e) => {
        const p = this.ptrs.get(e.pointerId);
        this.ptrs.delete(e.pointerId); if (this.ptrs.size < 2) this.pinch = null;
        if (p && !p.moved && this.onTap && e.type === 'pointerup') this.onTap(e, p.t);
      };
      svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
    }
    _pinch() { const [a, b] = [...this.ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; }
    toUnits(cx, cy) {
      const pt = this.svg.createSVGPoint(); pt.x = cx; pt.y = cy;
      const m = this.svg.getScreenCTM(); if (!m) return [0, 0];
      const r = pt.matrixTransform(m.inverse()); return [r.x, r.y];
    }
    scale() { const r = this.svg.getBoundingClientRect(); return Math.min(r.width / this.vb.w, r.height / this.vb.h) || 1; }
    zoomAt(x, y, f) {
      const minW = this.W / 40, maxW = this.W * 2.5;
      const nw = Math.min(maxW, Math.max(minW, this.vb.w * f)); f = nw / this.vb.w;
      this.vb.x = x - (x - this.vb.x) * f; this.vb.y = y - (y - this.vb.y) * f; this.vb.w *= f; this.vb.h *= f; this.apply();
    }
    zoom(f) { this.zoomAt(this.vb.x + this.vb.w / 2, this.vb.y + this.vb.h / 2, f); }
    fit(pad) { pad = pad == null ? 0.03 : pad; this.vb = { x: -this.W * pad, y: -this.H * pad, w: this.W * (1 + 2 * pad), h: this.H * (1 + 2 * pad) }; this.apply(); }
    /* enquadra uma área inteira (uma quadra, por exemplo), com folga ao redor */
    frame(bb, pad) {
      pad = pad || 1.55;
      const r = this.svg.getBoundingClientRect();
      const ar = (r.width && r.height ? r.width / r.height : this.W / this.H) || 1;
      let w = Math.max(bb.w, 1) * pad, h = Math.max(bb.h, 1) * pad;
      if (w / h < ar) w = h * ar; else h = w / ar;
      w = Math.min(this.W * 2.5, Math.max(this.W / 40, w)); h = w / ar;
      this.animateTo({ x: bb.x0 + bb.w / 2 - w / 2, y: bb.y0 + bb.h / 2 - h / 2, w, h });
    }
    focus(bb, minW) {
      const w = Math.max(bb.w * 3.5, minW || this.W / 8), h = Math.max(bb.h * 3.5, w * this.H / this.W);
      const cx = bb.x0 + bb.w / 2, cy = bb.y0 + bb.h / 2;
      this.animateTo({ x: cx - w / 2, y: cy - h / 2, w, h });
    }
    animateTo(to) {
      const from = Object.assign({}, this.vb), t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / 600), s = 1 - Math.pow(1 - k, 3);
        for (const key in to) this.vb[key] = from[key] + (to[key] - from[key]) * s;
        this.apply(); if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    apply() { this.svg.setAttribute('viewBox', [this.vb.x, this.vb.y, this.vb.w, this.vb.h].map((v) => v.toFixed(2)).join(' ')); this.onChange(this); }
  }
  LV.PanZoom = PanZoom;

  /* mapa público */
  class Map2D {
    constructor(el, hooks) {
      this.el = el; this.hooks = hooks || {};
      this.svg = LV.svg('svg', { class: 'map2d', preserveAspectRatio: 'xMidYMid meet' }, el);
      // o mapa nasce escondido (a aba abre no 3D): quando aparece ou muda de tamanho, os números são remedidos
      this._ro = new ResizeObserver(() => { if (this.pz) { this._qs = null; this._zoomed(this.pz); } });
      this._ro.observe(el);
    }
    async load(p) {
      this.p = p; this.svg.innerHTML = ''; this.paths = new Map(); this.lbls = [];
      const defs = LV.svg('defs', null, this.svg);
      const f = LV.svg('filter', { id: 'glow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
      LV.svg('feGaussianBlur', { stdDeviation: '3', result: 'b' }, f);
      const mg = LV.svg('feMerge', null, f); LV.svg('feMergeNode', { in: 'b' }, mg); LV.svg('feMergeNode', { in: 'SourceGraphic' }, mg);

      if (!this.bgURL || this.bgFor !== p) {
        const c = await LV.groundCanvas(p, 3072);
        if (this.bgURL && this.bgURL.startsWith('blob:')) URL.revokeObjectURL(this.bgURL);
        this.bgURL = await new Promise((res) => c.toBlob((b) => res(URL.createObjectURL(b)), 'image/jpeg', 0.9));
        this.bgFor = p;
      }
      LV.svg('image', { href: this.bgURL, x: 0, y: 0, width: p.W, height: p.H, preserveAspectRatio: 'none' }, this.svg);
      this.gLots = LV.svg('g', { class: 'lots' }, this.svg);
      this.gPins = LV.svg('g', { class: 'pins' }, this.svg);
      this.gLabels = LV.svg('g', { class: 'lbl' }, this.svg);
      const unit = Math.max(p.W, p.H) / 900;
      this.unit = unit;
      for (const l of p.lots) {
        const col = (LV.STATUS[l.status] || {}).color || '#888';
        let node;
        if (l.poly && l.poly.length > 2) {
          node = LV.svg('path', { d: LV.polyD(l.poly), fill: col, class: 'lot st-' + l.status }, this.gLots);
          const [cx, cy] = LV.geo.centroid(l.poly);
          const bb = LV.geo.bbox(l.poly);
          const fs = Math.min(bb.w, bb.h) * 0.42;
          const t = LV.svg('text', { x: cx, y: cy, 'font-size': fs.toFixed(2) }, this.gLabels); t.textContent = LV.fmt.pad(l.lote);
          this.lbls.push({ t, fs });
        } else if (l.pin) {
          const s = unit * 7;
          node = LV.svg('path', { d: `M${l.pin[0]},${l.pin[1]} c${-s * 0.25},${-s * 0.6} ${-s * 0.7},${-s * 0.75} ${-s * 0.7},${-s * 1.25} a${s * 0.7},${s * 0.7} 0 1 1 ${s * 1.4},0 c0,${s * 0.5} ${-s * 0.45},${s * 0.65} ${-s * 0.7},${s * 1.25}z`, fill: col, class: 'pin st-' + l.status }, this.gPins);
        } else continue;
        node.dataset.id = l.id;
        this.paths.set(l.id, node);
      }
      this._quadras(p);
      this.pz = new PanZoom(this.svg, p.W, p.H, (pz) => this._zoomed(pz));
      this.pz.onTap = (e, t) => {
        const qg = t && t.closest && t.closest('g.q');
        if (qg) { const q = qg.dataset.q; if (this.hooks.onQuadra) this.hooks.onQuadra(q); else this.focusQuadra(q); return; }
        const id = t && t.dataset && t.dataset.id;
        if (this.hooks.onSelect) this.hooks.onSelect(id ? p.lots.find((l) => l.id === id) : null);
      };
      this.svg.onpointermove = (e) => {
        const id = e.target.dataset && e.target.dataset.id;
        if (this.hooks.onHover) this.hooks.onHover(id ? p.lots.find((l) => l.id === id) : null, e.clientX, e.clientY);
      };
      this.svg.onpointerleave = () => this.hooks.onHover && this.hooks.onHover(null);
      if (this.filter) this.setFilter(this.filter);
      if (this.sel) this.select(this.sel, false);
    }
    /* número da quadra: etiqueta de tamanho fixo na tela, para ser lida de longe e levar o zoom até lá */
    _quadras(p) {
      this.gQuad = LV.svg('g', { class: 'quads' }, this.svg);
      this._qs = null;
      this.quads = LV.quadrasOf(p).map((qd) => {
        const g = LV.svg('g', { class: 'q' }, this.gQuad);
        g.dataset.q = qd.q;
        const txt = 'Q' + qd.q, w = 13 + txt.length * 8.4, h = 22;
        // alvo invisível um pouco maior que a etiqueta, para o toque no celular
        LV.svg('rect', { class: 'hit', x: (-w / 2 - 7).toFixed(1), y: (-h / 2 - 6).toFixed(1), width: (w + 14).toFixed(1), height: h + 12, rx: 14 }, g);
        LV.svg('rect', { x: (-w / 2).toFixed(1), y: (-h / 2).toFixed(1), width: w.toFixed(1), height: h, rx: h / 2 }, g);
        const t = LV.svg('text', { x: 0, y: 0 }, g); t.textContent = txt;
        const tip = LV.svg('title', null, g);
        tip.textContent = 'Quadra ' + qd.q + ' · ' + qd.livres + ' de ' + qd.lots.length + ' lotes livres';
        return { qd, g, w, h, c: qd.c };
      });
      // as quadras maiores ficam com a vez quando duas etiquetas disputam o mesmo lugar
      this.qOrder = this.quads.slice().sort((a, b) => b.qd.lots.length - a.qd.lots.length);
    }
    focusQuadra(q) {
      const it = this.quads && this.quads.find((x) => x.qd.q === String(q));
      if (it && this.pz) this.pz.frame(it.qd.bbox);
    }
    _zoomed(pz) {
      const s = pz.scale();
      this.svg.classList.toggle('z-lbl', s * this.unit > 2.4);
      if (!this.quads || Math.abs(s - (this._qs || 0)) < 1e-4) return;
      this._qs = s;
      const k = (LV.lblScale() / s).toFixed(4);
      this.quads.forEach(({ qd, g }) => g.setAttribute('transform', 'translate(' + qd.c[0].toFixed(1) + ',' + qd.c[1].toFixed(1) + ') scale(' + k + ')'));
      LV.declutter(this.qOrder, +k);
      // o número do lote acompanha o tamanho do lote, mas sem virar um letreiro quando o zoom entra fundo
      const max = 20 / s;
      this.lbls.forEach((o) => o.t.setAttribute('font-size', Math.min(o.fs, max).toFixed(2)));
    }
    setFilter(ids) {
      this.filter = ids;
      this.paths.forEach((n, id) => n.classList.toggle('dim', !!ids && !ids.has(id)));
      if (this.quads) this.quads.forEach(({ qd, g }) => g.classList.toggle('dim', !!ids && !qd.lots.some((l) => ids.has(l.id))));
    }
    setMode(m) {
      this.mode = m;
      const lots = this.p.lots.filter((l) => l.area && l.preco);
      const v = lots.map((l) => l.preco / l.area), lo = Math.min(...v), hi = Math.max(...v);
      const ramp = ['#19b3a6', '#7fd36b', '#f2c14e', '#ff7a45'];
      this.p.lots.forEach((l) => {
        const n = this.paths.get(l.id); if (!n) return;
        let c = (LV.STATUS[l.status] || {}).color;
        if (m === 'valor') {
          if (l.status !== 'disponivel' || !l.area) c = '#5d6166';
          else {
            const t = hi > lo ? ((l.preco / l.area - lo) / (hi - lo)) * 3 : 1.5, i = Math.min(2, Math.floor(t));
            c = mix(ramp[i], ramp[i + 1], t - i);
          }
        }
        n.setAttribute('fill', c);
      });
    }
    select(id, fly) {
      this.sel = id;
      this.paths.forEach((n, k) => n.classList.toggle('sel', k === id));
      const l = id && this.p.lots.find((x) => x.id === id);
      if (l && fly !== false) {
        const bb = l.poly ? LV.geo.bbox(l.poly) : { x0: l.pin[0] - 5, y0: l.pin[1] - 5, w: 10, h: 10 };
        this.pz.focus(bb, this.p.W / 6);
      }
      const n = id && this.paths.get(id); if (n) n.parentNode.appendChild(n);
    }
  }
  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
    return 'rgb(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ')';
  }
  LV.Map2D = Map2D;
})(window.LV);
