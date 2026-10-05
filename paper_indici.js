// paper_indici.js - PROVA VIRTUALE Nasdaq 100, Nikkei 225, Oro (solo long). Nessun ordine reale.
const fs = require('fs');
const STATE = 'paper_indici_state.json', SUMMARY = 'PAPER_INDICI.md', ISSUE = 'issue_body.md';
const MK = { Nasdaq100: '^NDX', Nikkei225: '^N225', Oro: 'GC=F' };
const ENTRY = 55, EXIT = 20, ATR_N = 14, ATR_MULT = 3, RISK = 0.02, COST = 0.0005, MAXLEV = 10, CAP = 3000;
const m = n => n.toFixed(2);

async function load(tk) {
  const t2 = Math.floor(Date.now() / 1000), t1 = t2 - 3 * 365 * 86400;
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tk)}?period1=${t1}&period2=${t2}&interval=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const x = (await r.json()).chart.result[0], q = x.indicators.quote[0], mp = new Map();
      x.timestamp.forEach((t, i) => {
        const k = new Date(t * 1000).toISOString().slice(0, 10);
        if ([q.open[i], q.high[i], q.low[i], q.close[i]].every(v => v != null && v > 0)) mp.set(k, { k, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      });
      const d = [...mp.values()].sort((a, b) => (a.k < b.k ? -1 : 1));
      if (d.length > 100) return d;
    } catch (e) {}
  }
  throw new Error('dati non disponibili per ' + tk);
}
function atr(d, s) { let sum = 0; for (let k = s - ATR_N + 1; k <= s; k++) { const pc = d[k - 1].c; sum += Math.max(d[k].h - d[k].l, Math.abs(d[k].h - pc), Math.abs(d[k].l - pc)); } return sum / ATR_N; }
const equity = S => S.cash + Object.values(S.pos).reduce((a, p) => a + p.qty * p.last, 0);

(async () => {
  const now = new Date(), today = now.toISOString().slice(0, 10), yest = new Date(now - 864e5).toISOString().slice(0, 10);
  const cutoff = now.getUTCHours() >= 22 ? today : yest; // prima delle 22 UTC la candela di oggi non e' chiusa
  let S = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null;
  const first = !S;
  if (first) S = { cash: CAP, peak: CAP, pos: {}, pend: {}, last: {}, trades: [], log: [] };
  const ev = [];

  for (const [n, tk] of Object.entries(MK)) {
    const d = (await load(tk)).filter(b => b.k <= cutoff);
    const from = first || !S.last[n] ? d.length - 1 : d.findIndex(b => b.k > S.last[n]);
    if (from < 0) continue;
    for (let i = Math.max(from, ENTRY + 1); i < d.length; i++) {
      const b = d[i], p = S.pend[n], pos = S.pos[n];
      const close = (price, why) => {
        const pr = price * (1 - COST), pnl = pos.qty * (pr - pos.entry);
        S.cash += pos.qty * pr;
        S.trades.push({ s: n, entry: pos.entry, exit: pr, pnl, pct: (pr / pos.entry - 1) * 100, open: pos.openK, close: b.k, why });
        ev.push(`SOLD ${n} a ${m(pr)} (${why}), ${pnl >= 0 ? '+' : ''}${m(pnl)}`);
        delete S.pos[n]; delete S.pend[n];
      };
      // 1) esecuzione ordini e stop sulla candela i
      if (p && p.type === 'BUY' && !pos) {
        const size = Math.min(RISK / (p.dist / b.o), MAXLEV), qty = equity(S) * size / (b.o * (1 + COST));
        S.cash -= qty * b.o * (1 + COST);
        S.pos[n] = { qty, entry: b.o * (1 + COST), stop: b.o - p.dist, last: b.o, openK: b.k };
        delete S.pend[n];
        ev.push(`BOUGHT ${n}: qta ${qty.toFixed(4)} a ${m(b.o)}, stop ${m(S.pos[n].stop)}, rischio circa ${m(qty * p.dist)}`);
      } else if (pos && p && p.type === 'SELL') close(b.o, 'uscita da trend');
      else if (pos && b.l <= pos.stop) close(Math.min(b.o, pos.stop), 'stop');
      if (S.pos[n]) S.pos[n].last = b.c;
      // 2) segnali sulla chiusura della candela i (ordine per domani)
      if (!S.pos[n] && !S.pend[n]) {
        const hi = Math.max(...d.slice(i - ENTRY, i).map(x => x.c));
        if (b.c > hi) { const dist = ATR_MULT * atr(d, i); S.pend[n] = { type: 'BUY', dist, sig: b.k }; ev.push(`SEGNALE ${n}: COMPRA all'apertura di domani (chiusura ${m(b.c)}, stop a ${m(dist)} sotto)`); }
      } else if (S.pos[n] && !S.pend[n]) {
        const lo = Math.min(...d.slice(i - EXIT, i).map(x => x.c));
        if (b.c < lo) { S.pend[n] = { type: 'SELL', sig: b.k }; ev.push(`SEGNALE ${n}: VENDI all'apertura di domani (uscita da trend)`); }
      }
    }
    S.last[n] = d[d.length - 1].k;
  }

  const eq = equity(S); S.peak = Math.max(S.peak, eq);
  if (S.log.length && S.log[S.log.length - 1].k === cutoff) S.log.pop();
  S.log.push({ k: cutoff, eq: +eq.toFixed(2) }); S.log = S.log.slice(-60);
  const expo = Object.values(S.pos).reduce((a, p) => a + p.qty * p.last, 0) / eq;
  const L = ['# Prova virtuale indici - riepilogo', '', "Nessun ordine reale: simulazione con prezzi veri. Non e' un consiglio di investimento.", '',
    `Ultima candela chiusa: **${cutoff}** | Rischio per trade ${RISK * 100}% | Partenza con ${CAP}`, '',
    `Capitale virtuale: **${m(eq)}** | Massimo: ${m(S.peak)} | Drawdown attuale: ${m((1 - eq / S.peak) * 100)}% | Esposizione: ${m(expo)}x`, '', '## Posizioni aperte'];
  const op = Object.entries(S.pos);
  if (!op.length) L.push('Nessuna.'); else op.forEach(([n, p]) => L.push(`- ${n}: qta ${p.qty.toFixed(4)}, entrata ${m(p.entry)}, stop ${m(p.stop)}, ultimo ${m(p.last)}, P&L ${m(p.qty * (p.last - p.entry))}`));
  L.push('', '## Ordini per domani');
  const pe = Object.entries(S.pend);
  if (!pe.length) L.push('Nessuno.'); else pe.forEach(([n, p]) => L.push(`- ${p.type === 'BUY' ? 'COMPRA' : 'VENDI'} ${n} all'apertura`));
  L.push('', '## Ultimi 20 trade chiusi');
  if (!S.trades.length) L.push('Nessuno.'); else S.trades.slice(-20).reverse().forEach(t => L.push(`- ${t.close} ${t.s}: ${m(t.entry)} -> ${m(t.exit)} (${t.pct >= 0 ? '+' : ''}${m(t.pct)}%, ${m(t.pnl)}) ${t.why}`));

  fs.writeFileSync(STATE, JSON.stringify(S, null, 1));
  fs.writeFileSync(SUMMARY, L.join('\n') + '\n');
  if (ev.length) fs.writeFileSync(ISSUE, `Prova virtuale indici, candela chiusa del ${cutoff}. Nessun ordine reale.\n\n` + ev.map(e => '- ' + e).join('\n') + `\n\nCapitale virtuale: ${m(eq)}. Dettagli in PAPER_INDICI.md.\n\n@Jollyred06\n`);
  else if (fs.existsSync(ISSUE)) fs.unlinkSync(ISSUE);
  console.log(L.join('\n')); console.log('\nEventi:' + (ev.length ? '\n' + ev.join('\n') : ' nessuno'));
})().catch(e => { console.error('Errore:', e.message); process.exit(1); });
