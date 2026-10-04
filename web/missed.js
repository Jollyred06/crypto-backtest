// web/missed.js - sezione "segnali di acquisto non eseguiti" del log
module.exports = function (S, dISO) {
  const m = S.missed || [];
  const L = ['## Segnali di acquisto NON eseguiti (' + m.length + ' righe; giorni consecutivi della stessa moneta sono accorpati)'];
  if (!m.length) L.push('Nessuno.');
  else {
    L.push('giorno (o periodo) | moneta | motivo | giorni');
    m.forEach(x => L.push(dISO(x.t) + (x.t2 && x.t2 !== x.t ? ' -> ' + dISO(x.t2) : '') + ' | ' + x.s + ' | ' + x.why + ' | ' + (x.n || 1)));
  }
  L.push('');
  return L;
};