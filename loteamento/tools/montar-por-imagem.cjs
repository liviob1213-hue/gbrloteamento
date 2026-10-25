/*
 * Monta um projeto do LoteVivo a partir da imagem do mapa + posição do número de cada lote.
 *
 *   node montar-por-imagem.cjs <mapa.jpg> <lotes.json> <saida-projeto.json> <saida-mapa.jpg> [nome]
 *
 * lotes.json = [[quadra, lote, x, y, areaLidaNoMapa|0], ...]  (x/y em pixels da imagem original)
 * Precisa do pacote jpeg-js (npm i jpeg-js).
 *
 * Como funciona: os lotes vendáveis são o verde vivo do mapa. Cada mancha verde (já sem
 * ruas) vira uma quadra; a área dela é repartida entre os números de lote que caem nela,
 * pelo ponto mais próximo. Como o número fica perto da frente do lote, as divisas saem
 * perpendiculares à rua, como na planta.
 */
const fs = require('fs');
const jpeg = require('jpeg-js');

const [, , imgPath, lotsPath, outJson, outImg, nome] = process.argv;
const raw = jpeg.decode(fs.readFileSync(imgPath), { useTArray: true });
const W0 = raw.width, H0 = raw.height, D = raw.data;
const seeds = JSON.parse(fs.readFileSync(lotsPath, 'utf8')).map(([q, l, x, y, a]) => ({ q: String(q), l, x, y, a }));

/* ---------- recorte: tira a margem branca e troca o branco de fora por mata ---------- */
const white = (i) => D[i * 4] > 236 && D[i * 4 + 1] > 236 && D[i * 4 + 2] > 236;
const outside = new Uint8Array(W0 * H0);
{
  const st = [];
  for (let x = 0; x < W0; x++) st.push(x, (H0 - 1) * W0 + x);
  for (let y = 0; y < H0; y++) st.push(y * W0, y * W0 + W0 - 1);
  while (st.length) {
    const p = st.pop(); if (outside[p] || !white(p)) continue;
    outside[p] = 1; const x = p % W0;
    if (x > 0) st.push(p - 1); if (x < W0 - 1) st.push(p + 1); if (p >= W0) st.push(p - W0); if (p < W0 * H0 - W0) st.push(p + W0);
  }
}
let bx0 = W0, by0 = H0, bx1 = 0, by1 = 0;
for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) if (!outside[y * W0 + x]) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
const pad = 40;
const ox = Math.max(0, bx0 - pad), oy = Math.max(0, by0 - pad);
const W = Math.min(W0, bx1 + pad) - ox, H = Math.min(H0, by1 + pad) - oy;

const img = Buffer.alloc(W * H * 4);
let rnd = 7; const R = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const s = (y + oy) * W0 + (x + ox), t = (y * W + x) * 4;
  if (outside[s]) {
    // mata escura com textura, para casar com o relevo do 3D
    const n = R() * 14;
    img[t] = 24 + n; img[t + 1] = 40 + n * 1.3; img[t + 2] = 28 + n * 0.7;
  } else { img[t] = D[s * 4]; img[t + 1] = D[s * 4 + 1]; img[t + 2] = D[s * 4 + 2]; }
  img[t + 3] = 255;
}
// suaviza a borda entre a mata e o mapa
for (let pass = 0; pass < 2; pass++) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  const s = (y + oy) * W0 + (x + ox);
  if (!outside[s]) continue;
  const nb = [s - 1, s + 1, s - W0, s + W0];
  if (nb.some((q) => !outside[q])) {
    const t = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) img[t + c] = (img[t + c] + img[t + c - 4] + img[t + c + 4] + img[t + c - W * 4] + img[t + c + W * 4]) / 5;
  }
}
fs.writeFileSync(outImg, jpeg.encode({ data: img, width: W, height: H }, 90).data);

/* ---------- máscara das quadras (verde vivo), fechada e sem buracos ---------- */
const N = W * H;
const at = (x, y) => (y * W + x) * 4;
let M = new Uint8Array(N);
for (let i = 0; i < N; i++) { const r = img[i * 4], g = img[i * 4 + 1], b = img[i * 4 + 2]; M[i] = r < 75 && g > 120 && g - r > 90 && b < 120 ? 1 : 0; }
const step = (m, grow) => {
  const o = m.slice();
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x;
    if (grow ? !m[p] && (m[p - 1] || m[p + 1] || m[p - W] || m[p + W]) : m[p] && (!m[p - 1] || !m[p + 1] || !m[p - W] || !m[p + W])) o[p] = grow ? 1 : 0;
  }
  return o;
};
for (let k = 0; k < 3; k++) M = step(M, true);
for (let k = 0; k < 3; k++) M = step(M, false);
{
  const out = new Uint8Array(N), st = [];
  for (let x = 0; x < W; x++) st.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) st.push(y * W, y * W + W - 1);
  while (st.length) {
    const p = st.pop(); if (out[p] || M[p]) continue; out[p] = 1; const x = p % W;
    if (x > 0) st.push(p - 1); if (x < W - 1) st.push(p + 1); if (p >= W) st.push(p - W); if (p < N - W) st.push(p + W);
  }
  for (let i = 0; i < N; i++) if (!M[i] && !out[i]) M[i] = 1;
}
const comp = new Int32Array(N); let nc = 0;
for (let s = 0; s < N; s++) {
  if (!M[s] || comp[s]) continue; nc++; const st = [s]; comp[s] = nc;
  while (st.length) { const p = st.pop(), x = p % W; for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]) if (q >= 0 && q < N && M[q] && !comp[q]) { comp[q] = nc; st.push(q); } }
}

/* ---------- reparte cada quadra entre os lotes dela ---------- */
seeds.forEach((s) => {
  s.x -= ox; s.y -= oy;
  let best = -1, bd = 1e9;
  for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) { const p = (s.y + dy) * W + s.x + dx; if (M[p] && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = p; } }
  s.comp = best >= 0 ? comp[best] : 0;
});
const byComp = {};
seeds.forEach((s, i) => s.comp && (byComp[s.comp] = byComp[s.comp] || []).push(i));
const own = new Int32Array(N).fill(-1), pix = new Int32Array(seeds.length);
for (let p = 0; p < N; p++) {
  const list = byComp[comp[p]]; if (!list) continue;
  const x = p % W, y = (p - x) / W; let bi = -1, bd = Infinity;
  for (const i of list) { const d = (seeds[i].x - x) ** 2 + (seeds[i].y - y) ** 2; if (d < bd) { bd = d; bi = i; } }
  own[p] = bi; pix[bi]++;
}

/* ---------- contorno de cada lote ---------- */
function trace(id) {
  let start = -1;
  for (let p = 0; p < N; p++) if (own[p] === id) { start = p; break; }
  if (start < 0) return null;
  const dx = [1, 1, 0, -1, -1, -1, 0, 1], dy = [0, 1, 1, 1, 0, -1, -1, -1];
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && own[y * W + x] === id;
  const sx = start % W, sy = (start - sx) / W;
  let x = sx, y = sy, d = 7, guard = 0; const pts = [[x, y]];
  do {
    let found = false; const s0 = (d + 6) % 8;
    for (let k = 0; k < 8; k++) { const nd = (s0 + k) % 8; if (inside(x + dx[nd], y + dy[nd])) { x += dx[nd]; y += dy[nd]; d = nd; found = true; break; } }
    if (!found) break; pts.push([x, y]);
  } while (!(x === sx && y === sy) && ++guard < 1e6);
  return pts;
}
function simplify(pts, eps) {
  const sq = (a, b, c) => { let x = b[0], y = b[1], ex = c[0] - x, ey = c[1] - y; if (ex || ey) { const t = ((a[0] - x) * ex + (a[1] - y) * ey) / (ex * ex + ey * ey); if (t > 1) { x = c[0]; y = c[1]; } else if (t > 0) { x += ex * t; y += ey * t; } } ex = a[0] - x; ey = a[1] - y; return ex * ex + ey * ey; };
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
  while (st.length) { const [f, l] = st.pop(); let m = 0, ix = 0; for (let i = f + 1; i < l; i++) { const v = sq(pts[i], pts[f], pts[l]); if (v > m) { m = v; ix = i; } } if (m > eps * eps) { keep[ix] = 1; st.push([f, ix], [ix, l]); } }
  return pts.filter((_, i) => keep[i]);
}
const area = (p) => Math.abs(p.reduce((s, v, i) => { const q = p[(i + 1) % p.length]; return s + v[0] * q[1] - q[0] * v[1]; }, 0)) / 2;
/* frente e fundo aproximados pelo menor retângulo que envolve o lote */
function sides(poly, mpu) {
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(ang), s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of poly) { const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const A = (u1 - u0) * (v1 - v0); if (!best || A < best.A) best = { A, a: u1 - u0, b: v1 - v0 };
  }
  const r = (v) => Math.round(v * mpu * 2) / 2;
  return { frente: r(Math.min(best.a, best.b)), fundo: r(Math.max(best.a, best.b)) };
}

// escala: a mediana entre a área escrita no mapa e os pixels do lote
const ratios = seeds.map((s, i) => (s.a > 800 && s.a < 2200 && pix[i] ? s.a / pix[i] : 0)).filter(Boolean).sort((a, b) => a - b);
const mpu = Math.sqrt(ratios[Math.floor(ratios.length / 2)]);

const uid = () => Math.random().toString(36).slice(2, 10);
const conferir = [];
const lots = seeds.map((s, i) => {
  const t = trace(i);
  const poly = t ? simplify(t, 1.1).map((v) => [v[0] + 0.5, v[1] + 0.5]) : null;
  if (poly && poly.length > 2 && poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1]) poly.pop();
  const calc = pix[i] * mpu * mpu;
  let a = s.a;
  if (!a || a / calc < 0.6 || a / calc > 1.6) { if (s.a) conferir.push(`${s.q}-${s.l}`); a = Math.round(calc); }
  const lot = { id: uid(), quadra: s.q, lote: s.l, status: 'disponivel', preco: 0, area: a, tags: [], obs: '', pin: [s.x, s.y] };
  if (poly && poly.length > 2) { lot.poly = poly; Object.assign(lot, sides(poly, mpu)); }
  return lot;
});

const project = {
  id: 'jardim-das-gerais', name: nome || 'Jardim das Gerais', subtitle: 'Loteamento residencial', city: 'Minas Gerais',
  W, H, mpu, image: 'mapas/' + require('path').basename(outImg), whatsapp: '',
  plans: [
    { id: 'investidor', nome: 'Investidor', entradaPct: 20, meses: 24, correcao: 'sem correção', jurosAm: 0, modo: 'linear', descontoPct: 0 },
    { id: 'curto', nome: 'Curto', entradaPct: 20, meses: 36, correcao: 'IPCA anual', jurosAm: 0, modo: 'linear', descontoPct: 0 },
    { id: 'normal', nome: 'Normal', entradaPct: 10, meses: 120, correcao: 'poupança anual + 0,5% a.m.', jurosAm: 0.5, modo: 'linear', descontoPct: 0 }
  ],
  lots
};
fs.writeFileSync(outJson, JSON.stringify(project));
console.log(JSON.stringify({ W, H, crop: [ox, oy], quadras: nc, lotes: lots.length, comContorno: lots.filter((l) => l.poly).length, mpu: +mpu.toFixed(4), terrenoMetros: [Math.round(W * mpu), Math.round(H * mpu)], areaConferir: conferir }));
