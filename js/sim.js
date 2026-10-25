/* LoteVivo — simulação de pagamento */
window.LV = window.LV || {};
(function (LV) {
  'use strict';

  const pmt = (pv, i, n) => (n <= 0 ? pv : !i ? pv / n : (pv * i) / (1 - Math.pow(1 + i, -n)));
  /* prazo necessário para a parcela caber no valor desejado */
  const mesesPara = (pv, i, parcela, modo) => {
    if (parcela <= 0) return Infinity;
    if (modo !== 'price' || !i) return Math.ceil(pv / parcela - 1e-9);
    const x = 1 - (pv * i) / parcela;
    return x <= 0 ? Infinity : Math.ceil(-Math.log(x) / Math.log(1 + i) - 1e-9);
  };
  /* quanto dá para financiar com uma parcela fixa num prazo */
  const pvDe = (parcela, i, n, modo) => (modo !== 'price' || !i ? parcela * n : (parcela * (1 - Math.pow(1 + i, -n))) / i);

  /*
   * o: { preco, plan, descTipo:'%'|'R$', desc, entrada (R$ ou null = mínimo do plano), entradaVezes,
   *      bens:[{desc, valor}], anuaisQtd, anuaisValor, meses, jurosAm, modo:'linear'|'price' }
   */
  function calc(o) {
    const plan = o.plan;
    const preco = o.preco || 0;
    const descPlano = preco * (plan.descontoPct || 0) / 100;
    const descExtra = o.descTipo === 'R$' ? (o.desc || 0) : preco * (o.desc || 0) / 100;
    const valor = Math.max(0, preco - descPlano - descExtra);
    const entradaMin = valor * plan.entradaPct / 100;
    const entrada = o.entrada == null ? entradaMin : Math.min(valor, Math.max(0, o.entrada));
    const entradaVezes = Math.max(1, o.entradaVezes || 1);
    const bens = (o.bens || []).reduce((s, b) => s + (b.valor || 0), 0);
    const meses = Math.max(1, Math.round(o.meses || plan.meses));
    const anuaisQtd = Math.min(Math.max(0, o.anuaisQtd || 0), Math.floor(meses / 12));
    const anuaisValor = anuaisQtd ? Math.max(0, o.anuaisValor || 0) : 0;
    const anuais = anuaisQtd * anuaisValor;
    const jurosAm = o.jurosAm == null ? plan.jurosAm : o.jurosAm;
    const modo = o.modo || plan.modo || 'linear';
    const i = jurosAm / 100;
    const financiado = Math.max(0, valor - entrada - bens - anuais);
    const parcela = financiado > 0 ? pmt(financiado, modo === 'price' ? i : 0, meses) : 0;
    const totalPago = entrada + bens + anuais + parcela * meses;

    /* fluxo por ano, para o gráfico */
    const anos = Math.ceil(Math.max(meses, entradaVezes) / 12);
    const fluxo = Array.from({ length: anos }, () => ({ entrada: 0, parcelas: 0, anuais: 0 }));
    for (let m = 1; m <= entradaVezes; m++) fluxo[Math.floor((m - 1) / 12)].entrada += entrada / entradaVezes;
    for (let m = 1; m <= meses; m++) fluxo[Math.floor((m - 1) / 12)].parcelas += parcela;
    for (let k = 1; k <= anuaisQtd; k++) fluxo[Math.min(anos - 1, Math.floor((12 * k - 1) / 12))].anuais += anuaisValor;

    return {
      preco, valor, desconto: descPlano + descExtra, entrada, entradaMin, entradaPct: valor ? (entrada / valor) * 100 : 0,
      entradaVezes, entradaParcela: entrada / entradaVezes, abaixoMin: entrada + 0.5 < entradaMin,
      bens, anuaisQtd, anuaisValor, anuais, maxAnuais: Math.floor(meses / 12),
      financiado, meses, jurosAm, modo, parcela, totalPago, juros: Math.max(0, totalPago - valor), fluxo
    };
  }

  LV.sim = { pmt, mesesPara, pvDe, calc };
})(window.LV);
