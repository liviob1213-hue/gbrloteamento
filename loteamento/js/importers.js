/* LoteVivo — importadores: KML/KMZ, satélite, CSV e varinha mágica */
window.LV = window.LV || {};
(function (LV) {
  'use strict';
  const geo = LV.geo;

  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  /* "Q31 L07", "Quadra 31 Lote 7", "31-07", "Q.31/L.07" */
  LV.parseQL = function (name) {
    const s = fold(name);
    let m = s.match(/q(?:uadra|d)?\.?\s*([a-z0-9]+)[^a-z0-9]+l(?:ote|t)?\.?\s*(\d+)/);
    if (m) return { quadra: m[1].replace(/^0+(?=\d)/, '').toUpperCase(), lote: +m[2] };
    m = s.match(/^\s*([a-z]?\d+)\s*[-/.\s]\s*(\d+)\s*$/);
    if (m) return { quadra: m[1].replace(/^0+(?=\d)/, '').toUpperCase(), lote: +m[2] };
    return null;
  };

  /* ---------------------------------------------------------------- KML / KMZ */
  LV.readKML = async function (file) {
    let text;
    if (/\.kmz$/i.test(file.name)) {
      if (!window.JSZip) throw new Error('Leitor de KMZ não carregou. Exporte como KML.');
      const zip = await JSZip.loadAsync(file);
      const k = Object.keys(zip.files).find((n) => /\.kml$/i.test(n));
      if (!k) throw new Error('Nenhum .kml dentro do KMZ');
      text = await zip.files[k].async('string');
    } else text = await file.text();
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Arquivo KML inválido');

    const parseCoords = (el) => (el ? el.textContent.trim().split(/\s+/).map((t) => t.split(',').map(Number)).filter((c) => c.length >= 2 && isFinite(c[0]) && isFinite(c[1])) : []);
    const items = [];
    for (const pm of doc.getElementsByTagName('Placemark')) {
      const nameEl = [...pm.children].find((c) => c.localName === 'name');
      const data = {};
      for (const d of pm.getElementsByTagName('Data')) { const v = d.getElementsByTagName('value')[0]; data[fold(d.getAttribute('name'))] = v ? v.textContent.trim() : ''; }
      for (const d of pm.getElementsByTagName('SimpleData')) data[fold(d.getAttribute('name'))] = d.textContent.trim();
      const desc = (pm.getElementsByTagName('description')[0] || {}).textContent || '';
      const base = { name: nameEl ? nameEl.textContent.trim() : '', data, desc };
      const polys = pm.getElementsByTagName('Polygon');
      if (polys.length) {
        for (const p of polys) {
          const outer = p.getElementsByTagName('outerBoundaryIs')[0] || p;
          const c = parseCoords(outer.getElementsByTagName('coordinates')[0]);
          if (c.length >= 3) items.push(Object.assign({ ring: c }, base));
        }
        continue;
      }
      const ls = pm.getElementsByTagName('LineString')[0];
      if (ls) {
        const c = parseCoords(ls.getElementsByTagName('coordinates')[0]);
        const f = c[0], l = c[c.length - 1];
        if (c.length >= 4 && Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-7) { items.push(Object.assign({ ring: c }, base)); continue; }
      }
      const pt = pm.getElementsByTagName('Point')[0];
      if (pt) { const c = parseCoords(pt.getElementsByTagName('coordinates')[0]); if (c.length) items.push(Object.assign({ point: c[0] }, base)); }
    }
    if (!items.length) throw new Error('Nenhum polígono ou ponto encontrado no KML');

    // projeção local em metros (equiretangular em torno do centro: erro desprezível na escala de um loteamento)
    const all = []; items.forEach((it) => (it.ring ? it.ring.forEach((c) => all.push(c)) : all.push(it.point)));
    const lon0 = all.reduce((s, c) => s + c[0], 0) / all.length, lat0 = all.reduce((s, c) => s + c[1], 0) / all.length;
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;
    const prj = (c) => [(c[0] - lon0) * kx, -(c[1] - lat0) * ky];
    const pts = all.map(prj), bb = geo.bbox(pts);
    const m = Math.max(bb.w, bb.h) * 0.08;
    const ox = bb.x0 - m, oy = bb.y0 - m;
    const P = (c) => { const v = prj(c); return [Math.round((v[0] - ox) * 100) / 100, Math.round((v[1] - oy) * 100) / 100]; };

    const lots = []; const seq = {};
    items.forEach((it, idx) => {
      const d = it.data;
      let ql = LV.parseQL(it.name) || LV.parseQL(d.codigo || d.code || d.id || '') || null;
      const q = d.quadra || d.q || d.qd || (ql && ql.quadra);
      const l = d.lote || d.l || d.lt || (ql && ql.lote);
      const quadra = q ? String(q).replace(/^0+(?=\d)/, '').toUpperCase() : '1';
      seq[quadra] = (seq[quadra] || 0) + 1;
      const lot = {
        id: LV.uid(), quadra, lote: l ? +String(l).replace(/\D/g, '') || seq[quadra] : seq[quadra],
        status: LV.normStatus(d.status || d.situacao || 'disponivel'),
        preco: LV.parseMoney(d.preco || d.valor || d.price || 0), tags: [], obs: ''
      };
      if (it.ring) {
        let ring = it.ring.map(P);
        const f = ring[0], z = ring[ring.length - 1];
        if (f[0] === z[0] && f[1] === z[1]) ring = ring.slice(0, -1);
        lot.poly = ring;
        lot.area = Math.round(geo.area(ring) * 100) / 100;
        Object.assign(lot, LV.measureSides(ring, 1));
      } else lot.pin = P(it.point);
      if (d.area) lot.area = LV.parseMoney(d.area);
      lots.push(lot);
    });
    return {
      W: Math.round((bb.w + 2 * m) * 100) / 100, H: Math.round((bb.h + 2 * m) * 100) / 100, mpu: 1, lots,
      geo: { lon0, lat0, kx, ky, ox, oy }
    };
  };

  /* frente = menor lado, fundo = maior lado (aproximação para lotes de 4 lados) */
  LV.measureSides = function (poly, mpu) {
    if (!poly || poly.length < 3 || poly.length > 8) return {};
    const e = geo.edges(poly).map((x) => x.len * mpu).sort((a, b) => a - b);
    return { frente: Math.round(e[0] * 10) / 10, fundo: Math.round(e[e.length - 1] * 10) / 10 };
  };

  /* ---------------------------------------------------------------- satélite (Esri World Imagery) */
  LV.satelliteFor = async function (p, onProgress) {
    if (!p.geo) throw new Error('Precisa de um projeto vindo de KML');
    const g = p.geo;
    const toLL = (x, y) => [g.lon0 + (x + g.ox) / g.kx, g.lat0 - (y + g.oy) / g.ky];
    const [lonA, latA] = toLL(0, 0), [lonB, latB] = toLL(p.W, p.H);
    const lon1 = Math.min(lonA, lonB), lon2 = Math.max(lonA, lonB), lat1 = Math.min(latA, latB), lat2 = Math.max(latA, latB);
    const tx = (lon, z) => ((lon + 180) / 360) * Math.pow(2, z);
    const ty = (lat, z) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z); };
    let z = 19;
    while (z > 10 && (Math.ceil(tx(lon2, z)) - Math.floor(tx(lon1, z))) * (Math.ceil(ty(lat1, z)) - Math.floor(ty(lat2, z))) > 140) z--;
    const x0 = Math.floor(tx(lon1, z)), x1 = Math.ceil(tx(lon2, z)), y0 = Math.floor(ty(lat2, z)), y1 = Math.ceil(ty(lat1, z));
    const c = document.createElement('canvas'); c.width = (x1 - x0) * 256; c.height = (y1 - y0) * 256;
    const ctx = c.getContext('2d');
    const jobs = []; let done = 0;
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) {
      jobs.push(new Promise((res) => {
        const im = new Image(); im.crossOrigin = 'anonymous';
        im.onload = () => { ctx.drawImage(im, (x - x0) * 256, (y - y0) * 256); done++; onProgress && onProgress(done / jobs.length); res(); };
        im.onerror = () => { done++; res(); };
        im.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
      }));
    }
    await Promise.all(jobs);
    const sx = (tx(lon1, z) - x0) * 256, sy = (ty(lat2, z) - y0) * 256;
    const sw = (tx(lon2, z) - tx(lon1, z)) * 256, sh = (ty(lat1, z) - ty(lat2, z)) * 256;
    const out = document.createElement('canvas');
    const k = Math.min(1, 4096 / Math.max(sw, sh));
    out.width = Math.round(sw * k); out.height = Math.round(sh * k);
    out.getContext('2d').drawImage(c, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.88);
  };

  /* ---------------------------------------------------------------- CSV */
  LV.parseCSV = function (text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const sep = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const head = rows.shift().map(fold);
    const col = (...names) => head.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
    const ix = {
      quadra: col('quadra', 'qd', 'q'), lote: col('lote', 'lt', 'l'), area: col('area', 'm2', 'metragem'),
      preco: col('preco', 'valor', 'price'), status: col('status', 'situacao'), frente: col('frente', 'testada'),
      fundo: col('fundo', 'profundidade'), obs: col('obs', 'observ'), tags: col('caracter', 'tags', 'destaque'), orientacao: col('orient', 'face')
    };
    if (ix.quadra < 0 || ix.lote < 0) throw new Error('A planilha precisa das colunas "quadra" e "lote"');
    return rows.filter((r) => r.some((c) => c.trim())).map((r) => {
      const g = (k) => (ix[k] >= 0 ? (r[ix[k]] || '').trim() : '');
      return {
        quadra: g('quadra').replace(/^0+(?=\d)/, '').toUpperCase(), lote: parseInt(g('lote'), 10),
        area: g('area') ? LV.parseMoney(g('area')) : null, preco: g('preco') ? LV.parseMoney(g('preco')) : null,
        status: g('status') ? LV.normStatus(g('status')) : null, frente: g('frente') ? LV.parseMoney(g('frente')) : null,
        fundo: g('fundo') ? LV.parseMoney(g('fundo')) : null, obs: g('obs') || null, orientacao: g('orientacao') || null,
        tags: g('tags') ? g('tags').split(/[|,;]/).map((t) => t.trim()).filter(Boolean) : null
      };
    }).filter((r) => r.quadra && r.lote);
  };

  LV.applyCSV = function (p, rows) {
    let upd = 0, add = 0;
    rows.forEach((r) => {
      let l = p.lots.find((x) => String(x.quadra).toUpperCase() === r.quadra && +x.lote === r.lote);
      if (!l) { l = { id: LV.uid(), quadra: r.quadra, lote: r.lote, status: 'disponivel', preco: 0, area: 0, tags: [], obs: '' }; p.lots.push(l); add++; } else upd++;
      for (const k of ['area', 'preco', 'status', 'frente', 'fundo', 'obs', 'orientacao', 'tags']) if (r[k] != null) l[k] = r[k];
    });
    return { upd, add };
  };

  LV.toCSV = function (p) {
    const head = ['quadra', 'lote', 'situacao', 'preco', 'area', 'frente', 'fundo', 'orientacao', 'caracteristicas', 'obs'];
    const q = (v) => { v = v == null ? '' : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const n = (v) => (v ? String(Math.round(v * 100) / 100).replace('.', ',') : '');
    const lines = p.lots.slice().sort((a, b) => String(a.quadra).localeCompare(String(b.quadra), 'pt', { numeric: true }) || a.lote - b.lote)
      .map((l) => [l.quadra, l.lote, LV.STATUS[l.status].label, n(l.preco), n(l.area), n(l.frente), n(l.fundo), l.orientacao || '', (l.tags || []).join(' | '), l.obs || ''].map(q).join(';'));
    return '﻿' + head.join(';') + '\n' + lines.join('\n');
  };

  /* ---------------------------------------------------------------- varinha mágica */
  /* preenche a região de cor parecida a partir do clique e devolve o contorno externo */
  LV.wand = function (img, sx, sy, tol) {
    const { data, width: w, height: h } = img;
    sx = Math.floor(sx); sy = Math.floor(sy);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return { err: 'Fora da imagem' };
    const i0 = (sy * w + sx) * 4, r0 = data[i0], g0 = data[i0 + 1], b0 = data[i0 + 2];
    const t2 = tol * tol * 3;
    const mask = new Uint8Array(w * h), stack = new Int32Array(w * h);
    let sp = 0, count = 0; const limit = w * h * 0.12;
    stack[sp++] = sy * w + sx; mask[sy * w + sx] = 1;
    while (sp) {
      const p = stack[--sp]; count++;
      if (count > limit) return { err: 'A região vazou para fora do lote. Diminua a tolerância ou desenhe à mão.' };
      const x = p % w, y = (p - x) / w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q < 0 || mask[q]) continue;
        const k = q * 4, dr = data[k] - r0, dg = data[k + 1] - g0, db = data[k + 2] - b0;
        if (dr * dr + dg * dg + db * db <= t2) { mask[q] = 1; stack[sp++] = q; }
      }
    }
    if (count < 30) return { err: 'Região pequena demais. Clique no meio do lote.' };
    // dilata 1px para encostar na linha divisória
    const m2 = mask.slice();
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x; if (mask[p]) continue;
      if (mask[p - 1] || mask[p + 1] || mask[p - w] || mask[p + w]) m2[p] = 1;
    }
    // primeiro pixel (mais acima, mais à esquerda)
    let s = -1; for (let p = 0; p < w * h; p++) if (m2[p]) { s = p; break; }
    const startX = s % w, startY = (s - startX) / w;
    const dx = [1, 1, 0, -1, -1, -1, 0, 1], dy = [0, 1, 1, 1, 0, -1, -1, -1];
    const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && m2[y * w + x];
    let x = startX, y = startY, d = 7; const pts = [[x, y]]; let guard = 0;
    do {
      let found = false; const st = (d + 6) % 8;
      for (let k = 0; k < 8; k++) { const nd = (st + k) % 8, nx = x + dx[nd], ny = y + dy[nd]; if (inside(nx, ny)) { x = nx; y = ny; d = nd; found = true; break; } }
      if (!found) break;
      pts.push([x, y]);
    } while (!(x === startX && y === startY) && ++guard < 2e6);
    const simp = geo.simplify(pts, Math.max(1.2, Math.max(w, h) / 2500));
    if (simp.length > 2 && simp[0][0] === simp[simp.length - 1][0] && simp[0][1] === simp[simp.length - 1][1]) simp.pop();
    if (simp.length < 3) return { err: 'Não consegui fechar o contorno' };
    return { poly: simp.map((v) => [v[0] + 0.5, v[1] + 0.5]), count };
  };
})(window.LV);
