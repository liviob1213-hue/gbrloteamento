/* LoteVivo — experiência pública */
(function (LV) {
  'use strict';
  const F = LV.fmt;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const st = {
    p: null, view: '3d', mode: 'status', sel: null, compare: [],
    f: { q: '', status: new Set(LV.STATUS_KEYS), price: null, area: null, tags: new Set() },
    lim: null
  };
  let scene = null, map = null, real = null;

  LV.toast = function (msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2200);
  };

  /* ------------------------------------------------------------ início */
  async function boot() {
    const p = await LV.store.load();
    st.p = p;
    $('#introName').textContent = p.name; $('#introCity').textContent = p.city || '';
    document.title = p.name + ' · Explore o loteamento';

    let gl = true;
    try {
      const c = document.createElement('canvas');
      gl = !!(window.THREE && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { gl = false; }

    map = new LV.Map2D($('#stage2d'), { onSelect: (l) => select(l && l.id), onHover: tip, onQuadra: focusQuadra });
    if (gl) {
      scene = new LV.Scene3D($('#stage3d'), {
        onSelect: (l) => select(l && l.id, { from3d: true }),
        onHover: tip,
        onQuadra: focusQuadra,
        onUserMove: () => setTour(false),
        onFrame: (s) => { $('#compass i').parentNode.style.transform = 'rotate(' + (s.azimuth() * 180 / Math.PI).toFixed(1) + 'deg)'; }
      });
    }
    // modo Realista: foto aérea com a planta e os lotes registrados por cima
    if (LV.realPoints(p)) {
      $('#segReal').hidden = false;
      real = new LV.RealScene($('#stagereal'), { onSelect: (l) => select(l && l.id), onQuadra: focusQuadra });
    }
    render();
    await Promise.all([scene ? scene.load(p) : null, map.load(p), real ? real.load(p) : null]);
    if (!gl) { $('#nogl').hidden = false; setView('2d'); $$('.seg button')[0].disabled = true; }
    setTimeout(() => $('#intro').classList.add('out'), scene ? 1700 : 300);
    setTimeout(() => $('#intro').remove(), 3200);
    fromHash();

    LV.store.onUpdate(async () => {
      if (new URLSearchParams(location.search).has('demo')) return;
      const d = await LV.store.loadDraft(); if (!d) return;
      st.p = LV.migrate(d); st.lim = null;
      render();
      if (scene) await scene.load(st.p, { keepCamera: true });
      map.bgFor = null; await map.load(st.p);
      if (real && LV.realPoints(st.p)) { $('#segReal').hidden = false; await real.load(st.p); } else if (LV.realPoints(st.p) && LV.RealScene) { $('#segReal').hidden = false; real = new LV.RealScene($('#stagereal'), { onSelect: (l) => select(l && l.id) }); await real.load(st.p); }
      applyFilter();
      if (st.sel) select(st.sel, { noFly: true });
      LV.toast('Atualizado pelo editor');
    });
  }

  function render() {
    const p = st.p;
    st.quadras = LV.quadrasOf(p);
    $('#pName').textContent = p.name; $('#pSub').textContent = [p.subtitle, p.city].filter(Boolean).join(' · ');
    renderCounts(); renderFilters(); renderGrid(); renderLegend(); applyFilter(true);
  }

  function renderCounts() {
    const c = {}; st.p.lots.forEach((l) => (c[l.status] = (c[l.status] || 0) + 1));
    const PL = { disponivel: 'disponíveis', reservado: 'reservados', vendido: 'vendidos', indisponivel: 'indisponíveis' };
    $('#counts').innerHTML = LV.STATUS_KEYS.filter((k) => c[k]).map((k) => `<span><i style="background:${LV.STATUS[k].color}"></i><b>${c[k]}</b> ${c[k] > 1 ? PL[k] : LV.STATUS[k].label.toLowerCase()}</span>`).join('');
  }

  function renderLegend() {
    $('#legend').innerHTML = st.mode === 'valor'
      ? '<span class="ramp"><i></i></span><span class="muted">menor → maior R$/m²</span>'
      : LV.STATUS_KEYS.map((k) => `<span><i style="background:${LV.STATUS[k].color}"></i>${LV.STATUS[k].label}</span>`).join('');
  }

  /* ------------------------------------------------------------ filtros */
  function limits() {
    if (st.lim) return st.lim;
    const pr = st.p.lots.map((l) => l.preco).filter((v) => v > 0), ar = st.p.lots.map((l) => l.area).filter((v) => v > 0);
    st.lim = {
      price: [Math.floor(Math.min(...pr, 0 || Infinity) / 1000) * 1000 || 0, Math.ceil(Math.max(...pr, 0) / 1000) * 1000 || 1],
      area: [Math.floor(Math.min(...ar, Infinity) || 0), Math.ceil(Math.max(...ar, 0)) || 1]
    };
    if (!isFinite(st.lim.price[0])) st.lim.price[0] = 0;
    return st.lim;
  }

  function renderFilters() {
    const lim = limits(), f = st.f;
    const c = {}; st.p.lots.forEach((l) => (c[l.status] = (c[l.status] || 0) + 1));
    $('#fStatus').innerHTML = LV.STATUS_KEYS.filter((k) => c[k]).map((k) => `<button class="chip ${f.status.has(k) ? 'on' : ''}" data-st="${k}"><i style="background:${LV.STATUS[k].color}"></i>${LV.STATUS[k].label} <small>${c[k]}</small></button>`).join('')
      + `<button class="chip ghost" data-st="__only">Só disponíveis</button>`;
    const tags = {}; st.p.lots.forEach((l) => (l.tags || []).forEach((t) => (tags[t] = (tags[t] || 0) + 1)));
    const tk = Object.keys(tags).sort((a, b) => tags[b] - tags[a]);
    $('#fTagsWrap').hidden = !tk.length;
    $('#fTags').innerHTML = tk.map((t) => `<button class="chip ${f.tags.has(t) ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)} <small>${tags[t]}</small></button>`).join('');
    setupRange('#fPrice', lim.price, f.price, 1000, (v) => { f.price = v; applyFilter(); }, (v) => F.brl(v, 0).replace('R$ ', 'R$ '));
    setupRange('#fArea', lim.area, f.area, 1, (v) => { f.area = v; applyFilter(); }, (v) => F.num(v) + ' m²');
  }

  function setupRange(sel, lim, cur, step, onChange, fmt) {
    const [a, b] = $$(sel + ' input');
    [a, b].forEach((i) => { i.min = lim[0]; i.max = lim[1]; i.step = step; });
    a.value = cur ? cur[0] : lim[0]; b.value = cur ? cur[1] : lim[1];
    const lbl = $(sel + 'Lbl');
    const upd = (fire) => {
      let x = +a.value, y = +b.value; if (x > y) [x, y] = [y, x];
      lbl.textContent = fmt(x) + ' – ' + fmt(y);
      const full = x <= lim[0] && y >= lim[1];
      const wrap = $(sel); wrap.style.setProperty('--a', ((x - lim[0]) / (lim[1] - lim[0] || 1)) * 100 + '%'); wrap.style.setProperty('--b', ((y - lim[0]) / (lim[1] - lim[0] || 1)) * 100 + '%');
      if (fire) onChange(full ? null : [x, y]);
    };
    a.oninput = b.oninput = () => upd(true);
    upd(false);
  }

  function matches(l) {
    const f = st.f;
    if (!f.status.has(l.status)) return false;
    if (f.price && (l.preco < f.price[0] || l.preco > f.price[1])) return false;
    if (f.area && (l.area < f.area[0] || l.area > f.area[1])) return false;
    if (f.tags.size && ![...f.tags].every((t) => (l.tags || []).includes(t))) return false;
    if (f.q) {
      const q = f.q.toLowerCase().replace(/quadra|lote|q|l/g, ' ').trim();
      const parts = q.split(/[\s\-\/.,]+/).filter(Boolean);
      if (parts.length >= 2) return String(l.quadra).toLowerCase() === parts[0].replace(/^0+/, '') && +l.lote === +parts[1];
      if (parts.length === 1) return String(l.quadra).toLowerCase() === parts[0].replace(/^0+/, '') || String(l.quadra).toLowerCase() === parts[0];
    }
    return true;
  }

  function applyFilter(silent) {
    const f = st.f;
    const active = f.q || f.status.size < LV.STATUS_KEYS.length || f.price || f.area || f.tags.size;
    const ids = active ? new Set(st.p.lots.filter(matches).map((l) => l.id)) : null;
    st.ids = ids;
    if (scene && scene.entries.length) scene.setFilter(ids);
    if (map.paths) map.setFilter(ids);
    if (real) real.setFilter(ids);
    if (st.view === 'grade') renderGradeView();
    if (st.view === 'tabela') renderTabelaView();
    const n = ids ? ids.size : st.p.lots.length;
    $('#fCount').textContent = active ? n + (n === 1 ? ' lote encontrado' : ' lotes encontrados') : st.p.lots.length + ' lotes';
    const nf = (f.q ? 1 : 0) + (f.status.size < LV.STATUS_KEYS.length ? 1 : 0) + (f.price ? 1 : 0) + (f.area ? 1 : 0) + f.tags.size;
    const badge = $('#filterBadge'); badge.hidden = !nf; badge.textContent = nf;
    $$('#grid .lchip').forEach((b) => b.classList.toggle('dim', !!ids && !ids.has(b.dataset.id)));
    if (!silent && ids && ids.size === 1) select([...ids][0]);
  }

  function renderGrid() {
    const groups = new Map();
    st.p.lots.slice().sort((a, b) => cmpQ(a.quadra, b.quadra) || a.lote - b.lote).forEach((l) => {
      if (!groups.has(l.quadra)) groups.set(l.quadra, []); groups.get(l.quadra).push(l);
    });
    $('#grid').innerHTML = [...groups].map(([q, ls]) => {
      const disp = ls.filter((l) => l.status === 'disponivel').length;
      return `<div class="qcard"><div class="qh"><button class="qgo" data-q="${esc(q)}" title="Ver a quadra ${esc(q)} no mapa">Quadra ${esc(q)}<svg><use href="#i-search"/></svg></button><small>${disp}/${ls.length} livres</small></div><div class="lchips">${ls.map((l) => `<button class="lchip" data-id="${l.id}" style="--c:${LV.STATUS[l.status].color}" title="${F.lotName(l)} · ${LV.STATUS[l.status].label}">${F.pad(l.lote)}</button>`).join('')}</div></div>`;
    }).join('');
  }
  const cmpQ = (a, b) => { const x = parseFloat(a), y = parseFloat(b); return isFinite(x) && isFinite(y) ? x - y : String(a).localeCompare(String(b)); };

  /* ------------------------------------------------------------ quadra */
  /* o número da quadra é o atalho: clicou nele, os três mapas vão até ela */
  function focusQuadra(q, o) {
    o = o || {};
    q = String(q);
    const qd = (st.quadras || []).find((x) => x.q === q);
    if (!qd) return;
    const go = () => {
      if (map && map.focusQuadra) map.focusQuadra(q);
      if (real && real.focusQuadra) real.focusQuadra(q);
      if (scene && scene.focusQuadra) scene.focusQuadra(q);
    };
    // nas páginas de grade e tabela não há mapa para enquadrar: abre o mapa primeiro
    if (st.view === 'grade' || st.view === 'tabela') { setView('2d'); requestAnimationFrame(go); } else go();
    if (!o.quiet) LV.toast('Quadra ' + q + ' · ' + qd.livres + ' de ' + qd.lots.length + ' lotes livres');
    if (innerWidth < 760) $('#explore').classList.remove('open');
  }

  /* "41", "q41", "quadra 41" → a quadra; com o lote junto ("41-04") a busca já abre o lote */
  function quadraOfQuery(s) {
    if (!s) return null;
    const parts = String(s).toLowerCase().replace(/quadra|lote|q|l/g, ' ').split(/[\s\-\/.,]+/).filter(Boolean);
    if (parts.length !== 1) return null;
    const k = parts[0].replace(/^0+/, '');
    const qd = (st.quadras || []).find((x) => x.q.toLowerCase().replace(/^0+/, '') === k);
    return qd ? qd.q : null;
  }

  /* ------------------------------------------------------------ seleção */
  function select(id, o) {
    o = o || {};
    st.sel = id || null;
    const l = id && st.p.lots.find((x) => x.id === id);
    if (scene) scene.select(l ? id : null, !o.noFly);
    map.select(l ? id : null, !o.noFly);
    if (real) real.select(l ? id : null, st.view === 'real' && !o.noFly);
    $$('#grid .lchip').forEach((b) => b.classList.toggle('sel', b.dataset.id === id));
    if (!l) { $('#lotPanel').classList.remove('open'); if (location.hash) history.replaceState(null, '', location.pathname + location.search); return; }
    if (scene && !l.poly && !l.pin) LV.toast('Este lote ainda não foi posicionado no mapa');
    renderLot(l);
    $('#lotPanel').classList.add('open');
    if (innerWidth < 760) $('#explore').classList.remove('open');
    history.replaceState(null, '', '#lote=' + encodeURIComponent(F.lotCode(l)));
    tip(null);
  }

  function renderLot(l) {
    const s = LV.STATUS[l.status], ppm = l.area ? l.preco / l.area : 0;
    const best = LV.minParcela(st.p, l);
    const sib = st.p.lots.filter((x) => x.quadra === l.quadra).sort((a, b) => a.lote - b.lote);
    const i = sib.indexOf(l), prev = sib[i - 1], next = sib[i + 1];
    const inCmp = st.compare.includes(l.id);
    const avail = l.status === 'disponivel';
    $('#lotPanel').innerHTML = `
      <div class="drawer-head lot-head">
        <div>
          <span class="badge" style="--c:${s.color}">${s.label}</span>
          <h2>${F.lotName(l)}</h2>
          <p class="muted">${l.area ? F.m2(l.area) : 'área não informada'}${ppm ? ' · ' + F.brl(ppm, 0) + '/m²' : ''}</p>
        </div>
        <button class="x" data-close="lot" aria-label="Fechar"><svg><use href="#i-x"/></svg></button>
      </div>
      <div class="drawer-body">
        ${avail || l.status === 'indisponivel' && l.preco ? `<div class="price-block">
          <span class="k">Valor do lote</span>
          <b class="price">${l.preco ? F.brl(l.preco, 0) : 'Consulte'}</b>
          ${best && l.preco ? `<span class="from">ou a partir de <b>${F.brl(best.r.parcela)}</b>/mês no plano ${esc(best.pl.nome)}</span>` : ''}
        </div>` : `<div class="price-block off" style="--c:${s.color}">
          <span class="k">Situação</span>
          <b class="price">${s.label}</b>
          <span class="from">${l.status === 'vendido' ? 'Este lote já foi vendido. Veja os vizinhos disponíveis abaixo.' : 'Este lote está reservado no momento.'}</span>
        </div>`}
        <div class="facts">
          ${fact('Área', l.area ? F.num(l.area, 2) + ' m²' : '—')}
          ${fact('Frente', l.frente ? F.num(l.frente, 1) + ' m' : '—')}
          ${fact('Fundo', l.fundo ? F.num(l.fundo, 1) + ' m' : '—')}
          ${fact('Frente para', l.orientacao ? orient(l.orientacao) : '—')}
        </div>
        ${(l.tags || []).length ? `<div class="tags">${l.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
        ${l.obs ? `<p class="obs">${esc(l.obs)}</p>` : ''}
        ${scene && st.view === '3d' && l.poly ? `<p class="sun-tip"><svg><use href="#i-sun"/></svg> Arraste o horário lá embaixo para ver a sombra da casa ao longo do dia.</p>` : ''}
        <div class="actions">
          ${avail && l.preco ? `<button class="btn primary big" data-a="sim"><svg><use href="#i-calc"/></svg><span>Simular pagamento</span></button>` : ''}
          <div class="row2">
            <button class="btn" data-a="cmp" aria-pressed="${inCmp}"><svg><use href="#i-scale"/></svg><span>${inCmp ? 'Na comparação' : 'Comparar'}</span></button>
            <button class="btn" data-a="share"><svg><use href="#i-share"/></svg><span>Compartilhar</span></button>
          </div>
          ${st.p.whatsapp ? `<button class="btn wa" data-a="wa"><svg><use href="#i-chat"/></svg><span>Falar com o corretor</span></button>` : ''}
        </div>
        <div class="sib">
          <button class="btn ghost sm" data-a="go" data-id="${prev ? prev.id : ''}" ${prev ? '' : 'disabled'}><svg><use href="#i-left"/></svg><span>${prev ? 'Lote ' + F.pad(prev.lote) : ''}</span></button>
          <span class="muted">Quadra ${esc(l.quadra)} · ${i + 1} de ${sib.length}</span>
          <button class="btn ghost sm" data-a="go" data-id="${next ? next.id : ''}" ${next ? '' : 'disabled'}><span>${next ? 'Lote ' + F.pad(next.lote) : ''}</span><svg><use href="#i-right"/></svg></button>
        </div>
      </div>`;
  }
  const fact = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
  const ORI = { N: 'Norte · sol o dia todo', S: 'Sul · sombra na frente', L: 'Leste · sol da manhã', O: 'Oeste · sol da tarde', NE: 'Nordeste · sol da manhã', NO: 'Noroeste · sol da tarde', SE: 'Sudeste', SO: 'Sudoeste' };
  const orient = (o) => ORI[String(o).toUpperCase()] || esc(o);

  /* ------------------------------------------------------------ dica flutuante */
  function tip(l, x, y) {
    const t = $('#tip');
    if (!l || matchMedia('(pointer: coarse)').matches) { t.hidden = true; return; }
    const s = LV.STATUS[l.status];
    t.innerHTML = `<b>${F.lotName(l)}</b><span><i style="background:${s.color}"></i>${s.label}</span><span>${l.area ? F.m2(l.area) : ''}${l.preco ? ' · ' + F.brl(l.preco, 0) : ''}</span>`;
    t.hidden = false;
    const r = t.getBoundingClientRect();
    t.style.left = Math.min(innerWidth - r.width - 8, x + 16) + 'px';
    t.style.top = Math.min(innerHeight - r.height - 8, y + 16) + 'px';
  }

  /* ------------------------------------------------------------ comparação */
  function toggleCompare(id) {
    const i = st.compare.indexOf(id);
    if (i >= 0) st.compare.splice(i, 1);
    else { if (st.compare.length >= 3) st.compare.shift(); st.compare.push(id); }
    renderTray();
    const l = st.p.lots.find((x) => x.id === st.sel); if (l) renderLot(l);
  }
  function renderTray() {
    const t = $('#tray'), ls = st.compare.map((id) => st.p.lots.find((l) => l.id === id)).filter(Boolean);
    t.hidden = !ls.length;
    t.innerHTML = ls.map((l) => `<span class="tchip" style="--c:${LV.STATUS[l.status].color}">${F.lotCode(l)}<button data-rm="${l.id}" aria-label="tirar"><svg><use href="#i-x"/></svg></button></span>`).join('')
      + `<button class="btn primary sm" data-a="cmpOpen" ${ls.length < 2 ? 'disabled' : ''}>Comparar ${ls.length}</button>`;
  }
  function openCompare() {
    const ls = st.compare.map((id) => st.p.lots.find((l) => l.id === id)).filter(Boolean);
    const rows = [
      ['Situação', (l) => `<span class="badge" style="--c:${LV.STATUS[l.status].color}">${LV.STATUS[l.status].label}</span>`],
      ['Valor', (l) => F.brl(l.preco, 0), (l) => l.preco, 'min'],
      ['Área', (l) => F.m2(l.area), (l) => l.area, 'max'],
      ['R$/m²', (l) => (l.area ? F.brl(l.preco / l.area, 0) : '—'), (l) => (l.area ? l.preco / l.area : Infinity), 'min'],
      ['Frente', (l) => (l.frente ? F.num(l.frente, 1) + ' m' : '—'), (l) => l.frente || 0, 'max'],
      ['Fundo', (l) => (l.fundo ? F.num(l.fundo, 1) + ' m' : '—')],
      ['Frente para', (l) => (l.orientacao ? orient(l.orientacao) : '—')],
      ['Menor parcela', (l) => { const b = LV.minParcela(st.p, l); return b ? F.brl(b.r.parcela) + ` <small>× ${b.pl.meses}</small>` : '—'; }, (l) => { const b = LV.minParcela(st.p, l); return b ? b.r.parcela : Infinity; }, 'min'],
      ['Destaques', (l) => (l.tags || []).map(esc).join('<br>') || '—']
    ];
    const m = $('#cmpModal');
    m.innerHTML = `<div class="modal-backdrop" data-a="cmpClose"></div><div class="cmp">
      <header class="sim-head"><h2>Comparando ${ls.length} lotes</h2><button class="x" data-a="cmpClose" aria-label="Fechar"><svg><use href="#i-x"/></svg></button></header>
      <div class="cmp-scroll"><table><thead><tr><th></th>${ls.map((l) => `<th><button class="link" data-a="go" data-id="${l.id}">${F.lotName(l)}</button></th>`).join('')}</tr></thead>
      <tbody>${rows.map(([k, fmt, val, best]) => {
        let win = null;
        if (val) { const vs = ls.map(val); const b = best === 'min' ? Math.min(...vs) : Math.max(...vs); if (vs.filter((v) => v === b).length === 1) win = vs.indexOf(b); }
        return `<tr><td>${k}</td>${ls.map((l, i) => `<td class="${i === win ? 'win' : ''}">${fmt(l)}</td>`).join('')}</tr>`;
      }).join('')}</tbody></table></div>
      <p class="muted foot">Em destaque, o melhor de cada linha.</p></div>`;
    m.hidden = false; requestAnimationFrame(() => m.classList.add('in'));
  }
  function closeCompare() { const m = $('#cmpModal'); m.classList.remove('in'); setTimeout(() => (m.hidden = true), 200); }

  /* ------------------------------------------------------------ visão, modo, sol */
  function setView(v) {
    const prev = st.view;
    st.view = v;
    $$('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    $('#stage3d').hidden = v !== '3d'; $('#stage2d').hidden = v !== '2d'; $('#stagereal').hidden = v !== 'real';
    $('#stagegrade').hidden = v !== 'grade'; $('#stagetabela').hidden = v !== 'tabela';
    const page = v === 'grade' || v === 'tabela';
    document.body.classList.toggle('is2d', v === '2d' || page);
    document.body.classList.toggle('isreal', v === 'real');
    document.body.classList.toggle('ispage', page);
    $('#realbar').hidden = v !== 'real';
    if (v !== '3d') setTour(false);
    if (v === '3d' && scene) scene.resize();
    if (v === 'real' && real) { requestAnimationFrame(() => { real.resize(); if (prev !== 'real') real.reveal(); }); }
    if (v === 'grade') renderGradeView();
    if (v === 'tabela') renderTabelaView();
    const l = st.sel && st.p.lots.find((x) => x.id === st.sel); if (l) renderLot(l);
  }

  /* ------------------------------------------------------------ grade e tabela de preços */
  const PLURAL = { disponivel: 'disponíveis', reservado: 'reservados', vendido: 'vendidos', indisponivel: 'indisponíveis' };
  function sortedLots() { return st.p.lots.slice().sort((a, b) => cmpQ(a.quadra, b.quadra) || a.lote - b.lote); }
  function validade() {
    if (st.p.tabelaValidade) return st.p.tabelaValidade;
    const s = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(' de ', '/');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function renderGradeView() {
    const groups = new Map(); sortedLots().forEach((l) => { if (!groups.has(l.quadra)) groups.set(l.quadra, []); groups.get(l.quadra).push(l); });
    const c = {}; st.p.lots.forEach((l) => (c[l.status] = (c[l.status] || 0) + 1));
    $('#stagegrade').innerHTML = `<div class="pv-wrap">
      <header class="pv-head"><div><h2>Grade de lotes</h2><p class="muted">${esc(st.p.name)} · ${LV.STATUS_KEYS.filter((k) => c[k]).map((k) => c[k] + ' ' + (c[k] > 1 ? PLURAL[k] : LV.STATUS[k].label.toLowerCase())).join(' · ')}</p></div>
        <div class="pv-legend">${LV.STATUS_KEYS.filter((k) => c[k]).map((k) => `<span><i style="background:${LV.STATUS[k].color}"></i>${LV.STATUS[k].label}</span>`).join('')}</div></header>
      <div class="gv">${[...groups].map(([q, ls]) => `<section class="gq"><h3><button class="qgo" data-q="${esc(q)}" title="Ver a quadra ${esc(q)} no mapa">Quadra ${esc(q)}<svg><use href="#i-search"/></svg></button> <small>${ls.filter((l) => l.status === 'disponivel').length}/${ls.length} livres</small></h3>
        <div class="gchips">${ls.map((l) => `<button class="gchip${st.ids && !st.ids.has(l.id) ? ' dim' : ''}${st.sel === l.id ? ' sel' : ''}" data-gid="${l.id}" style="--c:${LV.STATUS[l.status].color}" title="${F.lotName(l)} · ${LV.STATUS[l.status].label}${l.preco && l.status === 'disponivel' ? ' · ' + F.brl(l.preco, 0) : ''}">${F.pad(l.lote)}</button>`).join('')}</div></section>`).join('')}</div></div>`;
  }
  function tabelaRows() {
    return sortedLots().filter((l) => l.status === 'disponivel' && l.preco && (!st.ids || st.ids.has(l.id)));
  }
  function renderTabelaView() {
    const plans = st.p.plans, ls = tabelaRows();
    const cells = (l) => plans.map((pl) => { const r = LV.sim.calc({ preco: l.preco, plan: pl, meses: pl.meses, jurosAm: pl.jurosAm, modo: pl.modo }); return `<td>${F.num(r.entrada, 2)}</td><td><b>${F.num(r.parcela, 2)}</b></td>`; }).join('');
    $('#stagetabela').innerHTML = `<div class="pv-wrap">
      <header class="pv-head"><div><p class="eyebrow">Tabela de preços</p><h2>${esc(st.p.name)}</h2>
        <p class="muted">Tabela válida para o mês de ${esc(validade())}. Somente unidades disponíveis neste momento; as condições podem ser alteradas sem aviso prévio.</p></div>
        <div class="pv-actions"><span class="muted">${ls.length} unidade${ls.length === 1 ? '' : 's'}${st.ids ? ' (com filtro)' : ''}</span><button class="btn" data-a="tabPdf"><svg><use href="#i-print"/></svg><span>Baixar PDF</span></button></div></header>
      <div class="tv-scroll"><table class="tv">
        <thead><tr><th colspan="5" class="grp">Unidade</th>${plans.map((pl) => `<th colspan="2" class="grp">${esc(pl.nome).toUpperCase()}</th>`).join('')}</tr>
        <tr><th>Nº</th><th>Quadra</th><th>Lote</th><th>Área (m²)</th><th>Preço (R$)</th>${plans.map((pl) => `<th>Sinal (${F.num(pl.entradaPct)}%)</th><th>${pl.meses} Parcelas</th>`).join('')}</tr></thead>
        <tbody>${ls.map((l, i) => `<tr data-tid="${l.id}"${st.sel === l.id ? ' class="sel"' : ''}><td>${i + 1}</td><td>${esc(l.quadra)}</td><td>${F.pad(l.lote)}</td><td>${F.num(l.area, 2)}</td><td><b>${F.num(l.preco, 2)}</b></td>${cells(l)}</tr>`).join('')}</tbody>
      </table></div></div>`;
  }
  function printTabela() {
    const plans = st.p.plans, ls = tabelaRows();
    const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    $('#print').innerHTML = `<div class="pp pp-tabela"><header><div><p class="eyebrow">Tabela de preços</p><h1>${esc(st.p.name)}</h1><p>Válida para ${esc(validade())} · ${ls.length} unidades disponíveis</p></div><div class="right"><p>${today}</p></div></header>
      <table class="flow-t tabela"><thead><tr><th>Nº</th><th>Quadra</th><th>Lote</th><th>Área (m²)</th><th>Preço (R$)</th>${plans.map((pl) => `<th>${esc(pl.nome)}<br>Sinal ${F.num(pl.entradaPct)}%</th><th>${pl.meses}×</th>`).join('')}</tr></thead>
      <tbody>${ls.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.quadra)}</td><td>${F.pad(l.lote)}</td><td>${F.num(l.area, 2)}</td><td>${F.num(l.preco, 2)}</td>${plans.map((pl) => { const r = LV.sim.calc({ preco: l.preco, plan: pl, meses: pl.meses, jurosAm: pl.jurosAm, modo: pl.modo }); return `<td>${F.num(r.entrada, 2)}</td><td>${F.num(r.parcela, 2)}</td>`; }).join('')}</tr>`).join('')}</tbody></table>
      <p class="disc">Somente unidades disponíveis na data de emissão. Valores e condições sujeitos a alteração sem aviso prévio; confirmados no contrato.</p></div>`;
    setTimeout(() => window.print(), 150);
  }
  function setMode(m) {
    st.mode = m;
    $('#btnValor').setAttribute('aria-pressed', m === 'valor');
    if (scene) scene.setMode(m);
    if (real) real.setMode(m);
    map.setMode(m); renderLegend();
    LV.toast(m === 'valor' ? 'Mapa de valor: altura e cor mostram o R$/m² dos lotes livres' : 'Cores por situação');
  }
  function setTour(on) {
    st.tour = on; $('#btnTour').setAttribute('aria-pressed', !!on);
    if (scene) { if (on) scene.overview(); scene.setTour(on); }
  }
  function setHour(h) {
    if (scene) scene.setHour(h);
    $('#hour').value = h;
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60 / 5) * 5;
    $('#hourLbl').textContent = F.pad(hh + (mm === 60 ? 1 : 0)) + ':' + F.pad(mm === 60 ? 0 : mm);
  }
  let sunAnim = null;
  function playSun() {
    if (sunAnim) { cancelAnimationFrame(sunAnim); sunAnim = null; $('#btnPlaySun use').setAttribute('href', '#i-play'); return; }
    $('#btnPlaySun use').setAttribute('href', '#i-pause');
    let h = +$('#hour').value; if (h > 19) h = 5.5;
    let last = performance.now();
    const step = (now) => {
      h += ((now - last) / 1000) * 1.1; last = now;
      if (h >= 20) { h = 20; setHour(h); sunAnim = null; $('#btnPlaySun use').setAttribute('href', '#i-play'); return; }
      setHour(h); sunAnim = requestAnimationFrame(step);
    };
    sunAnim = requestAnimationFrame(step);
  }

  function fromHash() {
    if (/(^|#|&)real\b/.test(location.hash) && real) setTimeout(() => setView('real'), scene ? 1800 : 100);
    const pv = location.hash.match(/(?:^#|&)(grade|tabela|mapa)\b/); if (pv) setView(pv[1] === 'mapa' ? '2d' : pv[1]);
    const m = location.hash.match(/lote=([^&]+)/); if (!m) return;
    const [q, n] = decodeURIComponent(m[1]).split('-');
    const l = st.p.lots.find((x) => String(x.quadra) === q && +x.lote === +n);
    if (l) setTimeout(() => select(l.id), scene ? 2600 : 200);
  }

  /* ------------------------------------------------------------ eventos */
  document.addEventListener('click', (e) => {
    const t = e.target;
    const v = t.closest('[data-view]'); if (v) return setView(v.dataset.view);
    const c = t.closest('[data-close]');
    if (c) { if (c.dataset.close === 'lot') select(null); else $('#' + c.dataset.close).classList.remove('open'); return; }
    if (t.closest('#btnExplore')) { $('#explore').classList.toggle('open'); if (innerWidth < 760) $('#lotPanel').classList.remove('open'); return; }
    if (t.closest('#btnValor')) return setMode(st.mode === 'valor' ? 'status' : 'valor');
    if (t.closest('#btnTour')) return setTour(!st.tour);
    if (t.closest('#btnFull')) { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); return; }
    if (t.closest('#btnHome')) { select(null); return scene && scene.overview(); }
    if (t.closest('#btnTop')) return scene && scene.topView();
    if (t.closest('#btnPlaySun')) return playSun();
    const sc = t.closest('[data-st]');
    if (sc) {
      const k = sc.dataset.st;
      if (k === '__only') st.f.status = new Set(['disponivel']);
      else if (st.f.status.size === LV.STATUS_KEYS.length) st.f.status = new Set([k]);
      else { st.f.status.has(k) ? st.f.status.delete(k) : st.f.status.add(k); if (!st.f.status.size) st.f.status = new Set(LV.STATUS_KEYS); }
      renderFilters(); return applyFilter();
    }
    const tg = t.closest('[data-tag]');
    if (tg) { const k = tg.dataset.tag; st.f.tags.has(k) ? st.f.tags.delete(k) : st.f.tags.add(k); renderFilters(); return applyFilter(); }
    if (t.closest('#fClear')) { st.f = { q: '', status: new Set(LV.STATUS_KEYS), price: null, area: null, tags: new Set() }; $('#fQ').value = ''; renderFilters(); return applyFilter(); }
    const qg = t.closest('.qgo'); if (qg) return focusQuadra(qg.dataset.q);
    const lc = t.closest('.lchip'); if (lc) return select(lc.dataset.id);
    const gc = t.closest('[data-gid]'); if (gc) { select(gc.dataset.gid, { noFly: true }); return renderGradeView(); }
    const tr = t.closest('[data-tid]'); if (tr) { select(tr.dataset.tid, { noFly: true }); $$('#stagetabela tr.sel').forEach((x) => x.classList.remove('sel')); tr.classList.add('sel'); return; }
    const rm = t.closest('[data-rm]'); if (rm) return toggleCompare(rm.dataset.rm);
    const a = t.closest('[data-a]'); if (!a) return;
    const l = st.p.lots.find((x) => x.id === st.sel);
    switch (a.dataset.a) {
      case 'sim': LV.Simulator.open(st.p, l, { snapshot: scene && st.view === '3d' ? () => scene.snapshot() : null }); break;
      case 'cmp': toggleCompare(l.id); break;
      case 'tabPdf': printTabela(); break;
      case 'cmpOpen': openCompare(); break;
      case 'cmpClose': closeCompare(); break;
      case 'go': if (a.dataset.id) { closeCompare(); select(a.dataset.id); } break;
      case 'share': {
        const url = location.href;
        if (navigator.share) navigator.share({ title: st.p.name + ' · ' + F.lotName(l), url }).catch(() => {});
        else navigator.clipboard.writeText(url).then(() => LV.toast('Link do lote copiado'));
        break;
      }
      case 'wa': window.open('https://wa.me/' + String(st.p.whatsapp).replace(/\D/g, '') + '?text=' + encodeURIComponent('Olá! Tenho interesse no ' + F.lotName(l) + ' do ' + st.p.name + '. ' + location.href), '_blank', 'noopener'); break;
    }
  });
  let qTimer = null, qLast = null;
  $('#fQ').addEventListener('input', (e) => {
    st.f.q = e.target.value.trim(); applyFilter();
    // digitou só o número da quadra: o mapa já vai até ela
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      const q = quadraOfQuery(st.f.q);
      if (q && q !== qLast) focusQuadra(q, { quiet: true });
      qLast = q;
    }, 420);
  });
  $('#hour').addEventListener('input', (e) => { if (sunAnim) playSun(); setHour(+e.target.value); });
  $('#blend').addEventListener('input', (e) => { if (real) real.setBlend(+e.target.value); });
  document.addEventListener('keydown', (e) => {
    if (e.target.matches && e.target.matches('input, textarea, select')) return;
    if (e.key === 'Escape') { if (!$('#cmpModal').hidden) closeCompare(); else if (LV.Simulator.isOpen()) LV.Simulator.close(); else select(null); }
    if (e.key === '/') { e.preventDefault(); $('#explore').classList.add('open'); $('#fQ').focus(); }
  });
  window.addEventListener('hashchange', fromHash);

  boot().catch((e) => { console.error(e); LV.toast('Não foi possível abrir o projeto'); });
})(window.LV);
