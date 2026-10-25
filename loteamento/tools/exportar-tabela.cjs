// Gera a planilha (CSV ; Excel BR) com todos os lotes do projeto: edite preço/situação e importe no editor.
//   node tools/exportar-tabela.cjs projeto.json mapas/tabela.csv
const fs = require('fs');
const [, , src = 'projeto.json', out = 'tabela.csv'] = process.argv;
const p = JSON.parse(fs.readFileSync(src, 'utf8'));
const n = (v, d = 2) => (v || v === 0 ? Number(v).toFixed(d).replace('.', ',') : '');
const SIT = { disponivel: 'Disponível', vendido: 'Vendido', reservado: 'Reservado', indisponivel: 'Indisponível' };
const rows = p.lots.slice().sort((a, b) => (+a.quadra - +b.quadra) || a.lote - b.lote)
  .map((l) => [l.quadra, String(l.lote).padStart(2, '0'), SIT[l.status] || l.status, l.preco ? n(l.preco) : '', n(l.area), n(l.frente, 1), n(l.fundo, 1), l.orientacao || '', (l.tags || []).join(' | ')].join(';'));
fs.writeFileSync(out, '\uFEFF' + 'quadra;lote;situacao;preco;area;frente;fundo;orientacao;caracteristicas\n' + rows.join('\n'));
console.log(out, rows.length, 'lotes');
