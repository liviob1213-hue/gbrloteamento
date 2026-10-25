/* LoteVivo — simulador de pagamento (modal) e proposta em PDF */
window.LV = window.LV || {};
(function (LV) {
  'use strict';
  const F = LV.fmt;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (v) => F.num(v, 2);
  const MAX_MESES = 180;

  let S = null; // estado da simulação aberta

  function planOf() { return S.p.plans.find((x) => x.id === S.planId) || S.p.plans[0]; }

  function calc(plan, overrides) {
    const o = Object.assign({
      preco: S.lot.preco, plan, descTipo: S.descTipo, desc: S.desc,
      entrada: null, entradaVezes: 1, bens: [], anuaisQtd: 0, anuaisValor: 0,
      meses: plan.meses, jurosAm: plan.jurosAm, modo: plan.modo
    }, overrides || {});
    return LV.sim.calc(o);
  }
  function current() {
    return calc(planOf(), {
      entrada: S.entrada, entradaVezes: S.entradaVezes, bens: S.bens, anuaisQtd: S.anuaisQtd,
      anuaisValor: S.anuaisValor, meses: S.meses, jurosAm: S.jurosAm, modo: S.modo
    });
  }

  function applyPlan(id) {
    const pl = S.p.plans.find((x) => x.id === id) || S.p.plans[0];
    Object.assign(S, { planId: pl.id, meses: pl.meses, jurosAm: pl.jurosAm, modo: pl.modo, entrada: null, alvo: null });
  }

  /* menor parcela entre os planos, para o "a partir de" */
  LV.minParcela = function (p, lot) {
    let best = null;
    p.plans.forEach((pl) => {
      const r = LV.sim.calc({ preco: lot.preco, plan: pl, meses: pl.meses, jurosAm: pl.jurosAm, modo: pl.modo });
      if (!best || r.parcela < best.r.parcela) best = { r, pl };
    });
    return best;
  };

  function open(p, lot, opts) {
    const longest = p.plans.reduce((a, b) => (b.meses > a.meses ? b : a), p.plans[0]);
    S = { p, lot, opts: opts || {}, cliente: '', descTipo: '%', desc: 0, entradaModo: 'R$', entradaVezes: 1, bens: [], anuaisQtd: 0, anuaisValor: 0, alvo: null };
    applyPlan(longest.id);
    const m = $('#simModal');
    m.hidden = false; document.body.classList.add('modal-open');
    renderAll();
    requestAnimationFrame(() => m.classList.add('in'));
  }

  function close() {
    const m = $('#simModal'); m.classList.remove('in');
    setTimeout(() => { m.hidden = true; m.innerHTML = ''; document.body.classList.remove('modal-open'); }, 200);
  }

  function renderAll() {
    const m = $('#simModal'), l = S.lot, st = LV.STATUS[l.status] || {};
    m.innerHTML = `
      <div class="modal-backdrop" data-act="close"></div>
      <div class="sim">
        <header class="sim-head">
          <div>
            <p class="eyebrow" style="color:${st.color}">${esc(st.label || '')}</p>
            <h2 id="simTitle">${F.lotName(l)}</h2>
            <p class="muted">${esc(S.p.name)} · ${F.m2(l.area)}${l.area ? ' · ' + F.brl(l.preco / l.area, 0) + '/m²' : ''}</p>
          </div>
          <div class="sim-head-actions">
            <button class="btn" data-act="pdf"><svg><use href="#i-print"/></svg><span>Salvar em PDF</span></button>
            <button class="x" data-act="close" aria-label="Fechar"><svg><use href="#i-x"/></svg></button>
          </div>
        </header>
        <div class="sim-client">
          <label for="simCliente">Simulação para</label>
          <input id="simCliente" data-k="cliente" placeholder="nome do cliente (opcional)" value="${esc(S.cliente)}">
          <small class="muted">Só aparece na proposta. Não reserva o lote nem cadastra ninguém.</small>
        </div>
        <div class="sim-body">
          <div class="sim-left" id="simLeft"></div>
          <div class="sim-right" id="simRight"></div>
        </div>
      </div>`;
    renderLeft(); renderRight();
    m.onclick = onClick; m.oninput = onInput; m.onchange = onChange;
    m.onkeydown = (e) => { if (e.key === 'Escape') close(); };
    setTimeout(() => { const c = $('#simCliente'); if (c && matchMedia('(pointer:fine)').matches) c.focus(); }, 60);
  }

  function renderLeft() {
    const r = current(), pl = planOf();
    const entradaVal = S.entradaModo === '%' ? F.num(r.entradaPct, 1) : money(r.entrada);
    $('#simLeft').innerHTML = `
      <section class="card">
        <h4>O lote</h4>
        <div class="row-sb"><span class="muted">Valor de tabela</span><b>${F.brl(S.lot.preco)}</b></div>
        <div class="desc-row">
          <span class="muted">Desconto</span>
          <div class="seg-mini">${['%', 'R$'].map((k) => `<button data-act="descTipo" data-v="${k}" class="${S.descTipo === k ? 'on' : ''}">${k}</button>`).join('')}</div>
          <input class="money" data-k="desc" inputmode="decimal" placeholder="0" value="${S.desc ? (S.descTipo === '%' ? F.num(S.desc, 1) : money(S.desc)) : ''}">
        </div>
        ${pl.descontoPct ? `<p class="hint">O plano ${esc(pl.nome)} já dá ${F.num(pl.descontoPct, 1)}% de desconto.</p>` : ''}
        <div class="row-sb total"><span>Valor simulado</span><b id="oValor">${F.brl(r.valor)}</b></div>
      </section>

      <section class="card">
        <h4>Quanto o cliente quer pagar por mês</h4>
        <label class="money-in"><span>R$</span><input class="money" data-k="alvo" inputmode="decimal" placeholder="digite e o prazo se ajusta" value="${S.alvo ? money(S.alvo) : ''}"></label>
        <div class="chips">${[1500, 2000, 3000, 4000, 6000].map((v) => `<button class="chip ${S.alvo === v ? 'on' : ''}" data-act="alvo" data-v="${v}">R$ ${F.num(v)}</button>`).join('')}</div>
        <p class="hint" id="oAlvo"></p>
      </section>

      <section class="card">
        <h4>Entrada</h4>
        <div class="row-sb">
          <span class="muted">Valor</span>
          <div class="seg-mini">${['R$', '%'].map((k) => `<button data-act="entradaModo" data-v="${k}" class="${S.entradaModo === k ? 'on' : ''}">${k}</button>`).join('')}</div>
        </div>
        <label class="money-in"><span>${S.entradaModo}</span><input class="money" data-k="entrada" inputmode="decimal" value="${entradaVal}"></label>
        <p class="hint" id="oEntrada"></p>
        <div class="stepper">
          <button data-act="step" data-k="entradaVezes" data-v="-1" aria-label="menos"><svg><use href="#i-minus"/></svg></button>
          <b>${S.entradaVezes}</b>
          <button data-act="step" data-k="entradaVezes" data-v="1" aria-label="mais"><svg><use href="#i-plus"/></svg></button>
          <span class="muted" id="oEntradaVezes"></span>
        </div>
      </section>

      <section class="card">
        <h4>Bens e permutas</h4>
        ${S.bens.map((b, i) => `
          <div class="bem">
            <input data-bem="${i}" data-f="desc" placeholder="carro, terreno, imóvel…" value="${esc(b.desc)}">
            <label class="money-in sm"><span>R$</span><input class="money" data-bem="${i}" data-f="valor" inputmode="decimal" value="${b.valor ? money(b.valor) : ''}"></label>
            <button class="x sm" data-act="rmBem" data-v="${i}" aria-label="remover"><svg><use href="#i-x"/></svg></button>
          </div>`).join('')}
        <button class="btn ghost sm" data-act="addBem"><svg><use href="#i-plus"/></svg><span>Acrescentar bem ou permuta</span></button>
      </section>

      <section class="card">
        <h4>Parcelas anuais (reforço)</h4>
        <div class="stepper">
          <button data-act="step" data-k="anuaisQtd" data-v="-1" aria-label="menos"><svg><use href="#i-minus"/></svg></button>
          <b>${S.anuaisQtd}</b>
          <button data-act="step" data-k="anuaisQtd" data-v="1" aria-label="mais"><svg><use href="#i-plus"/></svg></button>
          <span class="muted">${S.anuaisQtd ? 'reforço(s) anual(is) de' : 'sem reforço anual'}</span>
        </div>
        ${S.anuaisQtd ? `<label class="money-in"><span>R$</span><input class="money" data-k="anuaisValor" inputmode="decimal" value="${S.anuaisValor ? money(S.anuaisValor) : ''}" placeholder="valor de cada reforço"></label>` : ''}
        <p class="hint">Até ${r.maxAnuais} reforço(s) dentro de ${r.meses} meses.</p>
      </section>

      <section class="card">
        <h4>Prazo, juros e reajuste</h4>
        <div class="row-sb"><span class="muted">Parcelas</span><input class="num" data-k="meses" type="number" min="1" max="${MAX_MESES}" value="${S.meses}"></div>
        <input type="range" data-k="meses" min="1" max="${MAX_MESES}" value="${S.meses}" aria-label="Número de parcelas">
        <div class="row-sb"><span class="muted">Reajuste</span><span>${esc(pl.correcao || '—')}</span></div>
        <div class="row-sb"><span class="muted">Juros</span><span class="inline"><input class="num" data-k="jurosAm" type="number" step="0.01" min="0" value="${S.jurosAm}"> % a.m.</span></div>
        <div class="row-sb"><span class="muted">Cálculo</span>
          <select data-k="modo"><option value="linear" ${S.modo !== 'price' ? 'selected' : ''}>saldo ÷ parcelas</option><option value="price" ${S.modo === 'price' ? 'selected' : ''}>Tabela Price (com juros)</option></select>
        </div>
        <p class="hint" id="oModo"></p>
      </section>`;
    updateHints(r);
  }

  function updateHints(r) {
    r = r || current();
    const pl = planOf();
    const set = (id, h) => { const e = $(id); if (e) e.innerHTML = h; };
    set('#oValor', F.brl(r.valor));
    set('#oEntrada', r.abaixoMin
      ? `<span class="warn">Abaixo do mínimo de ${F.num(pl.entradaPct)}% (${F.brl(r.entradaMin, 0)})</span> <button class="link" data-act="entradaMin">usar o mínimo</button>`
      : `${F.num(r.entradaPct, 1)}% do valor · mínimo ${F.brl(r.entradaMin, 0)}`);
    set('#oEntradaVezes', r.entradaVezes > 1 ? `vezes de ${F.brl(r.entradaParcela)}` : 'à vista');
    set('#oModo', r.modo === 'price'
      ? `Parcela fixa com ${F.num(r.jurosAm, 2)}% a.m. embutido. ${esc(pl.correcao)} corrige o contrato ao longo do prazo.`
      : `${r.jurosAm ? F.num(r.jurosAm, 2) + '% a.m. e ' : ''}${esc(pl.correcao)} entram no aniversário do contrato. A parcela acima é o valor de hoje.`);
    const a = $('#oAlvo');
    if (a) {
      if (!S.alvo) a.innerHTML = 'O prazo é recalculado para a parcela caber no bolso.';
      else if (S.alvoFalta) a.innerHTML = `<span class="warn">Em ${MAX_MESES} meses, para pagar ${F.brl(S.alvo, 0)}/mês a entrada precisa ser ${F.brl(S.alvoFalta, 0)}.</span> <button class="link" data-act="alvoEntrada">usar essa entrada</button>`;
      else a.innerHTML = `Com ${F.brl(S.alvo, 0)}/mês: <b>${r.meses} parcelas</b> de ${F.brl(r.parcela)}.`;
    }
  }

  function solveAlvo() {
    S.alvoFalta = 0;
    if (!S.alvo) return;
    const base = calc(planOf(), { entrada: S.entrada, bens: S.bens, anuaisQtd: S.anuaisQtd, anuaisValor: S.anuaisValor, meses: MAX_MESES, jurosAm: S.jurosAm, modo: S.modo });
    const i = S.modo === 'price' ? S.jurosAm / 100 : 0;
    let n = LV.sim.mesesPara(base.financiado, i, S.alvo, S.modo);
    if (n > MAX_MESES) {
      const pv = LV.sim.pvDe(S.alvo, i, MAX_MESES, S.modo);
      S.alvoFalta = Math.max(0, base.valor - base.bens - base.anuais - pv);
      n = MAX_MESES;
    }
    S.meses = Math.max(1, n);
  }

  function renderRight() {
    const r = current(), pl = planOf();
    const cards = S.p.plans.map((p) => {
      const c = calc(p);
      return `<button class="plan ${p.id === S.planId ? 'on' : ''}" data-act="plan" data-v="${p.id}">
        <h5>${esc(p.nome)}</h5>
        <p class="muted">entrada ${F.brl(c.entradaMin, 0)} (${F.num(p.entradaPct)}%) · ${p.meses} meses</p>
        <span class="k">Valor do lote</span><b>${F.brl(c.valor, 0)}</b>
        <span class="muted sm">${c.desconto ? 'com ' + F.brl(c.desconto, 0) + ' de desconto' : 'sem desconto'}</span>
        <span class="k">Parcela mensal</span><b class="big">${F.brl(c.parcela)} <small>× ${p.meses}</small></b>
        <span class="muted sm">${!p.correcao || /^sem/i.test(p.correcao) ? 'sem correção' : 'correção: ' + esc(p.correcao)}</span>
      </button>`;
    }).join('');
    $('#simRight').innerHTML = `
      <h4 class="sec">Tabela do empreendimento, aplicada a este lote</h4>
      <div class="plans">${cards}</div>
      <div class="result">
        <div class="row-sb"><h4>Simulação montada</h4><span class="muted">Plano ${esc(pl.nome)}</span></div>
        <div class="bigline"><b class="parcela" id="oParcela">${F.brl(r.parcela)}</b><span class="muted">por mês, ${r.meses} vezes</span></div>
        <div class="stats">
          <div><span>Entrada</span><b>${F.brl(r.entrada, 0)}</b><small>${F.num(r.entradaPct, 1)}% do valor${r.entradaVezes > 1 ? ' · em ' + r.entradaVezes + 'x' : ''}</small></div>
          <div><span>Anuais</span><b>${r.anuaisQtd ? F.brl(r.anuais, 0) : '—'}</b><small>${r.anuaisQtd ? r.anuaisQtd + ' × ' + F.brl(r.anuaisValor, 0) : 'sem reforço'}</small></div>
          <div><span>Bens e permutas</span><b>${r.bens ? F.brl(r.bens, 0) : '—'}</b><small>${r.bens ? S.bens.filter((b) => b.valor).length + ' item(ns)' : 'nenhum'}</small></div>
          <div><span>A financiar</span><b>${F.brl(r.financiado, 0)}</b><small>depois da entrada, bens e reforços</small></div>
          <div class="tot"><span>Total pago</span><b>${F.brl(r.totalPago, 0)}</b><small>${r.juros > 1 ? F.brl(r.juros, 0) + ' de juros' : 'igual ao valor negociado'}</small></div>
        </div>
        ${chart(r)}
      </div>
      <div class="sim-actions">
        <button class="btn primary" data-act="whats"><svg><use href="#i-chat"/></svg><span>Enviar no WhatsApp</span></button>
        <button class="btn" data-act="copy"><svg><use href="#i-copy"/></svg><span>Copiar resumo</span></button>
      </div>
      <p class="foot muted">Simulação com os planos cadastrados do empreendimento. Valores e prazo são confirmados com o corretor.</p>`;
  }

  /* fluxo por ano em barras empilhadas */
  function chart(r) {
    const f = r.fluxo; if (!f.length) return '';
    const tot = f.map((y) => y.entrada + y.parcelas + y.anuais), max = Math.max(...tot) || 1;
    const W = 560, H = 120, gap = 3, bw = Math.max(4, (W - gap * (f.length - 1)) / f.length);
    const bars = f.map((y, i) => {
      const x = i * (bw + gap); let top = H;
      const seg = (v, cls) => { if (!v) return ''; const h = Math.max(1.5, (v / max) * (H - 4)); top -= h; return `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" class="${cls}"><title>Ano ${i + 1}: ${F.brl(v, 0)}</title></rect>`; };
      return seg(y.parcelas, 'b-p') + seg(y.anuais, 'b-a') + seg(y.entrada, 'b-e');
    }).join('');
    const ticks = f.length <= 15 ? f.map((_, i) => `<span>${i + 1}</span>`).join('') : `<span>1</span><span style="flex:1"></span><span>${f.length}</span>`;
    return `<div class="flow"><div class="row-sb"><span class="k">Quanto sai por ano</span><span class="lg"><i class="b-e"></i>entrada <i class="b-p"></i>parcelas <i class="b-a"></i>reforços</span></div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="flow-svg">${bars}</svg><div class="ticks">${ticks}</div></div>`;
  }

  function onInput(e) {
    const t = e.target, k = t.dataset.k;
    if (t.dataset.bem != null) {
      const b = S.bens[+t.dataset.bem];
      if (t.dataset.f === 'valor') b.valor = LV.parseMoney(t.value); else b.desc = t.value;
      if (S.alvo) solveAlvo();
      renderRight(); updateHints(); return;
    }
    if (!k) return;
    if (k === 'cliente') { S.cliente = t.value; return; }
    if (k === 'desc') S.desc = LV.parseMoney(t.value);
    else if (k === 'entrada') {
      const v = LV.parseMoney(t.value);
      const valor = calc(planOf()).valor;
      S.entrada = S.entradaModo === '%' ? valor * v / 100 : v;
    } else if (k === 'alvo') S.alvo = LV.parseMoney(t.value) || null;
    else if (k === 'anuaisValor') S.anuaisValor = LV.parseMoney(t.value);
    else if (k === 'meses') {
      S.meses = Math.max(1, Math.min(MAX_MESES, parseInt(t.value, 10) || 1)); S.alvo = null;
      document.querySelectorAll('#simModal [data-k="meses"]').forEach((x) => { if (x !== t) x.value = S.meses; });
    } else if (k === 'jurosAm') S.jurosAm = Math.max(0, parseFloat(String(t.value).replace(',', '.')) || 0);
    if (S.alvo && k !== 'meses') solveAlvo();
    renderRight(); updateHints();
  }

  function onChange(e) {
    const t = e.target, k = t.dataset.k;
    if (k === 'modo') { S.modo = t.value; if (S.alvo) solveAlvo(); renderLeft(); renderRight(); }
    else if (k === 'meses' || k === 'alvo' || k === 'anuaisValor') renderLeft();
    else if (t.classList.contains('money') && t.value) {
      const v = LV.parseMoney(t.value);
      t.value = (k === 'desc' && S.descTipo === '%') || (k === 'entrada' && S.entradaModo === '%') ? F.num(v, 1) : money(v);
    }
  }

  function onClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act, v = b.dataset.v;
    if (a === 'close') return close();
    if (a === 'plan') { applyPlan(v); if (S.alvo) solveAlvo(); }
    else if (a === 'descTipo') { S.descTipo = v; S.desc = 0; }
    else if (a === 'entradaModo') S.entradaModo = v;
    else if (a === 'entradaMin') S.entrada = null;
    else if (a === 'alvo') { S.alvo = +v; solveAlvo(); }
    else if (a === 'alvoEntrada') { S.entrada = Math.ceil(S.alvoFalta / 100) * 100; solveAlvo(); }
    else if (a === 'step') {
      const k = b.dataset.k, r = current();
      if (k === 'entradaVezes') S.entradaVezes = Math.max(1, Math.min(12, S.entradaVezes + +v));
      if (k === 'anuaisQtd') {
        S.anuaisQtd = Math.max(0, Math.min(r.maxAnuais, S.anuaisQtd + +v));
        if (S.anuaisQtd && !S.anuaisValor) S.anuaisValor = Math.round(r.valor * 0.03 / 1000) * 1000;
        if (S.alvo) solveAlvo();
      }
    } else if (a === 'addBem') S.bens.push({ desc: '', valor: 0 });
    else if (a === 'rmBem') { S.bens.splice(+v, 1); if (S.alvo) solveAlvo(); }
    else if (a === 'pdf') return pdf();
    else if (a === 'whats') return whats();
    else if (a === 'copy') { navigator.clipboard && navigator.clipboard.writeText(resumo()).then(() => LV.toast('Resumo copiado')); return; }
    else return;
    renderLeft(); renderRight();
  }

  function resumo() {
    const r = current(), l = S.lot, pl = planOf();
    const lines = [
      `*${S.p.name}* · ${F.lotName(l)}`,
      `${F.m2(l.area)} · tabela ${F.brl(l.preco, 0)}`,
      S.cliente ? `Simulação para: ${S.cliente}` : null,
      ``, `Plano ${pl.nome}`,
      r.desconto ? `Desconto: ${F.brl(r.desconto, 0)} → valor ${F.brl(r.valor, 0)}` : `Valor: ${F.brl(r.valor, 0)}`,
      `Entrada: ${F.brl(r.entrada, 0)}${r.entradaVezes > 1 ? ` em ${r.entradaVezes}x de ${F.brl(r.entradaParcela)}` : ''}`,
      r.bens ? `Bens/permutas: ${F.brl(r.bens, 0)}` : null,
      r.anuaisQtd ? `Reforços: ${r.anuaisQtd} × ${F.brl(r.anuaisValor, 0)}` : null,
      `*${r.meses} parcelas de ${F.brl(r.parcela)}*`,
      `Reajuste: ${pl.correcao || '—'}`,
      `Total: ${F.brl(r.totalPago, 0)}`,
      ``, `Simulação sujeita a confirmação com o corretor.`
    ];
    return lines.filter((x) => x != null).join('\n');
  }

  function whats() {
    const phone = String(S.p.whatsapp || '').replace(/\D/g, '');
    window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(resumo()), '_blank', 'noopener');
  }

  function pdf() {
    const r = current(), l = S.lot, pl = planOf();
    const shot = S.opts.snapshot ? S.opts.snapshot() : null;
    const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const rows = r.fluxo.map((y, i) => `<tr><td>Ano ${i + 1}</td><td>${y.entrada ? F.brl(y.entrada) : '—'}</td><td>${F.brl(y.parcelas)}</td><td>${y.anuais ? F.brl(y.anuais) : '—'}</td><td><b>${F.brl(y.entrada + y.parcelas + y.anuais)}</b></td></tr>`).join('');
    $('#print').innerHTML = `
      <div class="pp">
        <header><div><p class="eyebrow">Proposta de simulação</p><h1>${esc(S.p.name)}</h1><p>${esc(S.p.city || '')}</p></div><div class="right"><p>${today}</p>${S.cliente ? `<p>Para <b>${esc(S.cliente)}</b></p>` : ''}</div></header>
        <section class="pp-lot">
          ${shot ? `<img src="${shot}" alt="">` : ''}
          <div>
            <h2>${F.lotName(l)}</h2>
            <table class="kv">
              <tr><td>Área</td><td>${F.m2(l.area)}</td></tr>
              ${l.frente ? `<tr><td>Frente × fundo</td><td>${F.num(l.frente, 1)} m × ${F.num(l.fundo, 1)} m</td></tr>` : ''}
              ${l.orientacao ? `<tr><td>Orientação da frente</td><td>${esc(l.orientacao)}</td></tr>` : ''}
              <tr><td>Valor de tabela</td><td>${F.brl(l.preco)}</td></tr>
              ${(l.tags || []).length ? `<tr><td>Destaques</td><td>${l.tags.map(esc).join(', ')}</td></tr>` : ''}
            </table>
          </div>
        </section>
        <section class="pp-big"><span>Plano ${esc(pl.nome)}</span><b>${F.brl(r.parcela)}</b><span>por mês, ${r.meses} vezes · reajuste: ${esc(pl.correcao || '—')}</span></section>
        <table class="kv wide">
          ${r.desconto ? `<tr><td>Desconto</td><td>${F.brl(r.desconto)}</td></tr>` : ''}
          <tr><td>Valor negociado</td><td>${F.brl(r.valor)}</td></tr>
          <tr><td>Entrada</td><td>${F.brl(r.entrada)} (${F.num(r.entradaPct, 1)}%)${r.entradaVezes > 1 ? ` em ${r.entradaVezes}x de ${F.brl(r.entradaParcela)}` : ' à vista'}</td></tr>
          ${S.bens.filter((b) => b.valor).map((b) => `<tr><td>Bem / permuta</td><td>${esc(b.desc || 'sem descrição')} · ${F.brl(b.valor)}</td></tr>`).join('')}
          ${r.anuaisQtd ? `<tr><td>Reforços anuais</td><td>${r.anuaisQtd} × ${F.brl(r.anuaisValor)}</td></tr>` : ''}
          <tr><td>Saldo financiado</td><td>${F.brl(r.financiado)}</td></tr>
          <tr><td>Parcelas</td><td>${r.meses} × ${F.brl(r.parcela)} ${r.modo === 'price' ? `(Tabela Price, ${F.num(r.jurosAm, 2)}% a.m.)` : ''}</td></tr>
          <tr class="tot"><td>Total pago</td><td>${F.brl(r.totalPago)}</td></tr>
        </table>
        <h3>Fluxo por ano</h3>
        <table class="flow-t"><thead><tr><th></th><th>Entrada</th><th>Parcelas</th><th>Reforços</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
        <p class="disc">Simulação ilustrativa com os planos cadastrados do empreendimento. Não reserva a unidade. Valores, índices de reajuste e prazo são confirmados no contrato.</p>
      </div>`;
    setTimeout(() => window.print(), 150);
  }

  LV.Simulator = { open, close, isOpen: () => !!S && !$('#simModal').hidden };
})(window.LV);
