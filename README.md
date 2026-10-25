# LoteVivo: loteamento em 3D

- `loteamento/index.html`: o site do cliente, com as abas **3D · Mapa · Real · Grade · Tabela**, filtros, comparação, simulador e PDF.
- `loteamento/editor.html`: onde o loteamento é montado e mantido (situação, preços, planos).
- `loteamento/calibrar.html`: encaixe da foto de drone no modo Real.

Para rodar localmente: `npx serve -l 5178 .` e abrir `http://localhost:5178/loteamento/`
(com a barra no final).

## Rotas na Vercel

| Rota | Página |
|---|---|
| `/loteamento/` | o mapa público |
| `/loteamento/editor.html` | o editor |
| `/loteamento/calibrar.html` | o calibrador da foto aérea |

A raiz `/` redireciona para `/loteamento/`. Quem configura isso é o `vercel.json`, que também
liga o `trailingSlash`: sem a barra no final, os caminhos relativos das páginas (`css/`, `js/`,
`mapas/`) sairiam errados. **As páginas precisam de `.html` no fim** — `/loteamento/editor`
dá 404, porque `cleanUrls` está desligado.

## Numeração no mapa

Nos três mapas (**3D**, **Mapa** e **Real**) o número da quadra aparece com o loteamento
inteiro à vista, em etiquetas do mesmo tamanho em qualquer zoom. Clicar numa etiqueta leva
o mapa até aquela quadra; aí o número de cada lote aparece por cima do desenho. Quando duas
etiquetas se encavalam — no celular, ou com o mapa bem aberto — a quadra maior fica com a
vez e a outra reaparece quando o zoom entra.

Os mesmos atalhos existem fora do mapa: o título **Quadra NN** em "Explorar" e na aba
**Grade** leva até ela, e digitar só o número da quadra na busca (`41`, `q41`, `quadra 41`)
também. Com quadra e lote (`41-04`), a busca continua abrindo o lote direto.

## Jardim das Gerais (fase 1)

Montado com os arquivos oficiais:

- **Lotes:** os polígonos do **KMZ do CAD** (`Jardim das Geraes - Kml 2026.kmz`), com o desenho exato de cada lote.
- **Numeração:** vem da **planta em PDF** (`Planta Jardim das Gerais fase 1.pdf`). Entram só os lotes numerados nela, que são a fase 1: quadras 01–11, 30–46 e a 54 (rotatória). São 275 lotes, e a quantidade por quadra confere com a tabela "Quantidade de lotes e áreas" da planta.
- **Preço e situação:** iguais aos da tabela da C2X de outubro/2026 (`mapas/jardim-das-gerais-c2x-2026-10.json`). São 233 disponíveis com preço, e o restante da fase 1 está como vendido.
- **Calculado da geometria real:** frente, fundo, esquina e para onde a frente aponta (com o norte certo).
- **Relevo do terreno:** vem das curvas de nível do KMZ (788 a 1.089 m) e é usado no 3D.
- **Mapa-base:** `mapas/jardim-das-gerais-base.jpg` é desenhado do próprio CAD: ruas, praça, áreas verdes, institucionais e fase 2 apagada.

Ponto para confirmar: no **41-04** a planta escreve 1.396,08 m², mas o lote desenhado mede ~1.016 m² (igual aos vizinhos). O site mostra 1.396,08, que é o valor da tabela.

## Marcar vendido / disponível

No editor, use a ferramenta **Situação** (tecla **D**): cada clique num lote alterna **Disponível (verde) ↔ Vendido (vermelho)**, e Shift+clique marca Reservado. Também dá para editar pelo painel do lote, ou em massa pela planilha (`Exportar → Planilha CSV`, editar no Excel, `Importar → Planilha`).

Depois, para publicar: **Exportar → projeto.json** e substitua o arquivo no site (Netlify).

## Novo loteamento (ou atualizar este) a partir de KMZ + PDF

No editor: **Importar → Projeto completo: KMZ + planta em PDF**. Escolha:

1. o **KMZ/KML do CAD** (precisa ter a camada de lotes em polígonos; meio-fio e curvas de nível, se houver, viram ruas e relevo);
2. a **planta em PDF** exportada do CAD (com texto, não escaneada); só entram os lotes que têm número nela;
3. opcional: a **tabela de preços** (CSV `quadra;lote;area;preco;situacao`, ou o JSON no formato da C2X).

A ferramenta encaixa a planta no desenho sozinha. Ela lê a escala impressa no PDF, acha rotação e posição e confere a contagem com a tabela da planta. Depois mostra um relatório com o que precisa de atenção. Tudo roda no navegador.

O mesmo processo existe por linha de comando (gera o mapa-base com mais qualidade):

```
npm i jszip@3 pdfjs-dist@3.11.174 jpeg-js @resvg/resvg-js
node tools/importar-kmz-pdf.cjs --kmz "arquivo.kmz" --pdf "planta.pdf" --precos tabela.csv --slug nome --nome "Nome"
```

## Vários loteamentos no mesmo site

- `loteamento/projeto.json` é o loteamento principal (abre em `/loteamento/`).
- Outros: no editor, **Exportar → Loteamento extra**, coloque o arquivo em `loteamento/projetos/<nome>.json` e abra `/loteamento/?p=<nome>`.

## Arquivos

- `js/importar-planta.js`: o importador KMZ + PDF (compartilhado entre o editor e a linha de comando).
- `tools/importar-kmz-pdf.cjs`: o mesmo, por linha de comando. `tools/exportar-tabela.cjs` gera a planilha de todos os lotes.
- `tools/montar-por-imagem.cjs`: o método antigo (a partir só da imagem do mapa), para quando não houver KMZ.
- `mapas/jardim-das-gerais-aerea.jpg`: foto de drone do modo Real. A calibração foi convertida automaticamente para os lotes do KMZ; ajuste fino em `calibrar.html`.
