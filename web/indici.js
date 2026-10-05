// web/indici.js - blocco "Indici" per la dashboard (sola lettura): legge paper_indici_state.json dal repository
const f = n => Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const col = n => (n >= 0 ? '#34d399' : '#f87171');
const sgn = n => (n >= 0 ? '+' : '') + f(n);
const H = t => '<div style="margin:18px 0 6px;color:#9aa4b2;font-size:13px;letter-spacing:.06em;text-transform:uppercase">' + t + '</div>';
const R = t => '<div style="padding:7px 0;border-top:1px solid #1f2937">' + t + '</div>';
module.exports = async function (getRepoText) {
  let body;
  try {
    const S = JSON.parse(await getRepoText('paper_indici_state.json'));
    const eq = S.cash + Object.values(S.pos).reduce((a, p) => a + p.qty * p.last, 0);
    const day = S.log && S.log.length ? S.log[S.log.length - 1].k : '-';
    body = '<div style="font-size:20px;font-weight:600">Capitale ' + f(eq) + '</div>' +
      '<div style="color:#9aa4b2">massimo ' + f(S.peak) + ' &middot; ultima candela chiusa ' + esc(day) + '</div>';
    body += H('Posizioni aperte');
    const op = Object.entries(S.pos);
    body += op.length ? op.map(([n, p]) => R('<b>' + esc(n) + '</b> entrata ' + f(p.entry) + ', stop ' + f(p.stop) + ', ultimo ' + f(p.last) +
      ' <span style="color:' + col(p.qty * (p.last - p.entry)) + '">P&amp;L ' + sgn(p.qty * (p.last - p.entry)) + '</span>')).join('') : R('Nessuna.');
    body += H('Ordini per domani');
    const pe = Object.entries(S.pend);
    body += pe.length ? pe.map(([n, p]) => R((p.type === 'BUY' ? 'COMPRA' : 'VENDI') + ' <b>' + esc(n) + '</b> all\'apertura' +
      (p.type === 'BUY' ? ' (stop ' + f(p.dist) + ' sotto)' : ''))).join('') : R('Nessuno.');
    body += H('Ultimi trade chiusi');
    body += S.trades.length ? S.trades.slice(-5).reverse().map(t => R(esc(t.close) + ' <b>' + esc(t.s) + '</b> ' + f(t.entry) + ' &rarr; ' + f(t.exit) +
      ' <span style="color:' + col(t.pnl) + '">' + sgn(t.pnl) + ' (' + sgn(t.pct) + '%)</span> ' + esc(t.why))).join('') : R('Nessuno.');
  } catch (e) {
    body = '<div style="color:#9aa4b2">Dati indici non disponibili: ' + esc(e.message) + '</div>';
  }
  return '<div style="margin-top:28px"><div style="font-weight:700;letter-spacing:.08em;color:#9aa4b2;font-size:15px;text-transform:uppercase;margin-bottom:12px">Indici (prova virtuale)</div>' +
    '<div style="background:#111827;border:1px solid #1f2937;border-radius:20px;padding:20px 24px;color:#e5e7eb;line-height:1.5">' + body + '</div></div>';
};
