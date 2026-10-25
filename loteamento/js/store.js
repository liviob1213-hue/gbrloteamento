/* LoteVivo — dados, geometria, persistência e projeto de demonstração */
window.LV = window.LV || {};
(function (LV) {
  'use strict';

  /* ---------- status ---------- */
  LV.STATUS = {
    disponivel:   { label: 'Disponível',   color: '#3ccf6e' },
    reservado:    { label: 'Reservado',    color: '#f5b740' },
    vendido:      { label: 'Vendido',      color: '#ef5a5a' },
    indisponivel: { label: 'Indisponível', color: '#5b84e6' }
  };
  LV.STATUS_KEYS = Object.keys(LV.STATUS);

  LV.normStatus = function (s) {
    s = String(s || '').toLowerCase();
    if (s.startsWith('disp') || s === 'livre' || s === 'a venda' || s === 'à venda') return 'disponivel';
    if (s.startsWith('reserv')) return 'reservado';
    if (s.startsWith('vend')) return 'vendido';
    return LV.STATUS[s] ? s : 'indisponivel';
  };

  /* ---------- formatação ---------- */
  const nf = (d) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const NF = [nf(0), nf(1), nf(2)];
  LV.fmt = {
    brl: (v, d = 2) => 'R$ ' + NF[d].format(v || 0),
    num: (v, d = 0) => NF[d].format(v || 0),
    m2: (v) => NF[2].format(v || 0) + ' m²',
    pad: (n) => String(n).padStart(2, '0'),
    lotName: (l) => 'Quadra ' + l.quadra + ' · Lote ' + LV.fmt.pad(l.lote),
    lotCode: (l) => l.quadra + '-' + LV.fmt.pad(l.lote)
  };

  LV.parseMoney = function (s) {
    if (typeof s === 'number') return s;
    s = String(s || '').replace(/[^\d,.-]/g, '');
    if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    const v = parseFloat(s);
    return isFinite(v) ? v : 0;
  };

  /* ---------- geometria (coordenadas do projeto: x → direita, y → baixo) ---------- */
  const geo = LV.geo = {
    area(p) {
      let a = 0;
      for (let i = 0, n = p.length; i < n; i++) {
        const q = p[(i + 1) % n];
        a += p[i][0] * q[1] - q[0] * p[i][1];
      }
      return Math.abs(a) / 2;
    },
    centroid(p) {
      let a = 0, cx = 0, cy = 0;
      for (let i = 0, n = p.length; i < n; i++) {
        const q = p[(i + 1) % n];
        const f = p[i][0] * q[1] - q[0] * p[i][1];
        a += f; cx += (p[i][0] + q[0]) * f; cy += (p[i][1] + q[1]) * f;
      }
      if (Math.abs(a) < 1e-9) {
        const s = p.reduce((m, v) => [m[0] + v[0], m[1] + v[1]], [0, 0]);
        return [s[0] / p.length, s[1] / p.length];
      }
      return [cx / (3 * a), cy / (3 * a)];
    },
    bbox(p) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const v of p) { x0 = Math.min(x0, v[0]); y0 = Math.min(y0, v[1]); x1 = Math.max(x1, v[0]); y1 = Math.max(y1, v[1]); }
      return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
    },
    inset(p, d) {
      const c = geo.centroid(p);
      return p.map((v) => {
        const dx = v[0] - c[0], dy = v[1] - c[1], len = Math.hypot(dx, dy);
        const k = len > d * 2 ? (len - d) / len : 0.5;
        return [c[0] + dx * k, c[1] + dy * k];
      });
    },
    edges(p) {
      return p.map((a, i) => {
        const b = p[(i + 1) % p.length];
        return { a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
      });
    },
    pip(pt, p) {
      let inside = false;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1];
        if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    },
    simplify(pts, eps) {
      if (pts.length < 3) return pts.slice();
      const sq = (a, b, c) => {
        let x = b[0], y = b[1], dx = c[0] - x, dy = c[1] - y;
        if (dx || dy) {
          const t = ((a[0] - x) * dx + (a[1] - y) * dy) / (dx * dx + dy * dy);
          if (t > 1) { x = c[0]; y = c[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
        }
        dx = a[0] - x; dy = a[1] - y; return dx * dx + dy * dy;
      };
      const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
      const stack = [[0, pts.length - 1]];
      while (stack.length) {
        const [f, l] = stack.pop(); let max = 0, idx = 0;
        for (let i = f + 1; i < l; i++) { const d = sq(pts[i], pts[f], pts[l]); if (d > max) { max = d; idx = i; } }
        if (max > eps * eps) { keep[idx] = 1; stack.push([f, idx], [idx, l]); }
      }
      return pts.filter((_, i) => keep[i]);
    },
    hull(points) {
      const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (p.length < 3) return p;
      const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lo = [], up = [];
      for (const v of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], v) <= 0) lo.pop(); lo.push(v); }
      for (let i = p.length - 1; i >= 0; i--) { const v = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], v) <= 0) up.pop(); up.push(v); }
      up.pop(); lo.pop(); return lo.concat(up);
    }
  };

  /* posição de referência do lote (centro do polígono ou o pino) */
  LV.lotPoint = (l) => (l.poly && l.poly.length > 2 ? geo.centroid(l.poly) : l.pin || null);

  /* etiquetas um pouco menores no celular, onde o mapa cabe em menos espaço */
  LV.lblScale = () => (innerWidth < 760 ? 0.82 : 1);

  /* some com a etiqueta que cairia em cima de outra já colocada; os itens vêm em ordem de
     prioridade e "k" converte pixels de tela nas unidades do mapa */
  LV.declutter = function (items, k) {
    const kept = [];
    for (const it of items) {
      const c = it.c, hw = (it.w / 2 + 1) * k, hh = (it.h / 2) * k;
      let hit = false;
      for (const b of kept) { if (Math.abs(b.x - c[0]) < b.hw + hw && Math.abs(b.y - c[1]) < b.hh + hh) { hit = true; break; } }
      it.g.classList.toggle('off', hit);
      if (!hit) kept.push({ x: c[0], y: c[1], hw, hh });
    }
  };

  /* ordem natural das quadras: 01, 02, … 11, 30 (número quando dá, texto quando não) */
  LV.cmpQuadra = (a, b) => {
    const x = parseFloat(a), y = parseFloat(b);
    return isFinite(x) && isFinite(y) ? x - y : String(a).localeCompare(String(b));
  };

  /* lotes agrupados por quadra: onde cravar o número, a caixa da quadra e quantos estão livres */
  LV.quadrasOf = function (p) {
    const g = new Map();
    for (const l of p.lots) {
      const pt = LV.lotPoint(l);
      if (!pt) continue;
      if (!g.has(l.quadra)) g.set(l.quadra, { q: String(l.quadra), lots: [], pts: [], cx: 0, cy: 0, w: 0 });
      const e = g.get(l.quadra);
      const w = (l.poly && l.poly.length > 2 ? geo.area(l.poly) : 1) || 1;
      e.lots.push(l); e.cx += pt[0] * w; e.cy += pt[1] * w; e.w += w;
      if (l.poly && l.poly.length > 2) for (const v of l.poly) e.pts.push(v); else e.pts.push(pt);
    }
    return [...g.values()].map((e) => {
      const c = [e.cx / e.w, e.cy / e.w];
      // quadra em "L" ou em arco: o centro ponderado pode cair na rua, então encosta no lote mais perto
      if (!e.lots.some((l) => l.poly && l.poly.length > 2 && geo.pip(c, l.poly))) {
        let best = null, bd = Infinity;
        for (const l of e.lots) {
          const q = LV.lotPoint(l); if (!q) continue;
          const d = Math.hypot(q[0] - c[0], q[1] - c[1]);
          if (d < bd) { bd = d; best = q; }
        }
        if (best) { c[0] = best[0]; c[1] = best[1]; }
      }
      return { q: e.q, lots: e.lots, c, bbox: geo.bbox(e.pts), livres: e.lots.filter((l) => l.status === 'disponivel').length };
    }).sort((a, b) => LV.cmpQuadra(a.q, b.q));
  };
  LV.lotAreaCalc = (l, mpu) => (l.poly && l.poly.length > 2 ? geo.area(l.poly) * mpu * mpu : 0);

  LV.uid = () => Math.random().toString(36).slice(2, 10);

  /* ---------- planos padrão (espelham a tabela do empreendimento de referência) ---------- */
  LV.defaultPlans = () => [
    { id: 'investidor', nome: 'Investidor', entradaPct: 20, meses: 24, correcao: 'sem correção', jurosAm: 0, modo: 'linear', descontoPct: 0 },
    { id: 'curto', nome: 'Curto', entradaPct: 20, meses: 36, correcao: 'IPCA anual', jurosAm: 0, modo: 'linear', descontoPct: 0 },
    { id: 'normal', nome: 'Normal', entradaPct: 10, meses: 120, correcao: 'poupança anual + 0,5% a.m.', jurosAm: 0.5, modo: 'linear', descontoPct: 0 }
  ];

  /* ---------- persistência (IndexedDB: cabe imagem grande, ao contrário do localStorage) ---------- */
  const idb = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('lotevivo', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { this.db = r.result; res(r.result); };
        r.onerror = () => rej(r.error);
      });
    },
    async op(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const st = db.transaction('kv', mode).objectStore('kv');
        const r = fn(st); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
    },
    get(k) { return this.op('readonly', (s) => s.get(k)); },
    set(k, v) { return this.op('readwrite', (s) => s.put(v, k)); },
    del(k) { return this.op('readwrite', (s) => s.delete(k)); }
  };

  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('lotevivo') : null;

  LV.store = {
    async loadDraft() { try { return (await idb.get('project')) || null; } catch (e) { return null; } },
    async save(project) {
      project.updatedAt = Date.now();
      try { await idb.set('project', project); } catch (e) { console.warn('Falha ao salvar', e); return false; }
      if (channel) channel.postMessage({ type: 'updated', at: project.updatedAt });
      return true;
    },
    async clear() { try { await idb.del('project'); } catch (e) {} },
    onUpdate(fn) { if (channel) channel.onmessage = (e) => e.data && e.data.type === 'updated' && fn(); },
    /* ordem: ?rascunho → rascunho do editor; senão projeto.json publicado; senão rascunho; senão demonstração */
    async load() {
      const q = new URLSearchParams(location.search);
      if (q.has('demo')) return LV.makeDemo();
      if (!q.has('rascunho')) {
        // vários loteamentos: ?p=nome abre projetos/nome.json; sem ?p, o projeto.json principal
        const slug = (q.get('p') || '').replace(/[^a-z0-9-]/gi, '');
        try {
          const r = await fetch(slug ? 'projetos/' + slug + '.json' : 'projeto.json', { cache: 'no-store' });
          if (r.ok) { const p = await r.json(); if (p && p.lots) return LV.migrate(p); }
        } catch (e) {}
      }
      const d = await this.loadDraft();
      return d ? LV.migrate(d) : LV.makeDemo();
    }
  };

  LV.migrate = function (p) {
    p.plans = p.plans && p.plans.length ? p.plans : LV.defaultPlans();
    p.mpu = p.mpu || (p.image ? 800 / Math.max(p.W, p.H) : 1);
    p.lots = (p.lots || []).map((l) => Object.assign({ id: LV.uid(), quadra: '1', lote: 1, status: 'disponivel', preco: 0, area: 0, tags: [] }, l));
    return p;
  };

  LV.download = function (name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type || 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  /* ---------- projeto de demonstração ---------- */
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  LV.rng = rng;

  LV.makeWarp = (w) => (x, y) => [x + w[0] * Math.sin(y / w[1] + w[2]), y + w[3] * Math.sin(x / w[4] + w[5])];

  LV.makeDemo = function () {
    const R = rng(11);
    const W = 900, H = 640;
    const warpP = [16, 105, 0.4, 13, 135, 1.1];
    const warp = LV.makeWarp(warpP);
    const blob = [[50, 110], [220, 42], [470, 30], [700, 48], [858, 140], [872, 380], [800, 585], [560, 618], [300, 604], [108, 545], [38, 330]];
    const lake = { x: 655, y: 335, rx: 82, ry: 56 };
    const ROAD = 16, LD = 44;
    const lots = [], zones = [];
    let q = 0, clube = null;
    const W2 = (pts) => pts.map((p) => warp(p[0], p[1]).map((v) => Math.round(v * 100) / 100));
    const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const inBlob = (x, y) => geo.pip([x, y], blob);
    const lakeD = (x, y) => Math.hypot((x - lake.x) / lake.rx, (y - lake.y) / lake.ry);

    for (let row = 0, y = 64; y + 2 * LD < H - 36; row++, y += 2 * LD + ROAD) {
      let x = 44 + (row % 2) * 34;
      while (true) {
        const n = 5 + Math.floor(R() * 4);
        const LW = [18, 20, 22, 20][Math.floor(R() * 4)];
        const QW = n * LW;
        if (x + QW > W - 30) break;
        const cell = rect(x, y, x + QW, y + 2 * LD);
        const cx = x + QW / 2, cy = y + LD;
        const allIn = cell.every((p) => inBlob(p[0], p[1]));
        if (!inBlob(cx, cy)) { x += QW + ROAD; continue; }
        if (lakeD(cx, cy) < 1.55) zones.push({ type: 'margem', poly: cell });
        else if (!clube && row === 2 && x < 330) { clube = { x: cx, y: cy }; zones.push({ type: 'clube', poly: cell }); }
        else if (!allIn || R() < 0.06) zones.push({ type: 'verde', poly: cell });
        else {
          q++;
          zones.push({ type: 'quadra', poly: cell, q });
          for (let k = 0; k < 2 * n; k++) {
            const top = k < n;
            const i = top ? k : 2 * n - 1 - k;
            const r = top ? rect(x + i * LW, y, x + (i + 1) * LW, y + LD) : rect(x + i * LW, y + LD, x + (i + 1) * LW, y + 2 * LD);
            const poly = W2(r);
            const area = geo.area(poly);
            const c = [x + (i + 0.5) * LW, top ? y + LD / 2 : y + 1.5 * LD];
            const esquina = i === 0 || i === n - 1;
            const dLake = Math.hypot(c[0] - lake.x, c[1] - lake.y);
            const tags = [];
            if (esquina) tags.push('Esquina');
            if (dLake < 210) tags.push('Vista para o lago');
            if (clube && Math.hypot(c[0] - clube.x, c[1] - clube.y) < 190) tags.push('Perto do clube');
            tags.push(top ? 'Frente norte' : 'Frente sul');
            const ppm = 330 * (1 + 0.22 * Math.max(0, 1 - dLake / 280)) * (esquina ? 1.07 : 1) * (top ? 1.05 : 1) * (0.95 + R() * 0.1);
            const s = R();
            lots.push({
              id: LV.uid(), quadra: String(q), lote: k + 1, poly,
              area: Math.round(area * 100) / 100, frente: LW, fundo: LD,
              preco: Math.round((area * ppm) / 100) * 100,
              status: s < 0.76 ? 'disponivel' : s < 0.84 ? 'reservado' : s < 0.97 ? 'vendido' : 'indisponivel',
              orientacao: top ? 'N' : 'S', tags, obs: ''
            });
          }
        }
        x += QW + ROAD;
      }
    }
    return {
      id: 'demo', name: 'Reserva Horizonte', subtitle: 'Loteamento residencial', city: 'Minas Gerais',
      W, H, mpu: 1, image: null, whatsapp: '',
      demo: { blob, lake, zones, warp: warpP, clube, portaria: [455, 606] },
      plans: LV.defaultPlans(), lots
    };
  };

  /* ---------- textura do terreno ---------- */
  LV.loadImage = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

  /* devolve um canvas com a "arte" do loteamento: a imagem enviada ou uma arte gerada */
  LV.groundCanvas = async function (p, maxW) {
    maxW = maxW || 3072;
    if (p.image) {
      const img = await LV.loadImage(p.image);
      const s = Math.min(1, maxW / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c;
    }
    const s = maxW / p.W;
    const c = document.createElement('canvas');
    c.width = maxW; c.height = Math.round(p.H * s);
    const g = c.getContext('2d');
    const R = rng(3);
    g.fillStyle = '#16231a'; g.fillRect(0, 0, c.width, c.height);
    canopy(g, R, 0, 0, c.width, c.height, 9000, s);
    g.save(); g.scale(s, s);
    if (p.demo) drawDemo(g, p, s, R); else drawGeneric(g, p, s);
    g.restore();
    const vg = g.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.35, c.width / 2, c.height / 2, c.width * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = vg; g.fillRect(0, 0, c.width, c.height);
    return c;
  };

  function canopy(g, R, x, y, w, h, n, s) {
    const cols = ['#1d3022', '#22382a', '#18291d', '#2a4230', '#203626'];
    for (let i = 0; i < n; i++) {
      g.fillStyle = cols[i % cols.length];
      g.beginPath(); g.arc(x + R() * w, y + R() * h, (1.5 + R() * 3.5) * s, 0, 7); g.fill();
    }
  }

  function densify(pts, closed, step) {
    const out = [];
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
    }
    if (!closed) out.push(pts[pts.length - 1]);
    return out;
  }
  LV.densify = densify;

  function pathOf(g, pts, warp, smooth) {
    const d = densify(pts, true, 6).map((v) => warp(v[0], v[1]));
    g.beginPath();
    if (smooth) {
      for (let i = 0; i < d.length; i++) {
        const a = d[i], b = d[(i + 1) % d.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (i === 0) g.moveTo(m[0], m[1]); else g.quadraticCurveTo(a[0], a[1], m[0], m[1]);
      }
      const a = d[0], b = d[1]; g.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    } else d.forEach((v, i) => (i ? g.lineTo(v[0], v[1]) : g.moveTo(v[0], v[1])));
    g.closePath();
  }

  function shrinkRect(poly, d) {
    const [a, , c] = [poly[0], poly[1], poly[2]];
    return [[a[0] + d, a[1] + d], [c[0] - d, a[1] + d], [c[0] - d, c[1] - d], [a[0] + d, c[1] - d]];
  }

  function trees(g, R, poly, warp, n) {
    const b = geo.bbox(poly);
    for (let i = 0; i < n; i++) {
      const x = b.x0 + R() * b.w, y = b.y0 + R() * b.h;
      const [wx, wy] = warp(x, y), r = 1.6 + R() * 2.6;
      g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.arc(wx + 0.8, wy + 0.9, r, 0, 7); g.fill();
      g.fillStyle = ['#2f5a2c', '#3b6b33', '#285026', '#467a3a'][i % 4]; g.beginPath(); g.arc(wx, wy, r, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.arc(wx - r * 0.3, wy - r * 0.3, r * 0.45, 0, 7); g.fill();
    }
  }

  function label(g, text, x, y, size, color) {
    g.font = '600 ' + size + 'px Inter, system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillText(text, x + 0.6, y + 0.6);
    g.fillStyle = color || 'rgba(255,255,255,.85)'; g.fillText(text, x, y);
  }

  function drawDemo(g, p, s, R) {
    const d = p.demo, warp = LV.makeWarp(d.warp);
    // asfalto dentro do perímetro
    pathOf(g, d.blob, warp, true);
    g.fillStyle = '#8e8a7f'; g.fill();
    g.lineWidth = 7; g.strokeStyle = '#26402b'; g.stroke();
    g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.25)'; g.stroke();
    for (const z of d.zones) {
      pathOf(g, z.poly, warp, false); g.fillStyle = '#d9d3c2'; g.fill(); // calçada
      const inner = shrinkRect(z.poly, 2.2);
      pathOf(g, inner, warp, false);
      if (z.type === 'quadra') { g.fillStyle = '#58733f'; g.fill(); }
      else if (z.type === 'verde' || z.type === 'margem') { g.fillStyle = '#3d6334'; g.fill(); trees(g, R, inner, warp, z.type === 'verde' ? 70 : 40); }
      else if (z.type === 'clube') {
        g.fillStyle = '#5f8a48'; g.fill();
        const b = geo.bbox(inner), cx = b.x0 + b.w / 2, cy = b.y0 + b.h / 2, [wx, wy] = warp(cx, cy);
        g.fillStyle = '#e9e4d6'; g.fillRect(wx - b.w * 0.36, wy - b.h * 0.32, b.w * 0.34, b.h * 0.3);
        const pg = g.createLinearGradient(wx, wy, wx + 40, wy + 20); pg.addColorStop(0, '#46c3e0'); pg.addColorStop(1, '#1f8fb8');
        g.fillStyle = pg; roundRect(g, wx + 4, wy - b.h * 0.25, b.w * 0.3, b.h * 0.22, 3); g.fill();
        g.fillStyle = '#c9a76a'; roundRect(g, wx - b.w * 0.38, wy + b.h * 0.08, b.w * 0.3, b.h * 0.26, 2); g.fill();
        trees(g, R, [[b.x0 + b.w * 0.55, b.y0 + b.h * 0.55], [b.x1, b.y0 + b.h * 0.55], [b.x1, b.y1], [b.x0 + b.w * 0.55, b.y1]], warp, 12);
        label(g, 'CLUBE', wx, wy + b.h * 0.42 - 2, 7);
      }
    }
    // lago
    const L = d.lake, [lx, ly] = warp(L.x, L.y);
    g.save(); g.translate(lx, ly); g.rotate(-0.12);
    g.beginPath(); g.ellipse(0, 0, L.rx + 5, L.ry + 5, 0, 0, 7); g.fillStyle = '#c9bd98'; g.fill();
    const lg = g.createRadialGradient(-L.rx * 0.3, -L.ry * 0.3, 4, 0, 0, L.rx);
    lg.addColorStop(0, '#3e8fb4'); lg.addColorStop(1, '#174a66');
    g.beginPath(); g.ellipse(0, 0, L.rx, L.ry, 0, 0, 7); g.fillStyle = lg; g.fill();
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.ellipse(-8, -6, L.rx * (0.3 + i * 0.15), L.ry * (0.25 + i * 0.13), 0, 3.6, 5.2); g.stroke(); }
    g.restore();
    label(g, 'LAGO', lx, ly, 9, 'rgba(255,255,255,.75)');
    // portaria
    const [px, py] = warp(d.portaria[0], d.portaria[1]);
    g.fillStyle = '#e9e4d6'; g.fillRect(px - 9, py - 4, 18, 8);
    g.fillStyle = '#c9a45c'; g.fillRect(px - 9, py - 4, 18, 2);
    label(g, 'PORTARIA', px, py + 11, 6);
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function drawGeneric(g, p) {
    const pts = []; p.lots.forEach((l) => l.poly && l.poly.forEach((v) => pts.push(v)));
    if (pts.length < 3) return;
    const h = geo.hull(pts), c = geo.centroid(h);
    const pad = Math.max(p.W, p.H) * 0.02;
    const big = h.map((v) => { const dx = v[0] - c[0], dy = v[1] - c[1], l = Math.hypot(dx, dy) || 1; return [v[0] + (dx / l) * pad, v[1] + (dy / l) * pad]; });
    g.beginPath(); big.forEach((v, i) => (i ? g.lineTo(v[0], v[1]) : g.moveTo(v[0], v[1]))); g.closePath();
    g.fillStyle = '#8e8a7f'; g.fill(); g.lineWidth = pad * 0.25; g.strokeStyle = '#26402b'; g.stroke();
    for (const l of p.lots) {
      if (!l.poly) continue;
      g.beginPath(); l.poly.forEach((v, i) => (i ? g.lineTo(v[0], v[1]) : g.moveTo(v[0], v[1]))); g.closePath();
      g.fillStyle = '#58733f'; g.fill(); g.lineWidth = pad * 0.04; g.strokeStyle = '#d9d3c2'; g.stroke();
    }
  }
})(window.LV);
