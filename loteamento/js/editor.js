/* LoteVivo — editor do loteamento */
(function (LV) {
  'use strict';
  const F = LV.fmt, geo = LV.geo;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const r2 = (v) => Math.round(v * 100) / 100;

  const E = {
    p: null, tool: 'select', sel: [], draft: [], scalePts: [], hist: [], tab: 'lote', assignTo: null,
    next: { quadra: '1', lote: 1, status: 'disponivel', ppm: 0 }, tol: 34, img: null, cursor: null, listQ: ''
  };
  let svg, pz, L = {};

  LV.toast = function (msg, ms) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), ms || 2600);
  };

  /* ------------------------------------------------------------ salvar / desfazer */
  let saveT = null;
  function dirty() {
    $('#saveState').textContent = 'Salvando…'; $('#saveState').classList.add('busy');
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      const ok = await LV.store.save(E.p);
      $('#saveState').textContent = ok ? 'Salvo' : 'Não salvou'; $('#saveState').classList.remove('busy');
    }, 450);
  }
  function snap() {
    E.hist.push(JSON.stringify({ lots: E.p.lots, mpu: E.p.mpu }));
    if (E.hist.length > 60) E.hist.shift();
  }
  function undo() {
    const s = E.hist.pop(); if (!s) return LV.toast('Nada para desfazer');
    const o = JSON.parse(s); E.p.lots = o.lots; E.p.mpu = o.mpu;
    E.sel = E.sel.filter((id) => E.p.lots.some((l) => l.id === id));
    drawLots(); renderSide(); dirty();
  }

  /* ------------------------------------------------------------ projeto */
  async function setProject(p, fresh) {
    E.p = LV.migrate(p); E.sel = []; E.draft = []; E.img = null; E.hist = fresh ? [] : E.hist;
    $('#eName').value = E.p.name || '';
    $('#empty').hidden = true;
    autoNext();
    await buildCanvas();
    renderSide(); renderCtx();
  }

  function autoNext() {
    const ls = E.p.lots; if (!ls.length) { E.next.quadra = '1'; E.next.lote = 1; return; }
    const last = ls[ls.length - 1]; E.next.quadra = String(last.quadra); E.next.lote = nextFree(last.quadra, +last.lote + 1);
  }
  function nextFree(q, n) { while (E.p.lots.some((l) => String(l.quadra) === String(q) && +l.lote === n)) n++; return n; }

  async function buildCanvas() {
    svg = $('#edSvg'); svg.innerHTML = '';
    const p = E.p;
    const c = await LV.groundCanvas(p, 3072);
    const url = p.image || c.toDataURL('image/jpeg', 0.85);
    LV.svg('image', { href: url, x: 0, y: 0, width: p.W, height: p.H, preserveAspectRatio: 'none' }, svg);
    L.lots = LV.svg('g', { class: 'e-lots' }, svg);
    L.pins = LV.svg('g', { class: 'e-pins' }, svg);
    L.lbl = LV.svg('g', { class: 'e-lbl' }, svg);
    L.draft = LV.svg('g', { class: 'e-draft' }, svg);
    L.handles = LV.svg('g', { class: 'e-handles' }, svg);
    // o PanZoom troca de SVG a cada projeto; os ouvintes antigos somem junto com o nó
    const fresh = svg.cloneNode(true); svg.replaceWith(fresh); svg = fresh;
    L.lots = svg.querySelector('.e-lots'); L.pins = svg.querySelector('.e-pins'); L.lbl = svg.querySelector('.e-lbl');
    L.draft = svg.querySelector('.e-draft'); L.handles = svg.querySelector('.e-handles');
    pz = new LV.PanZoom(svg, p.W, p.H, () => { drawHandles(); drawDraft(); });
    pz.onTap = onTap;
    svg.addEventListener('pointermove', (e) => { E.cursor = pz.toUnits(e.clientX, e.clientY); if (E.tool === 'poly' || E.tool === 'scale') drawDraft(); });
    svg.addEventListener('dblclick', (e) => { if (E.tool === 'poly') { e.preventDefault(); if (E.draft.length > 3) E.draft.pop(); closeDraft(); } });
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
    drawLots();
  }

  const px = () => 1 / (pz ? pz.scale() : 1);

  function drawLots() {
    if (!L.lots) return;
    L.lots.innerHTML = ''; L.pins.innerHTML = ''; L.lbl.innerHTML = '';
    const sel = new Set(E.sel);
    for (const l of E.p.lots) {
      const col = LV.STATUS[l.status].color;
      if (l.poly && l.poly.length > 2) {
        const n = LV.svg('path', { d: LV.polyD(l.poly), fill: col, class: 'e-lot' + (sel.has(l.id) ? ' sel' : '') }, L.lots);
        n.dataset.id = l.id;
        const [cx, cy] = geo.centroid(l.poly), bb = geo.bbox(l.poly);
        const t = LV.svg('text', { x: cx, y: cy, 'font-size': (Math.min(bb.w, bb.h) * 0.3).toFixed(2) }, L.lbl);
        t.textContent = l.quadra + '-' + F.pad(l.lote);
      } else if (l.pin) {
        const n = LV.svg('circle', { cx: l.pin[0], cy: l.pin[1], r: Math.max(E.p.W, E.p.H) / 260, fill: col, class: 'e-pin' + (sel.has(l.id) ? ' sel' : '') }, L.pins);
        n.dataset.id = l.id;
      }
    }
    drawHandles();
  }

  function drawHandles() {
    if (!L.handles) return;
    L.handles.innerHTML = '';
    if (E.tool !== 'select' || E.sel.length !== 1) return;
    const l = lot(E.sel[0]); if (!l) return;
    const r = 6 * px();
    if (l.poly) {
      l.poly.forEach((v, i) => {
        const a = l.poly[(i + 1) % l.poly.length];
        const m = LV.svg('circle', { cx: (v[0] + a[0]) / 2, cy: (v[1] + a[1]) / 2, r: r * 0.6, class: 'h-mid' }, L.handles);
        m.dataset.mid = i;
      });
      l.poly.forEach((v, i) => { const h = LV.svg('circle', { cx: v[0], cy: v[1], r, class: 'h-v' }, L.handles); h.dataset.v = i; });
    } else if (l.pin) { const h = LV.svg('circle', { cx: l.pin[0], cy: l.pin[1], r: r * 1.3, class: 'h-v' }, L.handles); h.dataset.pin = 1; }
    L.handles.onpointerdown = onHandleDown;
  }

  function onHandleDown(e) {
    const t = e.target, l = lot(E.sel[0]); if (!l) return;
    e.stopPropagation();
    if (t.dataset.mid != null) { snap(); const i = +t.dataset.mid; const a = l.poly[i], b = l.poly[(i + 1) % l.poly.length]; l.poly.splice(i + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); remeasure(l); drawLots(); dirty(); return; }
    if (e.button === 2 || e.altKey) { if (t.dataset.v != null && l.poly.length > 3) { snap(); l.poly.splice(+t.dataset.v, 1); remeasure(l); drawLots(); renderSide(); dirty(); } return; }
    snap(); pz.locked = true; svg.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const [x, y] = pz.toUnits(ev.clientX, ev.clientY);
      if (t.dataset.pin) l.pin = [r2(x), r2(y)]; else l.poly[+t.dataset.v] = [r2(x), r2(y)];
      t.setAttribute('cx', x); t.setAttribute('cy', y);
      const n = svg.querySelector(`[data-id="${l.id}"]`);
      if (n && l.poly) n.setAttribute('d', LV.polyD(l.poly)); else if (n) { n.setAttribute('cx', x); n.setAttribute('cy', y); }
    };
    const up = () => { pz.locked = false; svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); remeasure(l); drawLots(); renderSide(); dirty(); };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up);
  }

  function drawDraft() {
    if (!L.draft) return;
    L.draft.innerHTML = '';
    const w = 2 * px();
    const pts = E.tool === 'scale' ? E.scalePts : E.draft;
    if (!pts.length) return;
    const all = E.cursor ? pts.concat([E.cursor]) : pts;
    LV.svg('polyline', { points: all.map((v) => v.join(',')).join(' '), class: E.tool === 'scale' ? 'd-scale' : 'd-line', 'stroke-width': w }, L.draft);
    pts.forEach((v, i) => LV.svg('circle', { cx: v[0], cy: v[1], r: (i === 0 ? 6 : 4) * px(), class: i === 0 ? 'd-first' : 'd-pt' }, L.draft));
    if (E.tool === 'scale' && E.cursor) {
      const d = Math.hypot(E.cursor[0] - pts[0][0], E.cursor[1] - pts[0][1]) * E.p.mpu;
      const t = LV.svg('text', { x: E.cursor[0], y: E.cursor[1] - 10 * px(), 'font-size': 13 * px(), class: 'd-txt' }, L.draft);
      t.textContent = F.num(d, 1) + ' m (escala atual)';
    }
  }

  /* ------------------------------------------------------------ ferramentas */
  function setTool(t) {
    E.tool = t; E.draft = []; E.scalePts = [];
    $$('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    svg && svg.setAttribute('data-tool', t);
    drawDraft(); drawHandles(); renderCtx();
  }

  function onTap(e, target) {
    const [x, y] = pz.toUnits(e.clientX, e.clientY);
    const id = target && target.dataset && target.dataset.id;
    switch (E.tool) {
      case 'select':
        if (id) { if (e.shiftKey || e.ctrlKey || e.metaKey) toggleSel(id); else selectOnly(id); }
        else if (!e.shiftKey) selectOnly(null);
        break;
      case 'poly': {
        if (E.draft.length >= 3) {
          const f = E.draft[0];
          if (Math.hypot(f[0] - x, f[1] - y) < 12 * px()) return closeDraft();
        }
        E.draft.push([r2(x), r2(y)]); drawDraft(); renderCtx();
        break;
      }
      case 'wand': return runWand(x, y);
      case 'pin': return createLot(null, [r2(x), r2(y)]);
      case 'status': {
        if (!id) return;
        const l = lot(id); snap();
        l.status = e.shiftKey ? 'reservado' : l.status === 'disponivel' ? 'vendido' : 'disponivel';
        drawLots(); if (E.sel[0] === id) renderSide(); dirty();
        return LV.toast(F.lotName(l) + ': ' + LV.STATUS[l.status].label, 1400);
      }
      case 'scale': {
        E.scalePts.push([x, y]);
        if (E.scalePts.length === 2) {
          const [a, b] = E.scalePts; const du = Math.hypot(b[0] - a[0], b[1] - a[1]);
          E.scalePts = []; drawDraft();
          const m = prompt('Quantos metros tem essa distância na vida real?\n(ex.: a frente de um lote que você sabe que tem 12 m)', '');
          const v = LV.parseMoney(m);
          if (v > 0 && du > 0) {
            snap(); E.p.mpu = v / du;
            if (E.p.lots.some((l) => l.poly) && confirm('Escala definida: 1 unidade = ' + F.num(E.p.mpu, 4) + ' m.\n\nRecalcular área, frente e fundo de todos os lotes desenhados?')) E.p.lots.forEach(remeasure);
            renderSide(); dirty(); LV.toast('Escala calibrada');
          }
        } else drawDraft();
        break;
      }
    }
  }

  function closeDraft() {
    if (E.draft.length < 3) return LV.toast('Clique pelo menos 3 cantos');
    const poly = E.draft.slice(); E.draft = []; drawDraft();
    createLot(poly, null);
  }

  async function runWand(x, y) {
    if (!E.img) {
      LV.toast('Lendo a imagem…', 900);
      const c = await LV.groundCanvas(E.p, 4096);
      E.img = { data: c.getContext('2d').getImageData(0, 0, c.width, c.height), k: E.p.W / c.width };
    }
    const k = E.img.k;
    const r = LV.wand(E.img.data, x / k, y / k, E.tol);
    if (r.err) return LV.toast(r.err, 3600);
    const poly = r.poly.map((v) => [r2(v[0] * k), r2(v[1] * k)]);
    const c = geo.centroid(poly);
    const dup = E.p.lots.find((l) => l.poly && geo.pip(c, l.poly));
    if (dup) { selectOnly(dup.id); return LV.toast('Esse lote já está marcado: ' + dup.quadra + '-' + F.pad(dup.lote)); }
    createLot(poly, null);
  }

  function createLot(poly, pin) {
    snap();
    let l;
    if (E.assignTo && (l = lot(E.assignTo))) {
      if (poly) { l.poly = poly; delete l.pin; } else { l.pin = pin; }
      E.assignTo = null;
    } else {
      const q = String(E.next.quadra || '1');
      let n = +E.next.lote || 1;
      if (E.p.lots.some((x) => String(x.quadra) === q && +x.lote === n)) { n = nextFree(q, n); LV.toast('Número já usado. Pulei para o lote ' + F.pad(n)); }
      l = { id: LV.uid(), quadra: q, lote: n, status: E.next.status, preco: 0, area: 0, tags: [], obs: '' };
      if (poly) l.poly = poly; else l.pin = pin;
      E.p.lots.push(l);
      E.next.lote = nextFree(q, n + 1);
    }
    remeasure(l);
    if (E.next.ppm && l.area && !l.preco) l.preco = Math.round(l.area * E.next.ppm / 100) * 100;
    E.sel = [l.id];
    drawLots(); renderSide(); renderCtx(); dirty();
  }

  function remeasure(l) {
    if (!l.poly || l.poly.length < 3) return;
    l.area = r2(LV.lotAreaCalc(l, E.p.mpu));
    Object.assign(l, LV.measureSides(l.poly, E.p.mpu));
  }

  /* ------------------------------------------------------------ seleção */
  const lot = (id) => E.p.lots.find((l) => l.id === id);
  function selectOnly(id) { E.sel = id ? [id] : []; drawLots(); if (E.tab !== 'lote' && E.tab !== 'lotes') E.tab = 'lote'; renderSide(); }
  function toggleSel(id) { const i = E.sel.indexOf(id); i >= 0 ? E.sel.splice(i, 1) : E.sel.push(id); drawLots(); E.tab = 'lote'; renderSide(); }
  function focusLot(l) {
    const bb = l.poly ? geo.bbox(l.poly) : { x0: l.pin[0] - 3, y0: l.pin[1] - 3, w: 6, h: 6 };
    pz.focus(bb, E.p.W / 5);
  }
  function deleteSel() {
    if (!E.sel.length) return;
    if (E.sel.length > 1 && !confirm('Excluir ' + E.sel.length + ' lotes?')) return;
    snap(); E.p.lots = E.p.lots.filter((l) => !E.sel.includes(l.id)); E.sel = [];
    drawLots(); renderSide(); dirty();
  }

  /* ------------------------------------------------------------ barra de contexto */
  function renderCtx() {
    const t = E.tool, n = E.next;
    const numbering = `<label>Próximo <b>Q</b><input data-n="quadra" value="${esc(n.quadra)}" size="3"></label><label><b>L</b><input data-n="lote" type="number" min="1" value="${n.lote}" style="width:64px"></label>
      <label><select data-n="status">${LV.STATUS_KEYS.map((k) => `<option value="${k}" ${n.status === k ? 'selected' : ''}>${LV.STATUS[k].label}</option>`).join('')}</select></label>
      <label title="Preço automático pela área">R$/m² <input data-n="ppm" type="number" min="0" step="10" value="${n.ppm || ''}" placeholder="—" style="width:70px"></label>`;
    const tips = {
      select: 'Clique num lote para editar. Shift+clique seleciona vários. Arraste os pontos para ajustar; clique no ponto do meio para criar um canto; Alt+clique apaga um canto.',
      poly: E.draft.length ? `${E.draft.length} canto(s). Clique no primeiro ponto, dê dois cliques ou tecle Enter para fechar. Esc cancela.` : 'Clique em cada canto do lote.',
      wand: 'Clique no meio de um lote na imagem: o contorno é detectado sozinho.',
      pin: 'Clique sobre o lote para soltar um pino (sem contorno).',
      scale: 'Clique nas duas pontas de uma medida conhecida (ex.: a frente de um lote).',
      status: 'Clique num lote para alternar entre Disponível (verde) e Vendido (vermelho). Shift+clique marca como Reservado.'
    };
    const assign = E.assignTo ? (() => { const l = lot(E.assignTo); return l ? `<span class="assign">Desenhando o contorno do ${F.lotName(l)} <button class="link" data-do="cancelAssign">cancelar</button></span>` : ''; })() : '';
    $('#ctx').innerHTML = `<div class="ctx-row">${['poly', 'wand', 'pin'].includes(t) && !E.assignTo ? numbering : ''}${t === 'wand' ? `<label>Tolerância <input type="range" data-n="tol" min="6" max="90" value="${E.tol}"></label>` : ''}${assign}</div><p>${tips[t]}</p>`;
  }

  /* ------------------------------------------------------------ painel lateral */
  function renderSide() {
    if (!E.p) return;
    $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === E.tab));
    const b = $('#tabBody');
    b.innerHTML = ({ lote: tabLote, lotes: tabLotes, planos: tabPlanos, projeto: tabProjeto, ajuda: tabAjuda })[E.tab]();
  }

  function tabLote() {
    const p = E.p;
    if (!E.sel.length) {
      const c = {}; p.lots.forEach((l) => (c[l.status] = (c[l.status] || 0) + 1));
      const semDesenho = p.lots.filter((l) => !l.poly && !l.pin).length;
      return `<div class="pad">
        <h3 class="side-h">${esc(p.name)}</h3>
        <div class="kpis"><div><b>${p.lots.length}</b><span>lotes</span></div>${LV.STATUS_KEYS.map((k) => `<div><b style="color:${LV.STATUS[k].color}">${c[k] || 0}</b><span>${LV.STATUS[k].label.toLowerCase()}</span></div>`).join('')}</div>
        ${semDesenho ? `<p class="note">${semDesenho} lote(s) vieram da planilha sem posição no mapa. Abra a aba Lotes, escolha um e use “Desenhar no mapa”.</p>` : ''}
        <ol class="steps">
          <li><b>Calibre a escala</b> (S) medindo uma distância conhecida. Assim área e medidas saem certas.</li>
          <li><b>Marque os lotes</b> com a varinha (W), desenhando (P) ou só com pinos (I). A numeração avança sozinha.</li>
          <li><b>Preencha preço e situação</b> aqui, ou importe a planilha CSV de uma vez.</li>
          <li><b>Confira em 3D</b> no botão “Ver em 3D”. A tela atualiza sozinha enquanto você edita.</li>
        </ol></div>`;
    }
    if (E.sel.length > 1) {
      const ls = E.sel.map(lot).filter(Boolean);
      const area = ls.reduce((s, l) => s + (l.area || 0), 0);
      return `<div class="pad">
        <h3 class="side-h">${ls.length} lotes selecionados</h3>
        <p class="muted">${F.num(area, 2)} m² somados · ${F.brl(ls.reduce((s, l) => s + (l.preco || 0), 0), 0)}</p>
        <div class="form">
          <label>Situação<select data-bulk="status"><option value="">—</option>${LV.STATUS_KEYS.map((k) => `<option value="${k}">${LV.STATUS[k].label}</option>`).join('')}</select></label>
          <label>Quadra<input data-bulk="quadra" placeholder="mudar a quadra de todos"></label>
          <label>Preço por m² (R$)<input data-bulk="ppm" type="number" min="0" step="10" placeholder="calcula o preço pela área"></label>
          <label>Acrescentar característica<input data-bulk="tag" placeholder="ex.: Vista para o lago"></label>
          <button class="btn" data-do="bulkApply">Aplicar</button>
          <button class="btn" data-do="renumber">Renumerar na ordem em que cliquei</button>
          <button class="btn danger" data-do="del"><svg><use href="#t-trash"/></svg><span>Excluir selecionados</span></button>
        </div></div>`;
    }
    const l = lot(E.sel[0]); if (!l) return '';
    const calc = l.poly ? LV.lotAreaCalc(l, E.p.mpu) : 0;
    const tags = {}; E.p.lots.forEach((x) => (x.tags || []).forEach((t) => (tags[t] = 1)));
    return `<div class="pad">
      <div class="row-sb"><h3 class="side-h">${F.lotName(l)}</h3><button class="link" data-do="focus">ver no mapa</button></div>
      <div class="form two">
        <label>Quadra<input data-f="quadra" value="${esc(l.quadra)}"></label>
        <label>Lote<input data-f="lote" type="number" min="1" value="${l.lote}"></label>
      </div>
      <div class="st-pick">${LV.STATUS_KEYS.map((k) => `<button data-st="${k}" class="${l.status === k ? 'on' : ''}" style="--c:${LV.STATUS[k].color}">${LV.STATUS[k].label}</button>`).join('')}</div>
      <div class="form">
        <label>Preço (R$)<input data-f="preco" class="money" inputmode="decimal" value="${l.preco ? F.num(l.preco, 2) : ''}"></label>
        <div class="form two">
          <label>Área (m²)<input data-f="area" inputmode="decimal" value="${l.area ? F.num(l.area, 2) : ''}"></label>
          <label>R$/m²<input readonly value="${l.area && l.preco ? F.num(l.preco / l.area, 2) : '—'}"></label>
        </div>
        ${calc ? `<p class="hint">Pelo desenho e escala: ${F.num(calc, 2)} m² ${Math.abs(calc - (l.area || 0)) > 0.5 ? `<button class="link" data-do="useCalc">usar</button>` : '✓'}</p>` : ''}
        <div class="form three">
          <label>Frente (m)<input data-f="frente" inputmode="decimal" value="${l.frente ? F.num(l.frente, 1) : ''}"></label>
          <label>Fundo (m)<input data-f="fundo" inputmode="decimal" value="${l.fundo ? F.num(l.fundo, 1) : ''}"></label>
          <label>Frente para<select data-f="orientacao"><option value="">—</option>${['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'].map((o) => `<option ${l.orientacao === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
        </div>
        <label>Características <small class="muted">separe por vírgula</small><input data-f="tags" value="${esc((l.tags || []).join(', '))}" list="tagList"></label>
        <datalist id="tagList">${Object.keys(tags).map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
        <div class="chips">${['Esquina', 'Vista para o lago', 'Perto do clube', 'Área verde ao fundo', 'Plano', 'Aclive', 'Declive'].filter((t) => !(l.tags || []).includes(t)).map((t) => `<button class="chip" data-addtag="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div>
        <label>Observações<textarea data-f="obs" rows="2">${esc(l.obs || '')}</textarea></label>
      </div>
      <div class="side-actions">
        <button class="btn" data-do="draw">${l.poly ? 'Redesenhar contorno' : 'Desenhar no mapa'}</button>
        ${l.poly ? `<button class="btn" data-do="toPin">Trocar por pino</button>` : ''}
        <button class="btn danger" data-do="del"><svg><use href="#t-trash"/></svg><span>Excluir</span></button>
      </div></div>`;
  }

  function tabLotes() {
    const q = E.listQ.toLowerCase();
    const ls = E.p.lots.slice().sort((a, b) => String(a.quadra).localeCompare(String(b.quadra), 'pt', { numeric: true }) || a.lote - b.lote)
      .filter((l) => !q || (l.quadra + '-' + F.pad(l.lote)).toLowerCase().includes(q) || LV.STATUS[l.status].label.toLowerCase().includes(q) || (q === 'sem' && !l.poly && !l.pin));
    return `<div class="pad"><label class="search"><input id="listQ" placeholder="buscar: 12-04, vendido, sem (sem desenho)" value="${esc(E.listQ)}"></label></div>
      <div class="ltable"><div class="lth"><span>Lote</span><span>Situação</span><span>Área</span><span>Preço</span></div>
      ${ls.map((l) => `<button class="ltr ${E.sel.includes(l.id) ? 'on' : ''}" data-pick="${l.id}"><span>${esc(l.quadra)}-${F.pad(l.lote)}${!l.poly && !l.pin ? ' <i class="nodraw" title="sem desenho">•</i>' : ''}</span><span><i class="dot" style="background:${LV.STATUS[l.status].color}"></i>${LV.STATUS[l.status].label}</span><span>${l.area ? F.num(l.area, 0) : '—'}</span><span>${l.preco ? F.num(l.preco / 1000, 0) + ' mil' : '—'}</span></button>`).join('')}
      </div><p class="pad muted sm">${ls.length} de ${E.p.lots.length} lotes</p>`;
  }

  function tabPlanos() {
    const ex = 300000;
    return `<div class="pad"><p class="muted">Os planos aparecem como cartões no simulador de cada lote, como na tabela de vendas.</p>
      ${E.p.plans.map((pl, i) => {
        const r = LV.sim.calc({ preco: ex, plan: pl, meses: pl.meses, jurosAm: pl.jurosAm, modo: pl.modo });
        return `<div class="plan-ed" data-pi="${i}">
          <div class="row-sb"><input class="pname" data-pf="nome" value="${esc(pl.nome)}"><button class="x sm" data-do="rmPlan" data-i="${i}" aria-label="remover plano"><svg><use href="#i-x"/></svg></button></div>
          <div class="form three">
            <label>Entrada %<input type="number" data-pf="entradaPct" min="0" max="100" step="0.5" value="${pl.entradaPct}"></label>
            <label>Parcelas<input type="number" data-pf="meses" min="1" max="360" value="${pl.meses}"></label>
            <label>Juros % a.m.<input type="number" data-pf="jurosAm" min="0" step="0.01" value="${pl.jurosAm}"></label>
          </div>
          <div class="form two">
            <label>Reajuste<input data-pf="correcao" value="${esc(pl.correcao)}" placeholder="IPCA anual"></label>
            <label>Desconto %<input type="number" data-pf="descontoPct" min="0" max="50" step="0.5" value="${pl.descontoPct || 0}"></label>
          </div>
          <label class="full">Cálculo da parcela<select data-pf="modo"><option value="linear" ${pl.modo !== 'price' ? 'selected' : ''}>Saldo ÷ parcelas (valor de hoje)</option><option value="price" ${pl.modo === 'price' ? 'selected' : ''}>Tabela Price (juros na parcela)</option></select></label>
          <p class="hint">Num lote de R$ 300 mil: entrada ${F.brl(r.entradaMin, 0)} + ${pl.meses} × <b>${F.brl(r.parcela)}</b></p>
        </div>`;
      }).join('')}
      <button class="btn" data-do="addPlan">+ Novo plano</button></div>`;
  }

  function tabProjeto() {
    const p = E.p;
    return `<div class="pad form">
      <label>Nome<input data-pp="name" value="${esc(p.name)}"></label>
      <label>Subtítulo<input data-pp="subtitle" value="${esc(p.subtitle || '')}" placeholder="Loteamento residencial"></label>
      <label>Cidade / região<input data-pp="city" value="${esc(p.city || '')}"></label>
      <label>WhatsApp do corretor<input data-pp="whatsapp" value="${esc(p.whatsapp || '')}" placeholder="55 31 99999-0000" inputmode="tel"></label>
      <hr>
      <h4 class="k">Escala</h4>
      <p class="muted">1 unidade do mapa = <b>${F.num(p.mpu, 4)} m</b>. O terreno inteiro mede cerca de ${F.num(p.W * p.mpu, 0)} × ${F.num(p.H * p.mpu, 0)} m.</p>
      <button class="btn" data-do="tool-scale">Calibrar com uma medida conhecida</button>
      <button class="btn" data-do="remeasureAll">Recalcular área e medidas de todos</button>
      <hr>
      <h4 class="k">Fundo do mapa</h4>
      <p class="muted">${p.image ? 'Imagem enviada' + (p.imageCredit ? ' · ' + esc(p.imageCredit) : '') : p.demo ? 'Arte gerada do exemplo' : 'Arte gerada a partir dos lotes'}.</p>
      ${p.geo ? `<button class="btn" data-do="sat">Baixar foto de satélite da área</button>` : ''}
      <button class="btn" data-do="img">Trocar imagem</button>
      ${p.image ? `<button class="btn" data-do="noImg">Usar arte gerada</button>` : ''}
      <hr>
      <h4 class="k">Modo Realista (foto aérea)</h4>
      <p class="muted">Sobreponha a planta e os lotes a uma foto de drone do terreno. ${p.realista ? 'Foto configurada.' : 'Ainda não configurado.'}</p>
      <input type="file" id="fAerial" accept="image/*" hidden>
      <button class="btn" data-do="aerial">${p.realista ? 'Trocar foto aérea' : 'Enviar foto aérea'}</button>
      ${p.realista ? `<a class="btn primary" href="calibrar.html" target="lotevivo-cal"><svg><use href="#t-fit"/></svg><span>Calibrar (arrastar pontos)</span></a>` : ''}
      <hr>
      <h4 class="k">Começar de novo</h4>
      <button class="btn" data-do="demo">Carregar o exemplo</button>
      <button class="btn danger" data-do="blank">Apagar tudo e começar em branco</button>
    </div>`;
  }

  function tabAjuda() {
    return `<div class="pad help">
      <h4>Imagem ou KML: qual usar?</h4>
      <p><b>KML/KMZ</b> é o caminho mais preciso. Ele guarda as coordenadas reais de cada lote. No Google Earth: clique com o botão direito na pasta dos lotes e escolha <i>Salvar lugar como… → KMZ</i>. No AutoCAD/Civil 3D: exporte as polylines dos lotes para KML (comando MAPEXPORT ou um plugin). Ao importar, a área de cada lote é calculada sozinha e o editor baixa a foto de satélite do terreno.</p>
      <p><b>Imagem</b> serve para a arte de vendas ou para a planta em PDF convertida em PNG. Os pontos ficam na posição em pixels da imagem. Por isso existe a calibração de escala (S): você mede a frente de um lote conhecido e o editor passa a calcular metros.</p>
      <h4>A varinha mágica</h4>
      <p>Clique no meio de um lote na imagem. O editor “pinta” a área de cor parecida até bater nas linhas divisórias e traça o contorno. Se vazar para a rua, diminua a tolerância. Se cortar o lote no meio (por causa do número escrito dentro), aumente. Funciona melhor com a planta limpa, de linhas bem marcadas.</p>
      <h4>Nomes no KML</h4>
      <p>Nomeie cada polígono como <code>Q31 L07</code>, <code>Quadra 31 Lote 7</code> ou <code>31-07</code>. Campos extras (ExtendedData) chamados <code>quadra</code>, <code>lote</code>, <code>preco</code> e <code>status</code> também são lidos.</p>
      <h4>Planilha</h4>
      <p>Exporte a CSV, edite no Excel e importe de volta: os lotes são casados por quadra e lote. Colunas aceitas: quadra, lote, preco, area, situacao, frente, fundo, orientacao, caracteristicas, obs.</p>
      <h4>Publicar</h4>
      <p>Exporte o <code>projeto.json</code> e coloque-o na mesma pasta do <code>index.html</code>, no servidor. Quem abrir o site vê esse projeto. Para mudar preço ou situação depois, edite aqui, exporte e troque o arquivo.</p>
      <h4>Atalhos</h4>
      <p><kbd>V</kbd> selecionar · <kbd>P</kbd> desenhar · <kbd>W</kbd> varinha · <kbd>I</kbd> pino · <kbd>S</kbd> escala · <kbd>Enter</kbd> fecha o desenho · <kbd>Esc</kbd> cancela · <kbd>Del</kbd> exclui · <kbd>Ctrl+Z</kbd> desfaz</p>
    </div>`;
  }

  /* ------------------------------------------------------------ eventos do painel */
  const side = $('#tabBody');
  side.addEventListener('focusin', (e) => { if (e.target.matches('[data-f], [data-pf], [data-pp]')) snap(); });
  side.addEventListener('input', (e) => {
    const t = e.target, l = lot(E.sel[0]);
    if (t.id === 'listQ') { E.listQ = t.value; const pos = t.selectionStart; renderSide(); const n = $('#listQ'); n.focus(); n.setSelectionRange(pos, pos); return; }
    if (t.dataset.f && l) {
      const f = t.dataset.f; let v = t.value;
      if (f === 'preco' || f === 'area' || f === 'frente' || f === 'fundo') v = LV.parseMoney(v);
      else if (f === 'lote') v = parseInt(v, 10) || 1;
      else if (f === 'tags') v = v.split(',').map((s) => s.trim()).filter(Boolean);
      else if (f === 'quadra') v = v.trim().toUpperCase();
      l[f] = v; dirty();
      if (f === 'quadra' || f === 'lote') drawLots();
      return;
    }
    if (t.dataset.pf) {
      const pl = E.p.plans[+t.closest('[data-pi]').dataset.pi], f = t.dataset.pf;
      pl[f] = ['nome', 'correcao', 'modo'].includes(f) ? t.value : parseFloat(t.value) || 0;
      if (f === 'nome') pl.id = pl.id || LV.uid();
      dirty(); return;
    }
    if (t.dataset.pp) { E.p[t.dataset.pp] = t.value; if (t.dataset.pp === 'name') $('#eName').value = t.value; dirty(); }
  });
  side.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.f || t.dataset.pf) renderSide();
  });
  side.addEventListener('click', (e) => {
    const t = e.target;
    const st = t.closest('[data-st]'); if (st) { const l = lot(E.sel[0]); snap(); l.status = st.dataset.st; drawLots(); renderSide(); dirty(); return; }
    const pk = t.closest('[data-pick]'); if (pk) { const l = lot(pk.dataset.pick); E.sel = [l.id]; drawLots(); renderSide(); if (l.poly || l.pin) focusLot(l); return; }
    const at = t.closest('[data-addtag]'); if (at) { const l = lot(E.sel[0]); snap(); l.tags = (l.tags || []).concat(at.dataset.addtag); renderSide(); dirty(); return; }
  });

  /* ------------------------------------------------------------ ações gerais */
  document.addEventListener('click', async (e) => {
    const t = e.target;
    const mb = t.closest('[data-menu]');
    $$('.menu-pop.open').forEach((m) => { if (!mb || m.id !== mb.dataset.menu) m.classList.remove('open'); });
    if (mb) { $('#' + mb.dataset.menu).classList.toggle('open'); return; }
    const tool = t.closest('[data-tool]'); if (tool) return setTool(tool.dataset.tool);
    const z = t.closest('[data-z]'); if (z && pz) return z.dataset.z === 'fit' ? pz.fit() : pz.zoom(z.dataset.z === 'in' ? 0.7 : 1.4);
    if (t.closest('#bUndo')) return undo();
    const tab = t.closest('[data-tab]'); if (tab) { E.tab = tab.dataset.tab; return renderSide(); }
    const d = t.closest('[data-do]'); if (!d) return;
    const l = E.p && lot(E.sel[0]);
    switch (d.dataset.do) {
      case 'img': return $('#fImg').click();
      case 'kml': return $('#fKml').click();
      case 'pacote': return openPacote();
      case 'csv': return $('#fCsv').click();
      case 'json': return $('#fJson').click();
      case 'demo': if (E.p && E.p.lots.length && !E.p.demo && !confirm('Trocar o projeto atual pelo exemplo? Exporte antes se quiser guardar.')) return; await setProject(LV.makeDemo(), true); dirty(); return LV.toast('Exemplo carregado');
      case 'blank': if (!confirm('Apagar o projeto deste navegador?')) return; await LV.store.clear(); E.p = null; showEmpty(); return;
      case 'exJson': return LV.download('projeto.json', JSON.stringify(E.p));
      case 'exSlug': { const s = slug(E.p.id && E.p.id !== 'demo' ? E.p.id : E.p.name); E.p.id = s; dirty(); LV.download(s + '.json', JSON.stringify(E.p)); return LV.toast('Coloque o arquivo na pasta projetos/ do site e abra com ?p=' + s, 6000); }
      case 'exCsv': return LV.download(slug(E.p.name) + '-lotes.csv', LV.toCSV(E.p), 'text/csv;charset=utf-8');
      case 'del': return deleteSel();
      case 'focus': return l && (l.poly || l.pin) && focusLot(l);
      case 'useCalc': snap(); remeasure(l); renderSide(); dirty(); return;
      case 'draw': E.assignTo = l.id; setTool('poly'); return LV.toast('Clique nos cantos do lote ' + F.lotCode(l));
      case 'cancelAssign': E.assignTo = null; return renderCtx();
      case 'toPin': snap(); l.pin = geo.centroid(l.poly); delete l.poly; drawLots(); renderSide(); dirty(); return;
      case 'bulkApply': return bulkApply();
      case 'renumber': {
        const ls = E.sel.map(lot); const q = ls[0].quadra; const start = parseInt(prompt('Começar do lote número:', '1'), 10); if (!start) return;
        snap(); ls.forEach((x, i) => { x.quadra = q; x.lote = start + i; }); drawLots(); renderSide(); dirty(); return;
      }
      case 'addPlan': snap(); E.p.plans.push({ id: LV.uid(), nome: 'Novo plano', entradaPct: 10, meses: 60, correcao: 'IPCA anual', jurosAm: 0, modo: 'linear', descontoPct: 0 }); renderSide(); dirty(); return;
      case 'rmPlan': if (E.p.plans.length < 2) return LV.toast('Mantenha pelo menos um plano'); E.p.plans.splice(+d.dataset.i, 1); renderSide(); dirty(); return;
      case 'tool-scale': return setTool('scale');
      case 'remeasureAll': snap(); E.p.lots.forEach(remeasure); renderSide(); dirty(); return LV.toast('Medidas recalculadas');
      case 'sat': return satellite();
      case 'aerial': { const inp = $('#fAerial'); if (inp) inp.click(); return; }
      case 'noImg': snap(); E.p.image = null; delete E.p.imageCredit; await buildCanvas(); E.img = null; renderSide(); dirty(); return;
    }
  });

  function bulkApply() {
    const g = (k) => $(`[data-bulk="${k}"]`).value.trim();
    const ls = E.sel.map(lot).filter(Boolean);
    snap();
    const s = g('status'), q = g('quadra'), ppm = parseFloat(g('ppm')), tag = g('tag');
    ls.forEach((l) => {
      if (s) l.status = s;
      if (q) l.quadra = q.toUpperCase();
      if (ppm > 0 && l.area) l.preco = Math.round(l.area * ppm / 100) * 100;
      if (tag && !(l.tags || []).includes(tag)) l.tags = (l.tags || []).concat(tag);
    });
    drawLots(); renderSide(); dirty(); LV.toast(ls.length + ' lotes atualizados');
  }

  $('#ctx').addEventListener('input', (e) => {
    const k = e.target.dataset.n; if (!k) return;
    if (k === 'tol') E.tol = +e.target.value;
    else if (k === 'lote') E.next.lote = parseInt(e.target.value, 10) || 1;
    else if (k === 'ppm') E.next.ppm = parseFloat(e.target.value) || 0;
    else if (k === 'quadra') { E.next.quadra = e.target.value.trim().toUpperCase(); E.next.lote = nextFree(E.next.quadra, 1); const n = $('[data-n="lote"]'); if (n) n.value = E.next.lote; }
    else E.next[k] = e.target.value;
  });
  $('#eName').addEventListener('input', (e) => { if (E.p) { E.p.name = e.target.value; dirty(); } });

  /* ------------------------------------------------------------ arquivos */
  const readAs = (file, how) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r[how](file); });
  const slug = (s) => String(s || 'loteamento').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const nameOf = (f) => f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  $('#fImg').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    let url = await readAs(f, 'readAsDataURL');
    const img = await LV.loadImage(url);
    let w = img.naturalWidth, h = img.naturalHeight;
    if (Math.max(w, h) > 6000 || f.size > 7e6) {
      const k = Math.min(1, 6000 / Math.max(w, h)); const c = document.createElement('canvas');
      c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      url = c.toDataURL('image/jpeg', 0.9); w = c.width; h = c.height;
    }
    const cur = E.p;
    if (cur && cur.lots.length && !cur.demo && confirm('Manter os lotes já marcados e encaixá-los na nova imagem?\n\nOK: manter (mesma planta, outra resolução)\nCancelar: começar do zero com esta imagem')) {
      snap(); const kx = w / cur.W, ky = h / cur.H;
      cur.lots.forEach((l) => { if (l.poly) l.poly = l.poly.map((v) => [r2(v[0] * kx), r2(v[1] * ky)]); if (l.pin) l.pin = [r2(l.pin[0] * kx), r2(l.pin[1] * ky)]; });
      cur.mpu = cur.mpu / kx; cur.W = w; cur.H = h; cur.image = url; delete cur.demo; delete cur.geo; delete cur.imageCredit;
      await setProject(cur); dirty(); return;
    }
    await setProject({ id: LV.uid(), name: cur && !cur.demo ? cur.name : nameOf(f), subtitle: cur ? cur.subtitle : '', city: cur ? cur.city : '', whatsapp: cur ? cur.whatsapp : '', W: w, H: h, mpu: 800 / Math.max(w, h), image: url, plans: cur ? cur.plans : LV.defaultPlans(), lots: [] }, true);
    dirty(); setTool('wand');
    LV.toast('Imagem carregada. Primeiro calibre a escala (S), depois clique nos lotes com a varinha.', 5000);
  });

  $('#fKml').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const r = await LV.readKML(f);
      const cur = E.p;
      await setProject(Object.assign({ id: LV.uid(), name: nameOf(f), subtitle: cur && !cur.demo ? cur.subtitle : '', city: cur ? cur.city : '', whatsapp: cur ? cur.whatsapp : '', image: null, plans: cur ? cur.plans : LV.defaultPlans() }, r), true);
      dirty(); setTool('select');
      LV.toast(r.lots.length + ' lotes importados com área calculada. Baixando a foto de satélite…', 4000);
      satellite(true);
    } catch (err) { LV.toast(err.message || 'Não consegui ler o KML', 5000); }
  });

  async function satellite(auto) {
    try {
      const url = await LV.satelliteFor(E.p, (k) => { $('#saveState').textContent = 'Satélite ' + Math.round(k * 100) + '%'; });
      snap(); E.p.image = url; E.p.imageCredit = 'Imagem de satélite: Esri World Imagery';
      E.img = null; await buildCanvas(); renderSide(); dirty();
      LV.toast('Foto de satélite aplicada');
    } catch (err) { $('#saveState').textContent = 'Salvo'; if (!auto) LV.toast('Não deu para baixar o satélite agora: ' + (err.message || 'erro de rede'), 5000); }
  }

  /* ------------------------------------------------------------ projeto completo: KMZ + planta em PDF (+ tabela) */
  const loadScript = (src) => new Promise((res, rej) => { if ([...document.scripts].some((s) => s.src === src)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Sem internet para carregar o leitor de PDF')); document.head.appendChild(s); });
  const tick = () => new Promise((r) => setTimeout(r, 30));
  function openPacote() {
    $$('.menu-pop.open').forEach((m) => m.classList.remove('open'));
    const m = $('#impModal');
    const cur = E.p && !E.p.demo ? E.p : null;
    m.innerHTML = `<div class="modal-backdrop" data-imp="close"></div>
      <div class="sim imp">
        <header class="sim-head"><div><p class="eyebrow">Importar loteamento</p><h2 id="impTitle">KMZ + planta em PDF</h2>
          <p class="muted">O KMZ (exportado do CAD) traz o desenho exato de cada lote. A planta em PDF traz os números de quadra e lote. A ferramenta encaixa um no outro sozinha.</p></div>
          <button class="x" data-imp="close" aria-label="Fechar"><svg><use href="#i-x"/></svg></button></header>
        <div class="imp-body">
          <label class="imp-f"><span>Nome do loteamento</span><input id="impNome" value="${esc(cur ? cur.name : '')}" placeholder="Jardim das Gerais"></label>
          <label class="imp-f file"><span>1. KMZ ou KML do CAD <b>obrigatório</b></span><input type="file" id="impKmz" accept=".kmz,.kml"><small>Precisa ter a camada de lotes (polígonos). Curvas de nível e meio-fio, se houver, viram relevo e ruas.</small></label>
          <label class="imp-f file"><span>2. Planta em PDF <b>obrigatório</b></span><input type="file" id="impPdf" accept="application/pdf,.pdf"><small>O PDF exportado do CAD (texto vetorial, não escaneado). Só entram os lotes que têm número nesta planta, por exemplo a Fase 1.</small></label>
          <label class="imp-f file"><span>3. Tabela de preços <b class="opt">opcional</b></span><input type="file" id="impPrecos" accept=".csv,.txt,.json"><small>CSV com quadra; lote; área; preço; situação. Os lotes com preço entram como Disponível.</small></label>
          <label class="imp-f"><span>Lotes da planta que não estão na tabela</span><select id="impSem"><option value="vendido">Vendido (vermelho)</option><option value="disponivel">Disponível, sem preço</option><option value="reservado">Reservado</option></select></label>
          <div class="imp-log" id="impLog" hidden></div>
        </div>
        <footer class="imp-foot"><span class="muted" id="impMsg">Tudo é processado aqui no seu navegador.</span><button class="btn primary" data-imp="go"><span>Importar</span></button></footer>
      </div>`;
    m.hidden = false; requestAnimationFrame(() => m.classList.add('in'));
    m.onclick = async (ev) => {
      const b = ev.target.closest('[data-imp]'); if (!b) return;
      if (b.dataset.imp === 'close') { m.classList.remove('in'); setTimeout(() => (m.hidden = true), 200); return; }
      if (b.dataset.imp === 'open') { m.classList.remove('in'); setTimeout(() => (m.hidden = true), 200); return; }
      if (b.dataset.imp === 'go') { b.disabled = true; try { await rodarPacote(); } catch (err) { log('✖ ' + (err.message || err), 'err'); $('#impMsg').textContent = 'Não deu certo. Veja a mensagem acima.'; } b.disabled = false; }
    };
  }
  function log(t, cls) { const L = $('#impLog'); L.hidden = false; const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = t; L.appendChild(d); L.scrollTop = L.scrollHeight; }

  async function rodarPacote() {
    const P = LV.planta;
    const fk = $('#impKmz').files[0], fpdf = $('#impPdf').files[0], fpr = $('#impPrecos').files[0];
    if (!fk || !fpdf) throw new Error('Escolha o KMZ/KML e a planta em PDF.');
    $('#impLog').innerHTML = '';
    log('Lendo o KMZ…'); await tick();
    let kmlText;
    if (/\.kmz$/i.test(fk.name)) { const zip = await JSZip.loadAsync(fk); const k = Object.keys(zip.files).find((n) => /\.kml$/i.test(n)); if (!k) throw new Error('Não há .kml dentro do KMZ'); kmlText = await zip.files[k].async('string'); }
    else kmlText = await fk.text();
    const kml = P.parseKml(kmlText); kmlText = null;
    log(`✔ ${kml.lots.length} lotes desenhados na camada "${kml.lotLayerName}"`);
    log('Lendo a planta em PDF…'); await tick();
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await fpdf.arrayBuffer()) }).promise;
    let items = []; for (let i = 1; i <= doc.numPages; i++) items = items.concat((await (await doc.getPage(i)).getTextContent()).items);
    log(`✔ ${items.length} textos na planta`);
    log('Encaixando a planta no desenho e numerando os lotes…'); await tick();
    const precosTxt = fpr ? await fpr.text() : null;
    const slug = ($('#impNome').value || fk.name.replace(/\.[^.]+$/, '')).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'loteamento';
    const mt = P.montar(kml, items, { slug, nome: $('#impNome').value || nameOf(fk), precos: precosTxt, semTabela: $('#impSem').value });
    const { project, report, avisos, ext, fase, rel } = mt;
    log(`✔ Planta encaixada (rotação ${report.rotacao.toFixed(1)}°, escala ${report.escala ? '1:' + Math.round(report.escala / (0.0254 / 72)) : 'automática'}); ${report.acertos} números caíram dentro de lotes`);
    log(`✔ ${project.lots.length} lotes numerados em ${Object.keys(report.quadras).length} quadras`);
    if (report.divergencias.length) report.divergencias.forEach((d) => log(`⚠ Quadra ${d.quadra}: a tabela da planta diz ${d.esperado} lotes, achei ${d.achado}${d.faltam.length ? ' (faltam ' + d.faltam.join(', ') + ')' : ''}`, 'warn'));
    else if (Object.keys(report.tabela || {}).length) log('✔ Quantidade de lotes por quadra confere com a tabela da planta');
    if (report.duplicados.length) log('⚠ Números repetidos: ' + report.duplicados.join(', '), 'warn');
    avisos.forEach((a) => log('⚠ ' + a, 'warn'));
    const cont = {}; project.lots.forEach((l) => (cont[l.status] = (cont[l.status] || 0) + 1));
    log('✔ Situação: ' + Object.entries(cont).map(([k, v]) => v + ' ' + LV.STATUS[k].label.toLowerCase()).join(', '));
    // relevo em base64
    if (rel) {
      const bytes = new Uint8Array(rel.u16.buffer); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      project.relevo = { w: rel.w, h: rel.h, step: rel.step, zmin: rel.zmin, zmax: rel.zmax, data: btoa(s) };
      log(`✔ Relevo do terreno: cotas de ${rel.zmin} a ${rel.zmax} m`);
    }
    // mapa-base: sombreamento do relevo + desenho do CAD por cima
    log('Desenhando o mapa-base…'); await tick();
    const svgL = P.mapaSvg(kml, fase, ext, false);
    const cv = document.createElement('canvas'); cv.width = svgL.w; cv.height = svgL.h; const g = cv.getContext('2d');
    g.fillStyle = '#2a4029'; g.fillRect(0, 0, cv.width, cv.height);
    if (rel) { const sh = P.sombra(rel, ext); const sc = document.createElement('canvas'); sc.width = sh.w; sc.height = sh.h; sc.getContext('2d').putImageData(new ImageData(sh.data, sh.w, sh.h), 0, 0); g.drawImage(sc, 0, 0, cv.width, cv.height); }
    const url = URL.createObjectURL(new Blob([svgL.svg], { type: 'image/svg+xml' }));
    const im = await LV.loadImage(url); g.drawImage(im, 0, 0); URL.revokeObjectURL(url);
    project.image = cv.toDataURL('image/jpeg', 0.86);
    project.imageCredit = 'Desenho do projeto aprovado (KMZ/PDF)';
    Object.assign(project.fonte, { kmz: fk.name, pdf: fpdf.name, precos: fpr ? fpr.name : null });
    // mantém o que já existe no projeto atual (planos, WhatsApp, calibração da foto aérea)
    if (cur()) {
      const o = E.p; ['subtitle', 'city', 'whatsapp', 'plans', 'tabelaValidade'].forEach((k) => { if (o[k] != null) project[k] = o[k]; });
      const conv = P.converterRealista(o, project.lots); if (conv) { project.realista = conv.realista; log(`✔ Foto aérea recalibrada pelos ${conv.pares} lotes em comum`); }
    }
    await setProject(project, true); setTool('select'); dirty();
    log('Pronto! O projeto já está no editor. Para publicar: Exportar → projeto.json.', 'ok');
    $('#impMsg').innerHTML = ''; const fe = $('#impModal .imp-foot'); fe.innerHTML = `<span class="muted">${project.lots.length} lotes importados</span><button class="btn primary" data-imp="open">Ver no editor</button>`;
  }
  const cur = () => E.p && !E.p.demo && E.p.lots && E.p.lots.length;

  /* foto aérea do modo Realista */
  document.addEventListener('change', async (e) => {
    if (e.target.id !== 'fAerial') return;
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    let url = await readAs(f, 'readAsDataURL');
    const img = await LV.loadImage(url);
    let w = img.naturalWidth, h = img.naturalHeight;
    if (Math.max(w, h) > 2600 || f.size > 4e6) { const k = Math.min(1, 2600 / Math.max(w, h)); const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); url = c.toDataURL('image/jpeg', 0.88); w = c.width; h = c.height; }
    snap();
    const old = E.p.realista;
    E.p.realista = { image: url, w, h, points: old && old.points ? old.points : [[E.p.W * 0.37, E.p.H * 0.37, w * 0.56, h * 0.46], [E.p.W * 0.8, E.p.H * 0.5, w * 0.95, h * 0.33], [E.p.W * 0.5, E.p.H * 0.18, w * 0.62, h * 0.12], [E.p.W * 0.27, E.p.H * 0.62, w * 0.5, h * 0.9]] };
    renderSide(); dirty();
    LV.toast('Foto aérea enviada. Abra “Calibrar” e arraste os pontos até as ruas baterem.', 5500);
  });

  $('#fCsv').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      let text = await readAs(f, 'readAsText');
      if (text.includes('�')) text = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsText(f, 'windows-1252'); });
      const rows = LV.parseCSV(text); snap();
      const r = LV.applyCSV(E.p, rows);
      drawLots(); renderSide(); dirty();
      LV.toast(`${r.upd} lote(s) atualizados${r.add ? `, ${r.add} novo(s) sem desenho (veja a aba Lotes)` : ''}`, 5000);
    } catch (err) { LV.toast(err.message || 'Planilha inválida', 5000); }
  });

  $('#fJson').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const p = JSON.parse(await readAs(f, 'readAsText')); if (!p.lots || !p.W) throw 0; await setProject(p, true); dirty(); LV.toast('Projeto carregado'); }
    catch (err) { LV.toast('Esse arquivo não é um projeto do LoteVivo'); }
  });

  /* ------------------------------------------------------------ teclado */
  document.addEventListener('keydown', (e) => {
    if (e.target.matches && e.target.matches('input, textarea, select')) { if (e.key === 'Escape') e.target.blur(); return; }
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); return undo(); }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const map = { v: 'select', p: 'poly', w: 'wand', i: 'pin', s: 'scale', d: 'status' };
    if (map[k] && E.p) return setTool(map[k]);
    if (k === 'enter' && E.tool === 'poly') return closeDraft();
    if (k === 'escape') { if (E.draft.length || E.scalePts.length) { E.draft = []; E.scalePts = []; drawDraft(); renderCtx(); } else if (E.assignTo) { E.assignTo = null; renderCtx(); } else selectOnly(null); return; }
    if (k === 'backspace' && E.tool === 'poly' && E.draft.length) { E.draft.pop(); drawDraft(); renderCtx(); return; }
    if ((k === 'delete' || k === 'backspace') && E.sel.length) { e.preventDefault(); deleteSel(); }
  });

  /* ------------------------------------------------------------ início */
  function showEmpty() {
    $('#empty').hidden = false; $('#eName').value = '';
    $('#edSvg').innerHTML = ''; $('#ctx').innerHTML = ''; $('#tabBody').innerHTML = '<div class="pad muted">Escolha como começar.</div>';
  }

  (async function boot() {
    let d = await LV.store.loadDraft();
    // projeto publicado (projeto.json, ou projetos/<nome>.json com ?p=nome)
    const slugP = new URLSearchParams(location.search).get('p');
    let pub = null;
    try { const r = await fetch(slugP ? 'projetos/' + encodeURIComponent(slugP) + '.json' : 'projeto.json', { cache: 'no-store' }); if (r.ok) pub = await r.json(); } catch (e) {}
    const gerado = (x) => (x && x.fonte && x.fonte.geradoEm) || '';
    if (pub && (!d || (slugP && d.id !== pub.id))) { d = pub; await LV.store.save(d); }
    if (d) { await setProject(d, true); setTool('select'); }
    else showEmpty();
    // rascunho mais antigo que o publicado: oferece trocar, sem travar a tela
    if (pub && d !== pub && gerado(pub) > gerado(d)) {
      const bar = document.createElement('div'); bar.className = 'pub-bar';
      bar.innerHTML = `<span>Existe uma versão publicada mais nova de <b>${esc(pub.name)}</b> (gerada em ${gerado(pub).split('-').reverse().join('/')}). Você está vendo o rascunho deste navegador.</span><button class="btn primary sm" data-pub="open">Abrir a publicada</button><button class="btn sm" data-pub="keep">Manter o rascunho</button>`;
      document.body.appendChild(bar);
      bar.onclick = async (ev) => { const b = ev.target.closest('[data-pub]'); if (!b) return; if (b.dataset.pub === 'open') { await setProject(pub, true); setTool('select'); await LV.store.save(pub); LV.toast('Versão publicada aberta'); } bar.remove(); };
    }
  })();
})(window.LV);
