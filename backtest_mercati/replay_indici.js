// replay_indici.js - riesegue paper_indici.js giorno per giorno sullo storico e lo confronta con una simulazione di riferimento
const fs = require('fs'), path = require('path');
const SRC = path.resolve('paper_indici.js'), W = '/tmp/replay_idx';
const START = '2018-01-02', ENTRY = 55, EXIT = 20, ATR_N = 14, ATR_MULT = 3, COST = 0.0005;
const MK = { Nasdaq100: '^NDX', Nikkei225: '^N225', Oro: 'GC=F' };
const RealDate = Date, realFetch = global.fetch, out = console.log.bind(console);
const LASTK = new RealDate(RealDate.now() - 864e5).toISOString().slice(0, 10);
let FAKE = null;

async function hist(tk) {
  const t1 = Math.floor(RealDate.parse('2014-01-01T00:00:00Z') / 1000), t2 = Math.floor(RealDate.now() / 1000);
  const r = await realFetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tk)}?period1=${t1}&period2=${t2}&interval=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const x = (await r.json()).chart.result[0], q = x.indicators.quote[0], m = new Map();
  x.timestamp.forEach((t, i) => {
    const k = new RealDate(t * 1000).toISOString().slice(0, 10);
    if ([q.open[i], q.high[i], q.low[i], q.close[i]].every(v => v != null && v > 0)) m.set(k, { k, ts: t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
  });
  return [...m.values()].sort((a, b) => (a.k < b.k ? -1 : 1));
}
function atr(d, s) { let sum = 0; for (let k = s - ATR_N + 1; k <= s; k++) { const pc = d[k - 1].c; sum += Math.max(d[k].h - d[k].l, Math.abs(d[k].h - pc), Math.abs(d[k].l - pc)); } return sum / ATR_N; }
function ref(d) {
  let s0 = -1; for (let i = 0; i < d.length; i++) if (d[i].k <= START) s0 = i;
  const trades = []; let pos = null, pend = null;
  const close = (b, px, why) => { trades.push({ open: pos.openK, close: b.k, entry: pos.entry, exit: px, why }); pos = null; pend = null; };
  for (let i = s0; i < d.length; i++) {
    const b = d[i];
    if (pend && pend.type === 'BUY' && !pos) { pos = { entry: b.o, stop: b.o - pend.dist, openK: b.k }; pend = null; }
    else if (pos && pend && pend.type === 'SELL') close(b, b.o, 'trend');
    else if (pos && b.l <= pos.stop) close(b, Math.min(b.o, pos.stop), 'stop');
    if (!pos && !pend) { const hi = Math.max(...d.slice(i - ENTRY, i).map(x => x.c)); if (b.c > hi) pend = { type: 'BUY', dist: ATR_MULT * atr(d, i) }; }
    else if (pos && !pend) { const lo = Math.min(...d.slice(i - EXIT, i).map(x => x.c)); if (b.c < lo) pend = { type: 'SELL' }; }
  }
  return { trades, pos, pend };
}

(async () => {
  if (!fs.existsSync(SRC)) { out('Lancia il comando dalla cartella principale del progetto (dove sta paper_indici.js).'); process.exit(1); }
  out('Scarico lo storico...');
  const HIST = {};
  for (const tk of Object.values(MK)) HIST[tk] = (await hist(tk)).filter(b => b.k <= LASTK);
  let src = fs.readFileSync(SRC, 'utf8');
  if (!src.includes('(async () => {')) { out('Formato di paper_indici.js inatteso, non posso fare il replay.'); process.exit(1); }
  src = src.replace('(async () => {', 'module.exports = async () => {').replace(/\}\)\(\)\.catch\([\s\S]*$/, '};\n');
  fs.mkdirSync(W, { recursive: true });
  fs.writeFileSync(W + '/pi_fn.js', src);
  for (const f of ['paper_indici_state.json', 'PAPER_INDICI.md', 'issue_body.md']) fs.rmSync(W + '/' + f, { force: true });
  process.chdir(W);
  global.fetch = async url => {
    const m = String(url).match(/chart\/([^?]+)\?period1=(\d+)&period2=(\d+)/);
    const b = HIST[decodeURIComponent(m[1])].filter(x => x.ts >= +m[2] && x.ts <= +m[3]);
    return { ok: true, json: async () => ({ chart: { result: [{ timestamp: b.map(x => x.ts), indicators: { quote: [{ open: b.map(x => x.o), high: b.map(x => x.h), low: b.map(x => x.l), close: b.map(x => x.c) }] } }] } }) };
  };
  global.Date = class extends RealDate {
    constructor(...a) { if (a.length === 0 && FAKE !== null) super(FAKE); else super(...a); }
    static now() { return FAKE !== null ? FAKE : RealDate.now(); }
  };
  const main = require(W + '/pi_fn.js');
  console.log = () => {};
  let S = null, peak = 3000, mdd = 0, days = 0, eq = 3000;
  try {
    for (let t = RealDate.parse(START + 'T00:00:00Z'); t <= RealDate.parse(LASTK + 'T00:00:00Z'); t += 864e5) {
      const wd = new RealDate(t).getUTCDay(); if (wd === 0 || wd === 6) continue;
      FAKE = t + 22.5 * 3600e3;
      await main(); days++;
      S = JSON.parse(fs.readFileSync('paper_indici_state.json', 'utf8'));
      eq = S.cash + Object.values(S.pos).reduce((a, p) => a + p.qty * p.last, 0);
      peak = Math.max(peak, eq); mdd = Math.max(mdd, 1 - eq / peak);
    }
  } catch (e) { console.log = out; out('Errore durante il replay:', e.message); process.exit(1); }
  console.log = out; FAKE = null;

  const paper = S.trades.map(t => ({ s: t.s, open: t.open, close: t.close, entry: t.entry / (1 + COST), exit: t.exit / (1 - COST), why: t.why === 'stop' ? 'stop' : 'trend' }));
  const refAll = [], refOpen = {}, refPend = {};
  for (const [name, tk] of Object.entries(MK)) { const r = ref(HIST[tk]); r.trades.forEach(x => refAll.push({ s: name, ...x })); if (r.pos) refOpen[name] = r.pos.openK; if (r.pend) refPend[name] = r.pend.type; }
  const near = (a, b) => Math.abs(a / b - 1) < 1e-6;
  const diffs = []; let ok = 0;
  const pm = new Map(paper.map(t => [t.s + '|' + t.open, t]));
  for (const r of refAll) {
    const key = r.s + '|' + r.open, p = pm.get(key); pm.delete(key);
    if (!p) diffs.push('manca nel bot: ' + r.s + ' aperto il ' + r.open);
    else if (p.close !== r.close || p.why !== r.why || !near(p.entry, r.entry) || !near(p.exit, r.exit))
      diffs.push(r.s + ' aperto il ' + r.open + ': bot chiude ' + p.close + ' (' + p.why + ') a ' + p.exit.toFixed(2) + ', riferimento ' + r.close + ' (' + r.why + ') a ' + r.exit.toFixed(2));
    else ok++;
  }
  pm.forEach(p => diffs.push('in più nel bot: ' + p.s + ' aperto il ' + p.open));
  const botOpen = Object.fromEntries(Object.entries(S.pos).map(([n, p]) => [n, p.openK]));
  const botPend = Object.fromEntries(Object.entries(S.pend).map(([n, p]) => [n, p.type]));
  const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  if (!same(botOpen, refOpen)) diffs.push('posizioni aperte diverse: bot ' + JSON.stringify(botOpen) + ' | riferimento ' + JSON.stringify(refOpen));
  if (!same(botPend, refPend)) diffs.push('ordini pendenti diversi: bot ' + JSON.stringify(botPend) + ' | riferimento ' + JSON.stringify(refPend));

  const yrs = (RealDate.parse(LASTK) - RealDate.parse(START)) / (365.25 * 864e5);
  out('\nGiorni simulati:', days, '| periodo', START, '->', LASTK);
  out('Trade chiusi: riferimento', refAll.length, '| bot', paper.length, '| identici', ok);
  for (const n of Object.keys(MK)) out(' ', n + ':', refAll.filter(x => x.s === n).length, 'trade');
  out('Capitale finale del bot:', eq.toFixed(0), '(da 3000) | annuo', (100 * (Math.pow(eq / 3000, 1 / yrs) - 1)).toFixed(1) + '% | drawdown massimo', (100 * mdd).toFixed(1) + '%');
  if (diffs.length) { out('\nDIFFERENZE (' + diffs.length + '):'); diffs.slice(0, 10).forEach(x => out(' -', x)); }
  else out('\nREPLAY OK: il bot ha fatto esattamente gli stessi trade del riferimento, con le stesse date e gli stessi prezzi.');
})();
