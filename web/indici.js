// web/indici.js - sezione "Indici" (sola lettura): legge paper_indici_state.json dal repository
const f = n => Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
module.exports = async function (getRepoText) {
  const L = ['## Indici (prova virtuale)'];
  try {
    const S = JSON.parse(await getRepoText('paper_indici_state.json'));
    const eq = S.cash + Object.values(S.pos).reduce((a, p) => a + p.qty * p.last, 0);
    const day = S.log && S.log.length ? S.log[S.log.length - 1].k : '-';
    L.push('Capitale virtuale: ' + f(eq) + ' (massimo ' + f(S.peak) + '), ultima candela chiusa: ' + day);
    L.push('', '### Posizioni aperte');
    const op = Object.entries(S.pos);
    if (!op.length) L.push('Nessuna.');
    else op.forEach(([n, p]) => L.push('- ' + n + ': entrata ' + f(p.entry) + ', stop ' + f(p.stop) + ', ultimo ' + f(p.last) + ', P&L ' + f(p.qty * (p.last - p.entry))));
    L.push('', '### Ordini per domani');
    const pe = Object.entries(S.pend);
    if (!pe.length) L.push('Nessuno.');
    else pe.forEach(([n, p]) => L.push('- ' + (p.type === 'BUY' ? 'COMPRA' : 'VENDI') + ' ' + n + ' all\'apertura'));
    L.push('', '### Ultimi trade chiusi');
    if (!S.trades.length) L.push('Nessuno.');
    else S.trades.slice(-5).reverse().forEach(t => L.push('- ' + t.close + ' ' + t.s + ': ' + f(t.entry) + ' -> ' + f(t.exit) + ' (' + f(t.pct) + '%, ' + f(t.pnl) + ') ' + t.why));
  } catch (e) {
    L.push('Dati indici non disponibili: ' + e.message);
  }
  return L;
};
