/*
 * LoteVivo — monta um loteamento a partir do KMZ do CAD + PDF da planta (+ tabela de preços).
 * (O editor faz o mesmo pelo navegador: Importar → Projeto completo. Os dois usam js/importar-planta.js.)
 *
 *   node tools/importar-kmz-pdf.cjs --kmz "arquivo.kmz" --pdf "planta.pdf" --slug jardim-das-gerais
 *        [--nome "Jardim das Gerais"] [--precos tabela.json|tabela.csv] [--realista-de projeto-antigo.json]
 *        [--saida projeto.json] [--mapas mapas]
 *
 * Dependências (uma vez): npm i jszip@3 pdfjs-dist@3.11.174 jpeg-js @resvg/resvg-js
 *
 * Saída:
 *  - projeto.json: lotes numerados (os que têm número no PDF = a fase da planta), área, frente/fundo/esquina/
 *    orientação da geometria real, preço e situação, e o relevo do terreno para o 3D;
 *  - mapas/<slug>-base.jpg: mapa-base desenhado do próprio CAD.
 */
const fs = require('fs');
const path = require('path');
const P = require('../js/importar-planta.js');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const need = (m) => { try { return require(m); } catch (e) { console.error(`Falta o pacote "${m}". Rode: npm i jszip@3 pdfjs-dist@3.11.174 jpeg-js @resvg/resvg-js`); process.exit(1); } };

(async function main() {
  const kmzPath = arg('kmz'), pdfPath = arg('pdf'), slug = arg('slug', 'loteamento');
  if (!kmzPath || !pdfPath) { console.log('uso: node tools/importar-kmz-pdf.cjs --kmz arquivo.kmz --pdf planta.pdf --slug nome [--precos tabela.json]'); process.exit(1); }
  const out = arg('saida', 'projeto.json'), dir = arg('mapas', 'mapas');
  fs.mkdirSync(dir, { recursive: true });

  let kmlText;
  if (/\.kmz$/i.test(kmzPath)) {
    const JSZip = need('jszip'); const zip = await JSZip.loadAsync(fs.readFileSync(kmzPath));
    const k = Object.keys(zip.files).find((n) => /\.kml$/i.test(n)); kmlText = await zip.files[k].async('string');
  } else kmlText = fs.readFileSync(kmzPath, 'utf8');
  const kml = P.parseKml(kmlText);
  console.log('KML:', kml.lots.length, 'polígonos de lote na camada', kml.lotLayerName);

  const pdfjs = need('pdfjs-dist/legacy/build/pdf.js');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), verbosity: 0 }).promise;
  let items = []; for (let i = 1; i <= doc.numPages; i++) items = items.concat((await (await doc.getPage(i)).getTextContent()).items);

  const old = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  const fp = arg('precos');
  const m = P.montar(kml, items, { slug, nome: arg('nome', old ? old.name : slug), precos: fp ? fs.readFileSync(fp, 'utf8') : null });
  const { project, report, avisos, ext, fase, rel } = m;
  console.log('Alinhamento PDF→KML: rotação', report.rotacao.toFixed(2) + '°, escala', (report.escala || 0).toFixed(4), 'm/pt, números dentro de lotes', report.acertos);
  console.log('Lotes numerados:', project.lots.length, '| divergências com a tabela da planta:', report.divergencias.length ? JSON.stringify(report.divergencias) : 'nenhuma', '| duplicados:', report.duplicados.join(',') || 'nenhum');

  // relevo
  let shadeURL = null;
  if (rel) {
    project.relevo = { w: rel.w, h: rel.h, step: rel.step, zmin: rel.zmin, zmax: rel.zmax, data: Buffer.from(rel.u16.buffer).toString('base64') };
    console.log('Relevo:', rel.w + '×' + rel.h, 'células de', rel.step, 'm, cotas', rel.zmin, '→', rel.zmax, 'm');
    const jpeg = need('jpeg-js'); const sh = P.sombra(rel, ext);
    shadeURL = 'data:image/jpeg;base64,' + Buffer.from(jpeg.encode({ data: Buffer.from(sh.data.buffer), width: sh.w, height: sh.h }, 90).data).toString('base64');
  }
  // mapa-base
  const { svg } = P.mapaSvg(kml, fase, ext, shadeURL);
  const { Resvg } = need('@resvg/resvg-js'); const png = new Resvg(svg, { fitTo: { mode: 'original' } }).render();
  const baseFile = path.join(dir, slug + '-base.jpg');
  fs.writeFileSync(baseFile, need('jpeg-js').encode({ data: Buffer.from(png.pixels), width: png.width, height: png.height }, 86).data);
  console.log('Mapa-base:', baseFile, png.width + '×' + png.height);

  project.image = path.posix.join(path.basename(dir), slug + '-base.jpg');
  project.imageCredit = 'Desenho do projeto aprovado (KMZ/PDF)';
  Object.assign(project.fonte, { kmz: path.basename(kmzPath), pdf: path.basename(pdfPath), precos: fp ? path.basename(fp) : null });
  if (old) { ['subtitle', 'city', 'whatsapp', 'plans', 'tabelaValidade'].forEach((k) => { if (old[k] != null) project[k] = old[k]; }); }
  // foto aérea (modo Realista): converte a calibração antiga pelos lotes em comum
  const realDe = arg('realista-de');
  const conv = realDe && fs.existsSync(realDe) ? P.converterRealista(JSON.parse(fs.readFileSync(realDe, 'utf8')), project.lots) : null;
  if (conv) { project.realista = conv.realista; console.log('Realista: calibração convertida por', conv.pares, 'lotes em comum (erro mediano', conv.erroMediano.toFixed(1), 'm)'); }
  else if (old && old.realista) project.realista = old.realista;

  fs.writeFileSync(out, JSON.stringify(project));
  const cont = {}; project.lots.forEach((l) => (cont[l.status] = (cont[l.status] || 0) + 1));
  console.log('Projeto:', out, '|', project.lots.length, 'lotes', JSON.stringify(cont), '| área', ext.W + '×' + ext.H, 'm');
  if (avisos.length) console.log('Avisos:\n  ' + avisos.join('\n  '));
})().catch((e) => { console.error('Erro:', e.message); process.exit(1); });
