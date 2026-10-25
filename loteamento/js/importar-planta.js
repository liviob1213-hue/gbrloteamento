/*
 * LoteVivo — importador "KMZ + PDF da planta".
 *
 * KMZ/KML (do CAD georreferenciado) traz o desenho exato de cada lote, mas sem número.
 * O PDF da planta traz os números de quadra e lote como texto vetorial.
 * Aqui os dois são alinhados automaticamente e cada polígono recebe sua quadra, lote e área.
 *
 * Roda no navegador (editor) e no Node (ferramenta de linha de comando). Sem dependências:
 * quem chama entrega o texto do KML e os itens de texto do PDF (pdf.js getTextContent).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.LV = root.LV || {}; root.LV.planta = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------ geometria básica */
  const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(a) / 2; };
  const centroid = (p) => { let a = 0, x = 0, y = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; const f = p[i][0] * q[1] - q[0] * p[i][1]; a += f; x += (p[i][0] + q[0]) * f; y += (p[i][1] + q[1]) * f; } return Math.abs(a) < 1e-9 ? p[0] : [x / (3 * a), y / (3 * a)]; };
  const pip = (pt, p) => { let ins = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
  const bbox = (p) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const v of p) { if (v[0] < x0) x0 = v[0]; if (v[0] > x1) x1 = v[0]; if (v[1] < y0) y0 = v[1]; if (v[1] > y1) y1 = v[1]; } return { x0, y0, x1, y1 }; };
  const brNum = (s) => parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

  /* ------------------------------------------------------------ KML */
  const coordsOf = (s) => s.trim().split(/\s+/).map((t) => t.split(',').map(Number)).filter((c) => c.length >= 2 && isFinite(c[0]) && isFinite(c[1]));

  /** Lê as camadas do KML (por nome de Placemark/Folder). Projeta para metros locais: x leste, y norte. */
  function parseKml(text) {
    const pms = []; const re = /<Placemark[\s\S]*?<\/Placemark>/g; let m;
    while ((m = re.exec(text))) {
      const b = m[0];
      const name = ((b.match(/<name>([\s\S]*?)<\/name>/) || [])[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      const polys = [...b.matchAll(/<Polygon>[\s\S]*?<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)].map((x) => coordsOf(x[1]));
      const lines = [...b.matchAll(/<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)].map((x) => coordsOf(x[1]));
      pms.push({ name, polys, lines });
    }
    // camada de lotes: a de mais polígonos com tamanho típico de lote, ou a que se chama "LOTES"
    const lotLayer = pms.find((p) => /^LOTES?$/.test(fold(p.name))) ||
      pms.filter((p) => p.polys.length >= 10).sort((a, b) => b.polys.length - a.polys.length)[0];
    if (!lotLayer) throw new Error('Não achei a camada de lotes (polígonos) no KML');
    const all = lotLayer.polys.flat();
    const lon0 = all.reduce((s, c) => s + c[0], 0) / all.length, lat0 = all.reduce((s, c) => s + c[1], 0) / all.length;
    // metros por grau no elipsoide WGS84 (na latitude do loteamento)
    const φ = (lat0 * Math.PI) / 180;
    const ky = 111132.954 - 559.822 * Math.cos(2 * φ) + 1.175 * Math.cos(4 * φ);
    const kx = 111412.84 * Math.cos(φ) - 93.5 * Math.cos(3 * φ) + 0.118 * Math.cos(5 * φ);
    const P = (c) => [(c[0] - lon0) * kx, (c[1] - lat0) * ky, c[2] || 0];
    const strip = (r) => { const q = r.map(P); const f = q[0], z = q[q.length - 1]; if (q.length > 3 && Math.abs(f[0] - z[0]) < 1e-6 && Math.abs(f[1] - z[1]) < 1e-6) q.pop(); return q; };
    const layers = {};
    pms.forEach((p) => {
      const k = fold(p.name) || 'SEM NOME';
      const L = layers[k] || (layers[k] = { polys: [], lines: [] });
      p.polys.forEach((r) => L.polys.push(strip(r)));
      p.lines.forEach((r) => L.lines.push(r.map(P)));
    });
    return { geo: { lon0, lat0, kx, ky }, lots: lotLayer.polys.map((r) => strip(r).map((v) => [v[0], v[1]])), layers, lotLayerName: fold(lotLayer.name) };
  }

  /* ------------------------------------------------------------ PDF */
  /** Converte itens do pdf.js em {s, cx, cy, h, a}: texto, centro, altura e ângulo. */
  function pdfItems(items) {
    return items.filter((t) => t.str && t.str.trim()).map((t) => {
      const a = Math.atan2(t.transform[1], t.transform[0]);
      const h = Math.hypot(t.transform[2], t.transform[3]);
      const cx = t.transform[4] + Math.cos(a) * t.width / 2 - Math.sin(a) * h * 0.35;
      const cy = t.transform[5] + Math.sin(a) * t.width / 2 + Math.cos(a) * h * 0.35;
      return { s: t.str.trim(), cx, cy, h: Math.round(h * 100) / 100, a: (a * 180) / Math.PI };
    });
  }

  /** Escala do desenho, lida do próprio PDF ("ESCALA 1:1750"). Devolve metros por ponto. */
  function pdfScale(items) {
    for (const t of items) { const m = fold(t.s).match(/ESCALA\s*1\s*[:/]\s*([\d.]+)/); if (m) return (0.0254 / 72) * brNum(m[1]); }
    return null;
  }

  /**
   * Separa no PDF: números de quadra (a faixa de inteiros grandes e frequentes), candidatos a número de
   * lote (inteiros de texto pequeno) e a tabela "QUADRA nn — nn LOTES", usada para conferir.
   */
  function classify(items) {
    const ints = items.filter((t) => /^\d{1,3}$/.test(t.s));
    const byH = {}; ints.forEach((t) => { const k = t.h.toFixed(1); (byH[k] = byH[k] || []).push(t); });
    const hs = Object.keys(byH).map(Number).sort((a, b) => b - a);
    // quadras: inteiros grandes que se repetem e que NÃO estão alinhados numa coluna de tabela
    const hQ = hs.find((h) => h >= 9 && byH[h.toFixed(1)].length >= 8 && new Set(byH[h.toFixed(1)].map((t) => Math.round(t.cx / 4))).size > byH[h.toFixed(1)].length * 0.5);
    const quadras = hQ ? byH[hQ.toFixed(1)] : [];
    const lotes = ints.filter((t) => !quadras.includes(t) && t.h >= 4.5 && t.h < (hQ || 99) * 0.7 && +t.s > 0).map((t) => ({ n: +t.s, x: t.cx, y: t.cy, h: t.h }));
    // tabela de quantidades: "QUADRA 06" ↔ "12 LOTES" na mesma linha (mesmo ângulo, mesma "altura" na linha)
    const tabela = {};
    const qs = items.filter((t) => /^QUADRA\s+\d+$/i.test(t.s)), ns = items.filter((t) => /^\d+\s+LOTES?$/i.test(t.s));
    qs.forEach((q) => {
      const a = (q.a * Math.PI) / 180, nx = -Math.sin(a), ny = Math.cos(a); // normal à linha de texto
      let best = null, bd = Infinity;
      ns.forEach((n) => { const off = Math.abs((n.cx - q.cx) * nx + (n.cy - q.cy) * ny); if (off < q.h * 0.6) { const d = Math.hypot(n.cx - q.cx, n.cy - q.cy); if (d < bd) { bd = d; best = n; } } });
      if (best) tabela[String(+q.s.replace(/\D/g, '')).padStart(2, '0')] = parseInt(best.s, 10);
    });
    return { quadras: quadras.map((t) => ({ q: t.s, x: t.cx, y: t.cy })), lotes, tabela };
  }

  /* ------------------------------------------------------------ alinhamento PDF → KML */
  /**
   * Transformação de semelhança (a, b, tx, ty): X = a·x − b·y + tx ; Y = b·x + a·y + ty.
   * Busca a rotação (passo de 0,5°, com e sem espelhamento) e acha a translação por votação
   * (transformada de Hough): cada par (número de lote, centro de lote) vota numa translação.
   * Robusto quando o PDF mostra só parte do loteamento (uma fase).
   */
  function register(lotPolys, lotLabels, scale, opts) {
    opts = opts || {};
    const C = lotPolys.map(centroid);
    const sample = lotLabels.filter((_, i) => i % Math.max(1, Math.floor(lotLabels.length / 90)) === 0).slice(0, 90);
    const bin = 4; // metros
    const OFF = 1 << 15;
    const vote = (s, ref, d) => {
      const th = (d * Math.PI) / 180, c = Math.cos(th) * s, si = Math.sin(th) * s;
      const votes = new Map(); let bk = 0, bv = 0;
      for (const p of sample) {
        const x = p.x * ref, y = p.y, X = c * x - si * y, Y = si * x + c * y;
        for (const q of C) {
          const k = (Math.round((q[0] - X) / bin) + OFF) * 65536 + (Math.round((q[1] - Y) / bin) + OFF);
          const v = (votes.get(k) || 0) + 1; votes.set(k, v); if (v > bv) { bv = v; bk = k; }
        }
      }
      return { v: bv, s, ref, th, tx: (Math.floor(bk / 65536) - OFF) * bin, ty: ((bk % 65536) - OFF) * bin, d };
    };
    let best = null;
    const scales = scale ? [scale] : [0.25, 0.35, 0.5, 0.6, 0.75, 1, 1.25, 1.5, 2];
    for (const s of scales) for (const ref of [1, -1]) for (let d = 0; d < 360; d += 2) { const r = vote(s, ref, d); if (!best || r.v > best.v) best = r; }
    for (let d = best.d - 2; d <= best.d + 2; d += 0.25) { const r = vote(best.s, best.ref, d); if (r.v > best.v) best = r; }
    let a = Math.cos(best.th) * best.s, b = Math.sin(best.th) * best.s, t = [best.tx, best.ty]; const ref = best.ref;
    const ap = (p) => { const x = p.x * ref, y = p.y; return [a * x - b * y + t[0], b * x + a * y + t[1]]; };
    const bbs = lotPolys.map(bbox);
    const inside = (q) => { for (let i = 0; i < lotPolys.length; i++) { const bb = bbs[i]; if (q[0] < bb.x0 || q[0] > bb.x1 || q[1] < bb.y0 || q[1] > bb.y1) continue; if (pip(q, lotPolys[i])) return i; } return -1; };
    // refinamento (ICP com escala livre): rótulo → centro do lote que o contém
    for (let it = 0; it < 25; it++) {
      const pairs = []; lotLabels.forEach((p) => { const i = inside(ap(p)); if (i >= 0) pairs.push([[p.x * ref, p.y], C[i]]); });
      if (pairs.length < 4) break;
      const n = pairs.length; let sx = 0, sy = 0, ux = 0, uy = 0; pairs.forEach(([p, c]) => { sx += p[0]; sy += p[1]; ux += c[0]; uy += c[1]; });
      sx /= n; sy /= n; ux /= n; uy /= n; let n1 = 0, n2 = 0, dd = 0;
      pairs.forEach(([p, c]) => { const px = p[0] - sx, py = p[1] - sy, cx = c[0] - ux, cy = c[1] - uy; n1 += px * cx + py * cy; n2 += px * cy - py * cx; dd += px * px + py * py; });
      const na = n1 / dd, nb = n2 / dd;
      // rótulo não fica no centróide: só aceita a escala do ICP se ficar perto da escala do PDF
      if (scale && Math.abs(Math.hypot(na, nb) / scale - 1) > 0.02) { const k = scale / Math.hypot(na, nb); a = na * k; b = nb * k; } else { a = na; b = nb; }
      t = [ux - (a * sx - b * sy), uy - (b * sx + a * sy)];
    }
    const inCount = lotLabels.filter((p) => inside(ap(p)) >= 0).length;
    return { a, b, t, ref, apply: ap, inside, hits: inCount, total: lotLabels.length, deg: (Math.atan2(b, a) * 180) / Math.PI, scale: Math.hypot(a, b) };
  }

  /* ------------------------------------------------------------ quadras = blocos de lotes vizinhos */
  function blocks(lotPolys, tol) {
    tol = tol || 0.35;
    const n = lotPolys.length, parent = Array.from({ length: n }, (_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const key = (v) => Math.round(v[0] / tol) + ':' + Math.round(v[1] / tol);
    const owner = new Map();
    lotPolys.forEach((p, i) => p.forEach((v) => {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const k = (Math.round(v[0] / tol) + dx) + ':' + (Math.round(v[1] / tol) + dy);
        const o = owner.get(k); if (o != null && o !== i) parent[find(o)] = find(i);
      }
      owner.set(key(v), i);
    }));
    return lotPolys.map((_, i) => find(i));
  }

  /**
   * Monta os lotes numerados.
   * Devolve { lots:[{poly, quadra, lote, area, areaDesenho, fase}], report }.
   * Lotes sem número no PDF ficam como "fase fora do PDF" (não entram).
   */
  function build(kml, items, opts) {
    opts = opts || {};
    const pi = pdfItems(items);
    const scale = pdfScale(pi);
    const cls = classify(pi);
    if (cls.lotes.length < 5) throw new Error('Não encontrei números de lote no PDF (texto vetorial). O PDF precisa ser exportado do CAD, não escaneado.');
    const reg = register(kml.lots, cls.lotes, scale, opts);
    const comp = blocks(kml.lots);
    const res = kml.lots.map((poly) => ({ poly, nums: [], q: [] }));
    cls.lotes.forEach((l) => { const i = reg.inside(reg.apply(l)); if (i >= 0) res[i].nums.push(l); });
    cls.quadras.forEach((q) => { const i = reg.inside(reg.apply(q)); if (i >= 0) res[i].q.push(q.q); });
    // quadra de cada bloco: rótulo que cai dentro de algum lote do bloco
    const qOfBlock = {}; res.forEach((r, i) => r.q.forEach((q) => { (qOfBlock[comp[i]] = qOfBlock[comp[i]] || {})[q] = 1; }));
    // rótulo de quadra fora de lote (no miolo/na rua): vai para o bloco do lote mais próximo
    const C = kml.lots.map(centroid);
    cls.quadras.forEach((q) => {
      const p = reg.apply(q); if (reg.inside(p) >= 0) return;
      let bi = -1, bd = Infinity; C.forEach((c, i) => { const d = Math.hypot(c[0] - p[0], c[1] - p[1]); if (d < bd) { bd = d; bi = i; } });
      if (bi >= 0 && bd < 60) (qOfBlock[comp[bi]] = qOfBlock[comp[bi]] || {})[q.q] = 1;
    });
    // bloco com números de lote mas sem rótulo de quadra (ex.: separado por uma servidão):
    // vai para a quadra rotulada mais próxima cujos números faltantes ele completa
    const pickNum = (r, i) => { const hMax = Math.max(...r.nums.map((x) => x.h)); return r.nums.filter((x) => x.h >= hMax * 0.985).sort((x, y) => Math.hypot(...minus(reg.apply(x), C[i])) - Math.hypot(...minus(reg.apply(y), C[i])))[0].n; };
    const blockNums = {}; res.forEach((r, i) => { if (r.nums.length) (blockNums[comp[i]] = blockNums[comp[i]] || []).push(pickNum(r, i)); });
    const qBlocks = {}; Object.keys(qOfBlock).forEach((b) => Object.keys(qOfBlock[b]).forEach((q) => (qBlocks[q] = qBlocks[q] || []).push(+b)));
    Object.keys(blockNums).forEach((b) => {
      if (qOfBlock[b]) return;
      const nums = blockNums[b], ids = res.map((_, i) => i).filter((i) => comp[i] === +b);
      const bc = [ids.reduce((s, i) => s + C[i][0], 0) / ids.length, ids.reduce((s, i) => s + C[i][1], 0) / ids.length];
      let best = null, bd = Infinity;
      cls.quadras.forEach((q) => {
        const exp = cls.tabela[String(+q.q).padStart(2, '0')]; if (!exp) return;
        const have = (qBlocks[q.q] || []).flatMap((bb) => blockNums[bb] || []);
        if (!nums.every((n) => n <= exp && !have.includes(n))) return;
        const p = reg.apply(q), d = Math.hypot(p[0] - bc[0], p[1] - bc[1]); if (d < bd && d < 260) { bd = d; best = q.q; }
      });
      if (best) { qOfBlock[b] = { [best]: 1 }; (qBlocks[best] = qBlocks[best] || []).push(+b); }
    });
    const report = { escala: scale, rotacao: reg.deg, acertos: reg.hits + '/' + reg.total, semNumero: 0, duplicados: [], blocosComDuasQuadras: [], quadras: {} };
    const out = [];
    res.forEach((r, i) => {
      if (!r.nums.length) { report.semNumero++; return; }
      const qs = Object.keys(qOfBlock[comp[i]] || {});
      // bloco com mais de uma quadra: usa o rótulo de quadra mais próximo
      let quadra = qs[0];
      if (qs.length > 1) {
        const c = C[i]; let bd = Infinity;
        cls.quadras.filter((q) => qs.includes(q.q)).forEach((q) => { const p = reg.apply(q); const d = Math.hypot(p[0] - c[0], p[1] - c[1]); if (d < bd) { bd = d; quadra = q.q; } });
        if (!report.blocosComDuasQuadras.includes(qs.join('+'))) report.blocosComDuasQuadras.push(qs.join('+'));
      }
      if (!quadra) { report.semNumero++; return; }
      // mais de um número dentro do lote (cotas de rua, raios): fica o mais perto do centro, preferindo o texto maior
      const c = C[i], hMax = Math.max(...r.nums.map((x) => x.h));
      const pool = r.nums.filter((x) => x.h >= hMax * 0.985);
      const num = pool.sort((x, y) => Math.hypot(...minus(reg.apply(x), c)) - Math.hypot(...minus(reg.apply(y), c)))[0];
      out.push({ poly: r.poly, quadra: String(+quadra).padStart(2, '0'), lote: num.n, area: Math.round(area(r.poly) * 100) / 100 });
    });
    const seen = {}; out.forEach((l) => { const k = l.quadra + '-' + l.lote; if (seen[k]) report.duplicados.push(k); seen[k] = 1; (report.quadras[l.quadra] = report.quadras[l.quadra] || []).push(l.lote); });
    Object.keys(report.quadras).forEach((q) => report.quadras[q].sort((a, b) => a - b));
    // confere com a tabela do PDF: quantidade por quadra e sequência 1..N
    report.tabela = cls.tabela; report.divergencias = [];
    Object.keys(report.quadras).forEach((q) => {
      const got = report.quadras[q], exp = cls.tabela[q];
      const falta = exp ? Array.from({ length: exp }, (_, k) => k + 1).filter((n) => !got.includes(n)) : [];
      const sobra = exp ? got.filter((n) => n > exp) : [];
      if ((exp && got.length !== exp) || falta.length || sobra.length) report.divergencias.push({ quadra: q, esperado: exp || null, achado: got.length, faltam: falta, sobram: sobra });
    });
    return { lots: out, report, reg };
  }
  const minus = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const segDist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L; t = Math.max(0, Math.min(1, t)); return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]); };

  /* ------------------------------------------------------------ frente, fundo, esquina, orientação */
  /** Para cada lote: lados que dão para a rua (pelo meio-fio do KML), frente, profundidade, esquina e para onde a frente aponta. */
  function lados(kml, polys) {
    const all = kml.lots, H = 3, edgeHash = new Map();
    all.forEach((p, pi) => p.forEach((a, i) => {
      const b = p[(i + 1) % p.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (H / 2))), seen = new Set();
      for (let t = 0; t <= n; t++) { const k = Math.floor((a[0] + (b[0] - a[0]) * t / n) / H) + ':' + Math.floor((a[1] + (b[1] - a[1]) * t / n) / H); if (seen.has(k)) continue; seen.add(k); (edgeHash.get(k) || edgeHash.set(k, []).get(k)).push([pi, a, b]); }
    }));
    const shared = (pi, a, b) => {
      for (const f of [0.25, 0.5, 0.75]) {
        const m = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; let ok = false;
        for (let dx = -1; dx <= 1 && !ok; dx++) for (let dy = -1; dy <= 1 && !ok; dy++) for (const e of edgeHash.get((Math.floor(m[0] / H) + dx) + ':' + (Math.floor(m[1] / H) + dy)) || []) if (e[0] !== pi && segDist(m, e[1], e[2]) < 0.35) { ok = true; break; }
        if (!ok) return false;
      }
      return true;
    };
    const curbHash = new Map(), CH = 10;
    Object.keys(kml.layers).filter((k) => /MEIO.?FIO|GUIA|SARJETA/.test(k)).forEach((k) => kml.layers[k].lines.forEach((ln) => { for (let s = 0; s < ln.length - 1; s++) { const a = ln[s], b = ln[s + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / CH)); for (let t = 0; t <= n; t++) { const key = Math.floor((a[0] + (b[0] - a[0]) * t / n) / CH) + ':' + Math.floor((a[1] + (b[1] - a[1]) * t / n) / CH); (curbHash.get(key) || curbHash.set(key, []).get(key)).push([a, b]); } } }));
    const hasCurb = curbHash.size > 0;
    const curbDist = (m) => { let d = Infinity; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const s of curbHash.get((Math.floor(m[0] / CH) + dx) + ':' + (Math.floor(m[1] / CH) + dy)) || []) d = Math.min(d, segDist(m, s[0], s[1])); return d; };
    const DIR = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
    return polys.map((poly) => {
      const pi = all.indexOf(poly), c = centroid(poly), n = poly.length;
      const free = poly.map((a, i) => !shared(pi, a, poly[(i + 1) % n]));
      const ang = (i) => { const a = poly[i], b = poly[(i + 1) % n]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
      const turn = (i, j) => { let d = Math.abs(ang(i) - ang(j)); if (d > Math.PI) d = 2 * Math.PI - d; return d; };
      // lados livres consecutivos viram um só enquanto quase alinhados; canto arredondado (> ~80°) separa
      const chains = []; let start = free.findIndex((f, i) => f && (!free[(i - 1 + n) % n] || turn((i - 1 + n) % n, i) > 0.5));
      if (start < 0 && free.some(Boolean)) start = free.findIndex(Boolean);
      if (start >= 0) for (let k = 0, i = start; k < n; k++, i = (i + 1) % n) {
        if (!free[i]) continue;
        const a = poly[i], b = poly[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]), last = chains[chains.length - 1];
        if (last && last.end === i && turn((i - 1 + n) % n, i) <= 0.5 && turn(last.first, i) <= 1.4) { last.pts.push(b); last.len += L; last.end = (i + 1) % n; }
        else chains.push({ pts: [a, b], len: L, end: (i + 1) % n, first: i });
      }
      chains.forEach((ch) => { const mid = ch.pts[Math.floor(ch.pts.length / 2)], a = ch.pts[0], b = ch.pts[ch.pts.length - 1]; ch.rua = !hasCurb || Math.min(curbDist([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]), curbDist(mid)) < 9; });
      const ruas = chains.filter((ch) => ch.rua && ch.len >= 5);
      const fronts = ruas.length ? ruas : chains.filter((ch) => ch.len >= 6);
      const dirOf = (ch) => { const a = ch.pts[0], b = ch.pts[ch.pts.length - 1]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
      let esquina = false;
      for (let i = 0; i < ruas.length; i++) for (let j = i + 1; j < ruas.length; j++) { let d = Math.abs(dirOf(ruas[i]) - dirOf(ruas[j])) % Math.PI; if (d > Math.PI / 2) d = Math.PI - d; if (d > Math.PI / 4 && ruas[i].len >= 8 && ruas[j].len >= 8) esquina = true; }
      const front = (esquina ? fronts.slice().sort((a, b) => a.len - b.len).find((f) => f.len >= 8) : fronts.slice().sort((a, b) => b.len - a.len)[0]) || fronts[0];
      let orient = null, frente = null, fundo = null;
      if (front) {
        frente = front.len;
        const a = front.pts[0], b = front.pts[front.pts.length - 1], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        if ((c[0] - m[0]) * nx + (c[1] - m[1]) * ny > 0) { nx = -nx; ny = -ny; }
        orient = DIR[Math.round(((Math.atan2(nx, ny) * 180 / Math.PI + 360) % 360) / 45) % 8];
        fundo = Math.max(...poly.map((v) => -((v[0] - m[0]) * nx + (v[1] - m[1]) * ny)));
      }
      return { frente: frente ? Math.round(frente * 10) / 10 : null, fundo: fundo ? Math.round(fundo * 10) / 10 : null, esquina, orient };
    });
  }

  /* ------------------------------------------------------------ tabela de preços / situação */
  const key2 = (q, l) => String(+q).padStart(2, '0') + '-' + String(+l).padStart(2, '0');
  /** Aceita JSON {disponiveis:[[q,l,area,preco]], indisponiveis|vendidos:["q-l"]} ou CSV/TSV (quadra;lote;area;preco;situacao). */
  function lerPrecos(texto) {
    const precos = new Map(), situacao = new Map(); if (!texto) return { precos, situacao };
    const t = String(texto).replace(/^﻿/, '').trim();
    if (t[0] === '{' || t[0] === '[') {
      const j = JSON.parse(t);
      (j.disponiveis || []).forEach(([q, l, a, v]) => { precos.set(key2(q, l), { area: a, preco: v }); situacao.set(key2(q, l), 'disponivel'); });
      (j.indisponiveis || []).concat(j.vendidos || []).forEach((k) => situacao.set(key2(...String(k).split('-')), 'vendido'));
      (j.reservados || []).forEach((k) => situacao.set(key2(...String(k).split('-')), 'reservado'));
    } else {
      const rows = t.split(/\r?\n/).filter((r) => r.trim()); const first = rows[0];
      const sep = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
      const head = rows.shift().split(sep).map(fold); const ix = (...ns) => head.findIndex((h) => ns.some((n) => h.includes(n)));
      const iq = ix('QUADRA', 'QD'), il = ix('LOTE', 'LT'), ia = ix('AREA', 'M2'), ip = ix('PRECO', 'VALOR'), is = ix('SITUA', 'STATUS');
      rows.forEach((ln) => {
        const c = ln.split(sep); if (iq < 0 || il < 0 || !c[iq] || !c[il]) return;
        const k = key2(c[iq], c[il]); const v = ip >= 0 ? brNum((c[ip] || '').replace(/[^\d.,-]/g, '')) : 0, a = ia >= 0 ? brNum(c[ia] || '') : 0;
        if (v) precos.set(k, { area: a || null, preco: v });
        const s = fold(c[is] || '');
        if (s) situacao.set(k, s.startsWith('DISP') || s === 'LIVRE' ? 'disponivel' : s.startsWith('RESERV') ? 'reservado' : 'vendido');
        else if (v) situacao.set(k, 'disponivel');
      });
    }
    return { precos, situacao };
  }

  /* ------------------------------------------------------------ relevo (modelo do terreno a partir das curvas de nível) */
  function relevo(kml, ext, step) {
    step = step || 4;
    const layer = Object.keys(kml.layers).find((k) => /CURVA|NIVEL|COTA/.test(k) && kml.layers[k].lines.some((l) => l[0] && l[0][2]));
    if (!layer) return null;
    const lines = kml.layers[layer].lines.filter((ln) => ln.length > 1 && ln[0][2]);
    if (lines.length < 10) return null;
    const { minX, maxY, W, H } = ext, gw = Math.ceil(W / step) + 1, gh = Math.ceil(H / step) + 1;
    const sum = new Float64Array(gw * gh), cnt = new Uint16Array(gw * gh);
    const put = (x, y, z) => { const i = Math.round((x - minX) / step), j = Math.round((maxY - y) / step); if (i < 0 || j < 0 || i >= gw || j >= gh) return; const k = j * gw + i; sum[k] += z; cnt[k]++; };
    lines.forEach((ln) => { for (let s = 0; s < ln.length - 1; s++) { const a = ln[s], b = ln[s + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (step * 0.5))); for (let t = 0; t <= n; t++) put(a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n, a[2]); } });
    let dem = new Float32Array(gw * gh); const fixed = new Uint8Array(gw * gh); let zmin = Infinity, zmax = -Infinity, zs = 0, zn = 0;
    for (let k = 0; k < dem.length; k++) if (cnt[k]) { dem[k] = sum[k] / cnt[k]; fixed[k] = 1; zmin = Math.min(zmin, dem[k]); zmax = Math.max(zmax, dem[k]); zs += dem[k]; zn++; }
    if (!zn) return null;
    for (let k = 0; k < dem.length; k++) if (!fixed[k]) dem[k] = zs / zn;
    // encosta suave entre as curvas: relaxação de Laplace (sobre-relaxada)
    for (let it = 0; it < 500; it++) for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const k = j * gw + i; if (fixed[k]) continue; let s = 0, c = 0; if (i > 0) { s += dem[k - 1]; c++; } if (i < gw - 1) { s += dem[k + 1]; c++; } if (j > 0) { s += dem[k - gw]; c++; } if (j < gh - 1) { s += dem[k + gw]; c++; } dem[k] += 1.9 * (s / c - dem[k]); }
    for (let pass = 0; pass < 2; pass++) { const o = dem.slice(); for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) { const k = j * gw + i; o[k] = (dem[k] * 4 + dem[k - 1] + dem[k + 1] + dem[k - gw] + dem[k + gw]) / 8; } dem = o; }
    const u16 = new Uint16Array(dem.length); for (let i = 0; i < dem.length; i++) u16[i] = Math.max(0, Math.round((dem[i] - zmin) * 10));
    return { w: gw, h: gh, step, zmin: Math.round(zmin * 10) / 10, zmax: Math.round(zmax * 10) / 10, dem, u16 };
  }

  /** Sombreamento do relevo com textura de mata (RGBA). R = metros por pixel. */
  function sombra(rel, ext, R) {
    R = R || 1.2;
    const { w: gw, h: gh, step, dem } = rel, sw = Math.round(ext.W / R), sh = Math.round(ext.H / R), buf = new Uint8ClampedArray(sw * sh * 4);
    const zAt = (x, y) => { const fx = Math.max(0, Math.min(gw - 1.001, x / step)), fy = Math.max(0, Math.min(gh - 1.001, y / step)); const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, k = j * gw + i; return (dem[k] * (1 - u) + dem[k + 1] * u) * (1 - v) + (dem[k + gw] * (1 - u) + dem[k + gw + 1] * u) * v; };
    const hsh = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
    const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); const a = hsh(xi, yi), b = hsh(xi + 1, yi), c = hsh(xi, yi + 1), d = hsh(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
    const az = (315 * Math.PI) / 180, alt = (42 * Math.PI) / 180, zf = 1.6, e = 2;
    for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
      const x = i * R, y = j * R;
      const dzdx = (zAt(x + e, y) - zAt(x - e, y)) / (2 * e) * zf, dzdy = (zAt(x, y - e) - zAt(x, y + e)) / (2 * e) * zf;
      const slope = Math.atan(Math.hypot(dzdx, dzdy)), aspect = Math.atan2(dzdy, -dzdx);
      const s = Math.max(0, Math.sin(alt) * Math.cos(slope) + Math.cos(alt) * Math.sin(slope) * Math.cos(az - aspect));
      const t = (zAt(x, y) - rel.zmin) / Math.max(1, rel.zmax - rel.zmin);
      const canopy = 0.72 + 0.28 * vn(x / 5, y / 5) + 0.12 * (vn(x / 1.8 + 31, y / 1.8 - 7) - 0.5);
      const k = (j * sw + i) * 4, f = (0.5 + s * 0.75) * canopy;
      buf[k] = (30 + t * 26) * f; buf[k + 1] = (54 + t * 24) * f; buf[k + 2] = (33 + t * 12) * f; buf[k + 3] = 255;
    }
    return { w: sw, h: sh, data: buf };
  }

  /** Desenho do mapa-base (SVG) a partir das camadas do KML. shadeHref = imagem do relevo (opcional). */
  function mapaSvg(kml, fase, ext, shadeHref, PX) {
    PX = PX || 0.6;
    const IW = Math.round(ext.W / PX), IH = Math.round(ext.H / PX);
    const S = (v) => ((v[0] - ext.minX) / PX).toFixed(1) + ',' + ((ext.maxY - v[1]) / PX).toFixed(1);
    const ring = (r) => 'M' + r.map(S).join('L') + 'Z', line = (r) => 'M' + r.map(S).join('L');
    const L = kml.layers, lay = (re) => Object.keys(L).filter((k) => re.test(k)).map((k) => L[k]);
    const perim = []; {
      const segs = lay(/PERIMETRO|GLEBA|DIVISA/).flatMap((x) => x.lines.concat(x.polys.map((p) => p.concat([p[0]])))).map((s) => s.map((v) => [v[0], v[1]]));
      const used = new Array(segs.length).fill(false), near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05;
      for (let s0 = 0; s0 < segs.length; s0++) {
        if (used[s0]) continue; used[s0] = true; const chain = segs[s0].slice(); let grew = true;
        while (grew) { grew = false; for (let i = 0; i < segs.length; i++) { if (used[i]) continue; const s = segs[i]; if (near(chain[chain.length - 1], s[0])) { chain.push(...s.slice(1)); used[i] = grew = true; } else if (near(chain[chain.length - 1], s[s.length - 1])) { chain.push(...s.slice(0, -1).reverse()); used[i] = grew = true; } } }
        if (chain.length > 10) perim.push(chain);
      }
    }
    const polysOf = (re) => lay(re).flatMap((x) => x.polys);
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${IW}" height="${IH}" viewBox="0 0 ${IW} ${IH}">`;
    if (shadeHref) svg += `<image x="0" y="0" width="${IW}" height="${IH}" preserveAspectRatio="none" href="${shadeHref}" xlink:href="${shadeHref}"/>`;
    else if (shadeHref !== false) svg += `<rect width="${IW}" height="${IH}" fill="#2a4029"/>`;
    if (perim.length) svg += `<path d="${perim.map(ring).join('')}" fill="#cfc7b4" fill-opacity="0.92" fill-rule="evenodd"/>`;
    svg += `<path d="${polysOf(/^ARS$|REMANESC/).map(ring).join('')}" fill="#3f5d36" fill-opacity="0.78"/>`;
    svg += `<path d="${polysOf(/^AVS?$|VERDE/).map(ring).join('')}" fill="#4f7a3c" fill-opacity="0.85"/>`;
    svg += `<path d="${polysOf(/^AI$|INSTITUC/).map(ring).join('')}" fill="#9aa86a" fill-opacity="0.8"/>`;
    svg += `<path d="${polysOf(/PRA[CÇ]A|LAZER|CLUBE/).map(ring).join('')}" fill="#5f8c45" fill-opacity="0.85"/>`;
    svg += `<path d="${polysOf(/DNIT|ESTRADA|RODOVIA/).map(ring).join('')}" fill="#9a9488" fill-opacity="0.9"/>`;
    svg += `<path d="${kml.lots.filter((p) => !fase.has(p)).map(ring).join('')}" fill="#93a777" fill-opacity="0.55" stroke="#e8e4d8" stroke-opacity="0.5" stroke-width="1"/>`;
    svg += `<path d="${kml.lots.filter((p) => fase.has(p)).map(ring).join('')}" fill="#7fa25a" stroke="#f3efe3" stroke-width="1.6"/>`;
    svg += `<path d="${lay(/MEIO.?FIO|GUIA/).flatMap((x) => x.lines).map(line).join('')}" fill="none" stroke="#f4f1e8" stroke-width="1.3" stroke-opacity="0.9"/>`;
    svg += `<path d="${lay(/NAO EDIF/).flatMap((x) => x.lines).map(line).join('')}" fill="none" stroke="#e7d38a" stroke-width="1" stroke-dasharray="4 3" stroke-opacity="0.55"/>`;
    if (perim.length) svg += `<path d="${perim.map(ring).join('')}" fill="none" stroke="#1d2d1c" stroke-width="3" stroke-opacity="0.8"/>`;
    return { svg: svg + '</svg>', w: IW, h: IH };
  }

  /* ------------------------------------------------------------ montagem completa */
  /**
   * Tudo junto. Entrada: kml (parseKml), itens de texto do PDF, texto da tabela de preços (opcional).
   * Saída: { project (sem imagem), report, avisos, ext, fase, rel } — quem chama gera a imagem do mapa-base
   * (Node: resvg; navegador: canvas) e codifica o relevo em base64.
   */
  function montar(kml, items, opts) {
    opts = opts || {};
    const r = build(kml, items);
    const M = 140, pts = kml.lots.flat();
    const ext = { minX: Math.min(...pts.map((v) => v[0])) - M, maxX: Math.max(...pts.map((v) => v[0])) + M, minY: Math.min(...pts.map((v) => v[1])) - M, maxY: Math.max(...pts.map((v) => v[1])) + M };
    ext.W = Math.round(ext.maxX - ext.minX); ext.H = Math.round(ext.maxY - ext.minY);
    const T = (v) => [Math.round((v[0] - ext.minX) * 100) / 100, Math.round((ext.maxY - v[1]) * 100) / 100];
    const { precos, situacao } = lerPrecos(opts.precos);
    const temTabela = precos.size + situacao.size > 0;
    const ld = lados(kml, r.lots.map((l) => l.poly));
    const avisos = [];
    const uid = () => Math.random().toString(36).slice(2, 10);
    const lots = r.lots.map((l, i) => {
      const k = key2(l.quadra, l.lote), pr = precos.get(k), d = ld[i];
      let area = l.area;
      if (pr && pr.area) { if (Math.abs(pr.area - l.area) > Math.max(8, l.area * 0.03)) avisos.push(`${k}: área da tabela ${pr.area} m², desenho ${l.area} m²`); area = pr.area; }
      return {
        id: uid(), quadra: String(+l.quadra).padStart(2, '0'), lote: l.lote,
        status: situacao.get(k) || (temTabela ? (opts.semTabela || 'vendido') : 'disponivel'), preco: pr ? pr.preco : 0,
        area, areaDesenho: l.area, frente: d.frente, fundo: d.fundo, orientacao: d.orient, tags: d.esquina ? ['Esquina'] : [], obs: '', poly: l.poly.map(T)
      };
    }).sort((a, b) => (+a.quadra - +b.quadra) || a.lote - b.lote);
    if (temTabela) { const sem = [...precos.keys()].filter((k) => !lots.some((l) => key2(l.quadra, l.lote) === k)); if (sem.length) avisos.push('Na tabela mas sem lote no desenho: ' + sem.join(' ')); }
    const rel = opts.relevo === false ? null : relevo(kml, ext);
    const project = {
      id: opts.slug || 'loteamento', name: opts.nome || 'Loteamento', subtitle: 'Loteamento residencial', city: '',
      W: ext.W, H: ext.H, mpu: 1,
      geo: { lon0: kml.geo.lon0, lat0: kml.geo.lat0, kx: kml.geo.kx, ky: kml.geo.ky, ox: ext.minX, oy: -ext.maxY },
      lots, fonte: { geradoEm: new Date().toISOString().slice(0, 10), rotacao: +r.report.rotacao.toFixed(3), escala: +(r.report.escala || 0).toFixed(5) }
    };
    return { project, report: r.report, avisos, ext, fase: new Set(r.lots.map((l) => l.poly)), rel };
  }

  /** Converte a calibração da foto aérea de um projeto antigo pelos lotes em comum (mesma quadra-lote). */
  function converterRealista(antigo, novoLots) {
    if (!antigo || !antigo.realista || !antigo.realista.points) return null;
    const oc = new Map(antigo.lots.filter((l) => l.poly).map((l) => [key2(l.quadra, l.lote), centroid(l.poly)]));
    const pairs = novoLots.filter((l) => oc.has(key2(l.quadra, l.lote))).map((l) => [oc.get(key2(l.quadra, l.lote)), centroid(l.poly)]);
    if (pairs.length < 10) return null;
    const n = pairs.length; let sx = 0, sy = 0, ux = 0, uy = 0; pairs.forEach(([p, c]) => { sx += p[0]; sy += p[1]; ux += c[0]; uy += c[1]; });
    sx /= n; sy /= n; ux /= n; uy /= n; let n1 = 0, n2 = 0, d = 0;
    pairs.forEach(([p, c]) => { const px = p[0] - sx, py = p[1] - sy, cx = c[0] - ux, cy = c[1] - uy; n1 += px * cx + py * cy; n2 += px * cy - py * cx; d += px * px + py * py; });
    const a = n1 / d, b = n2 / d, tx = ux - (a * sx - b * sy), ty = uy - (b * sx + a * sy);
    const res = pairs.map(([p, c]) => Math.hypot(a * p[0] - b * p[1] + tx - c[0], b * p[0] + a * p[1] + ty - c[1])).sort((x, y) => x - y);
    return { realista: Object.assign({}, antigo.realista, { points: antigo.realista.points.map((q) => [Math.round((a * q[0] - b * q[1] + tx) * 100) / 100, Math.round((b * q[0] + a * q[1] + ty) * 100) / 100, q[2], q[3]]) }), pares: n, erroMediano: res[n >> 1] };
  }

  return { parseKml, pdfItems, pdfScale, classify, register, blocks, build, lados, lerPrecos, relevo, sombra, mapaSvg, montar, converterRealista, area, centroid, pip, bbox, brNum };
});
