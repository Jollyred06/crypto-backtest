// paper_trader.js - PROVA VIRTUALE giornaliera (nessun ordine reale, nessun soldo vero)
// Strategia: trend-following (breakout 55g + media 200 + uscita sotto minimo 20g), stesse regole del backtest.
// Dati REALI Binance (BTC, ETH, SOL). Salva lo stato in paper_state.json e il riepilogo in PAPER_RIEPILOGO.md.
const fs = require('fs');

const SYMBOLS = { BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT', BNB: 'BNBUSDT', XRP: 'XRPUSDT', ADA: 'ADAUSDT', DOGE: 'DOGEUSDT', LTC: 'LTCUSDT', LINK: 'LINKUSDT' };
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const STATE_FILE = 'paper_state.json';
const SUMMARY_FILE = 'PAPER_RIEPILOGO.md';
const CAPITAL = 3000;
const FEE = 0.0026;        // commissione per operazione (0,26%)
const SLIP = 0.0005;       // slippage 0,05%
const BASE_RISK = 0.01;    // rischio 1% per trade
const MAX_RISK = 0.02;     // tetto rischio per trade (Kelly)
const MAX_TOT_RISK = 0.02; // rischio totale aperto
const MAX_POS = 2;         // posizioni aperte contemporanee
const HALT_DD = 0.15;      // stop globale a -15% dal massimo
const HALT_PAUSE = 30;     // giorni di pausa dopo lo stop
const ATR_N = 14, ATR_MULT = 3;
const ENTRY_N = 55, EXIT_N = 20, SMA_N = 200;
const KELLY_MIN = 30;
const DAY = 86400;         // secondi
const FETCH_DAYS = 520;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const sum = a => a.reduce((x, y) => x + y, 0);
const dstr = t => new Date(t * 1000).toISOString().slice(0, 10);
const money = n => Number(n).toFixed(2);
const px = n => (Math.abs(n) >= 1 ? Number(n).toFixed(2) : Number(n).toFixed(4));
const qtyf = n => String(Number(Number(n).toPrecision(4)));

async function getCandles(symbol) {
  let lastErr = null;
  const startMs = Math.floor((Date.now() - FETCH_DAYS * 86400000) / 86400000) * 86400000;
  for (const host of HOSTS) {
    try {
      const out = [];
      let cursor = startMs;
      while (cursor < Date.now()) {
        const r = await fetch(`${host}/api/v3/klines?symbol=${symbol}&interval=1d&startTime=${cursor}&limit=1000`);
        const j = await r.json();
        if (!Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 120));
        if (j.length === 0) break;
        out.push(...j);
        cursor = j[j.length - 1][0] + 86400000;
        if (j.length < 1000) break;
        await sleep(300);
      }
      return out
        .filter(x => x[6] < Date.now()) // solo candele chiuse
        .map(x => ({ t: Math.floor(x[0] / 1000), o: +x[1], h: +x[2], l: +x[3], c: +x[4] }));
    } catch (e) { lastErr = e; }
  }
  throw new Error(symbol + ': ' + (lastErr ? lastErr.message : 'errore'));
}

function calcATR(c, n) {
  const out = Array(c.length).fill(null);
  const tr = i => Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
  let a = 0;
  for (let i = 1; i <= n; i++) a += tr(i);
  a /= n; out[n] = a;
  for (let i = n + 1; i < c.length; i++) { a = (a * (n - 1) + tr(i)) / n; out[i] = a; }
  return out;
}

function stats(tr) {
  const w = tr.filter(x => x.pnl > 0), l = tr.filter(x => x.pnl <= 0);
  const gw = sum(w.map(x => x.pnl)), gl = -sum(l.map(x => x.pnl));
  return {
    n: tr.length,
    winRate: tr.length ? w.length / tr.length : 0,
    pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0),
    avgW: w.length ? gw / w.length : 0,
    avgL: l.length ? gl / l.length : 0
  };
}

function newState(lastT, btcClose) {
  return {
    version: 1, startCapital: CAPITAL, cash: CAPITAL,
    peak: CAPITAL, gPeak: CAPITAL, maxDD: 0,
    halted: false, haltUntilT: 0, halts: 0,
    startT: lastT, startBtc: btcClose, lastT: lastT - DAY,
    pos: {}, pend: {}, trades: [], days: []
  };
}

const equity = S => S.cash + sum(Object.values(S.pos).map(p => p.qty * p.last));

function sizeQty(S, eq, dd, entry, stopDist) {
  let r = BASE_RISK;
  if (S.trades.length >= KELLY_MIN) {
    const st = stats(S.trades);
    const R = st.avgL > 0 ? st.avgW / st.avgL : 0;
    const f = R > 0 ? st.winRate - (1 - st.winRate) / R : 0;
    r = Math.min(MAX_RISK, Math.max(0, f / 4));
  }
  r *= Math.max(0, 1 - dd / HALT_DD);
  if (r <= 0) return { qty: 0, r };
  let qty = eq * r / stopDist;
  qty = Math.min(qty, eq * 0.5 / entry, S.cash / (entry * (1 + FEE)));
  const openRisk = sum(Object.values(S.pos).map(p => p.qty * (p.entry - p.stop)));
  if (openRisk + qty * stopDist > MAX_TOT_RISK * eq + 1e-9)
    qty = Math.max(0, (MAX_TOT_RISK * eq - openRisk) / stopDist);
  return { qty, r };
}

function closePos(S, s, price, t, ev, why) {
  const p = S.pos[s];
  const exitPx = price * (1 - SLIP);
  const proceeds = p.qty * exitPx * (1 - FEE);
  S.cash += proceeds;
  const pnl = proceeds - p.cost;
  S.trades.push({ s, pnl, pct: pnl / p.cost, t, entry: p.entry, exit: exitPx, openT: p.openT });
  ev.push({ type: 'SOLD', s, px: exitPx, pnl, why });
  delete S.pos[s]; delete S.pend[s];
}

function describe(e) {
  if (e.type === 'BOUGHT') return `comprato ${e.s} a ${px(e.px)} (qta ${qtyf(e.qty)}, stop ${px(e.stop)})`;
  if (e.type === 'SOLD') return `venduto ${e.s} a ${px(e.px)} (${e.why}, ${e.pnl >= 0 ? '+' : ''}${money(e.pnl)})`;
  if (e.type === 'HALT') return 'STOP GLOBALE -15%: pausa di 30 giorni';
  return '';
}

function stepDay(S, t, data, idx, ind) {
  const ev = [];
  // 1) uscite
  for (const s of Object.keys(S.pos)) {
    const i = idx[s].get(t); if (i === undefined) continue;
    const k = data[s][i], p = S.pos[s];
    let price = null, why = '';
    if (S.pend[s] && S.pend[s].type === 'SELL') { price = k.o; why = 'uscita da trend'; }
    else if (k.o <= p.stop) { price = k.o; why = 'stop'; }
    else if (k.l <= p.stop) { price = p.stop; why = 'stop'; }
    if (price !== null) closePos(S, s, price, t, ev, why);
  }

  // 2) entrate (segnali della candela precedente, ingresso all'apertura)
  let eq = equity(S);
  if (S.halted && t >= S.haltUntilT) { S.halted = false; S.peak = eq; }
  const dd = (S.peak - eq) / S.peak;
  if (!S.halted && dd >= HALT_DD) { S.halted = true; S.haltUntilT = t + HALT_PAUSE * DAY; S.halts++; ev.push({ type: 'HALT' }); }
  const cands = Object.keys(S.pend)
    .filter(s => S.pend[s].type === 'BUY' && !S.pos[s] && idx[s].has(t))
    .sort((a, b) => S.pend[a].rank - S.pend[b].rank);
  for (const s of cands) {
    if (S.halted || Object.keys(S.pos).length >= MAX_POS) break;
    const k = data[s][idx[s].get(t)];
    const entry = k.o * (1 + SLIP);
    const stopDist = ATR_MULT * S.pend[s].atr;
    const stop = entry - stopDist;
    if (stop <= 0) continue;
    const { qty } = sizeQty(S, eq, dd, entry, stopDist);
    if (qty * entry < 10) continue;
    const cost = qty * entry * (1 + FEE);
    S.cash -= cost;
    S.pos[s] = { qty, entry, stop, cost, last: k.o, openT: t };
    ev.push({ type: 'BOUGHT', s, px: entry, qty, stop });
  }
  for (const s of Object.keys(S.pend)) if (S.pend[s].type === 'BUY') delete S.pend[s];

  // 3) segnali a chiusura candela
  for (const s of Object.keys(data)) {
    const i = idx[s].get(t); if (i === undefined) continue;
    const k = data[s][i], av = ind[s].atr[i];
    if (S.pos[s]) S.pos[s].last = k.c;
    if (av === null) continue;
    if (S.pos[s]) {
      const lowExit = Math.min(...data[s].slice(Math.max(0, i - EXIT_N), i).map(x => x.c));
      if (k.c < lowExit) S.pend[s] = { type: 'SELL' };
    } else if (i >= SMA_N) {
      const sma = sum(data[s].slice(i - SMA_N + 1, i + 1).map(x => x.c)) / SMA_N;
      const hi = Math.max(...data[s].slice(i - ENTRY_N, i).map(x => x.c));
      if (k.c > sma && k.c > hi) S.pend[s] = { type: 'BUY', atr: av, rank: -(k.c / sma) };
    }
  }

  eq = equity(S);
  if (eq > S.peak) S.peak = eq;
  if (eq > S.gPeak) S.gPeak = eq;
  S.maxDD = Math.max(S.maxDD, (S.gPeak - eq) / S.gPeak);
  S.lastT = t;
  S.days.push({ t, eq: Number(eq.toFixed(2)), ev: ev.map(describe) });
  if (S.days.length > 400) S.days = S.days.slice(-400);
  return ev;
}

// Segnali per la prossima apertura (stima di prezzo e quantita')
function pendingSignals(S, data, ind, idx, lastT) {
  const eq = equity(S);
  const dd = (S.peak - eq) / S.peak;
  const sells = Object.keys(S.pend).filter(s => S.pend[s].type === 'SELL' && S.pos[s]);
  const buys = Object.keys(S.pend).filter(s => S.pend[s].type === 'BUY' && !S.pos[s])
    .sort((a, b) => S.pend[a].rank - S.pend[b].rank);
  const slots = MAX_POS - (Object.keys(S.pos).length - sells.length);
  const out = { sells: [], buys: [], skipped: [], halted: S.halted };
  for (const s of sells) out.sells.push({ s, price: data[s][idx[s].get(lastT)].c });
  buys.forEach((s, n) => {
    const close = data[s][idx[s].get(lastT)].c;
    const stopDist = ATR_MULT * S.pend[s].atr;
    const { qty, r } = sizeQty(S, eq, dd, close, stopDist);
    if (S.halted || n >= slots || qty * close < 10) { out.skipped.push(s); return; }
    out.buys.push({ s, price: close, stop: close - stopDist, qty, risk: qty * stopDist, notional: qty * close, r });
  });
  return out;
}

function writeSummary(S, data, idx, lastT, sig) {
  const eq = equity(S);
  const ret = (eq / S.startCapital - 1) * 100;
  const st = stats(S.trades);
  const btcNow = data.BTC[data.BTC.length - 1].c;
  const bh = (btcNow / S.startBtc - 1) * 100;
  const L = [];
  L.push('# Prova virtuale - riepilogo');
  L.push('');
  L.push('Nessun ordine reale: simulazione con prezzi veri. Non e\' un consiglio di investimento.');
  L.push('');
  L.push(`Ultima candela chiusa: **${dstr(lastT)}** | Partenza: ${dstr(S.startT)} con ${S.startCapital}`);
  L.push('');
  L.push('| Voce | Valore |');
  L.push('|---|---|');
  L.push(`| Capitale | **${money(eq)}** (${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%) |`);
  L.push(`| BTC tenuto fermo dalla partenza | ${bh >= 0 ? '+' : ''}${bh.toFixed(1)}% |`);
  L.push(`| Drawdown massimo | ${(S.maxDD * 100).toFixed(1)}% |`);
  L.push(`| Trade chiusi | ${st.n} |`);
  L.push(`| Win rate | ${st.n ? (st.winRate * 100).toFixed(0) + '%' : '-'} |`);
  L.push(`| Profit factor | ${st.n ? (st.pf === Infinity ? 'inf' : st.pf.toFixed(2)) : '-'} |`);
  L.push(`| Stop globale -15% | ${S.halted ? 'ATTIVO (pausa fino al ' + dstr(S.haltUntilT) + ')' : 'non attivo'} (scattato ${S.halts} volte) |`);
  L.push('');
  L.push('## Posizioni aperte');
  const open = Object.keys(S.pos);
  if (!open.length) L.push('Nessuna.');
  for (const s of open) {
    const p = S.pos[s];
    L.push(`- **${s}**: qta ${qtyf(p.qty)}, entrata ${px(p.entry)}, stop ${px(p.stop)}, ultimo prezzo ${px(p.last)} (${((p.last / p.entry - 1) * 100).toFixed(1)}%)`);
  }
  L.push('');
  L.push('## Segnali per oggi');
  if (!sig.buys.length && !sig.sells.length) L.push('Nessun segnale.');
  for (const b of sig.buys) L.push(`- **COMPRA ${b.s}** circa ${px(b.price)}, stop ${px(b.stop)}, quantita' ${qtyf(b.qty)}`);
  for (const x of sig.sells) L.push(`- **VENDI ${x.s}** circa ${px(x.price)}`);
  L.push('');
  L.push('## Ultimi 15 giorni');
  L.push('| Giorno | Capitale | Eventi |');
  L.push('|---|---|---|');
  for (const d of S.days.slice(-15).reverse()) L.push(`| ${dstr(d.t)} | ${money(d.eq)} | ${d.ev.join('; ') || '-'} |`);
  L.push('');
  L.push('## Ultimi 20 trade chiusi');
  if (!S.trades.length) L.push('Nessuno.');
  else {
    L.push('| Chiuso | Moneta | Entrata | Uscita | P&L |');
    L.push('|---|---|---|---|---|');
    for (const x of S.trades.slice(-20).reverse()) L.push(`| ${dstr(x.t)} | ${x.s} | ${px(x.entry)} | ${px(x.exit)} | ${x.pnl >= 0 ? '+' : ''}${money(x.pnl)} |`);
  }
  fs.writeFileSync(SUMMARY_FILE, L.join('\n') + '\n');
}

async function openIssue(title, body) {
  const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) { console.log('(esecuzione locale, nessuna segnalazione GitHub)\n' + title + '\n' + body); return; }
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'paper-trader' },
      body: JSON.stringify({ title, body })
    });
    console.log('Segnalazione GitHub: HTTP ' + r.status);
  } catch (e) { console.log('Segnalazione non inviata: ' + e.message); }
}

async function main() {
  const data = {}, ind = {}, idx = {};
  for (const [s, sym] of Object.entries(SYMBOLS)) {
    const c = await getCandles(sym);
    if (c.length < 300) throw new Error(s + ': dati insufficienti (' + c.length + ' giorni)');
    data[s] = c;
    ind[s] = { atr: calcATR(c, ATR_N) };
    idx[s] = new Map(c.map((x, i) => [x.t, i]));
    await sleep(300);
  }
  const lastT = data.BTC[data.BTC.length - 1].t;

  let S = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : null;
  const first = !S;
  if (first) {
    S = newState(lastT, data.BTC[data.BTC.length - 1].c);
    console.log('Prima esecuzione: partenza virtuale con ' + CAPITAL + ' dal ' + dstr(lastT));
  }

  const todo = data.BTC.map(x => x.t).filter(t => t > S.lastT);
  const events = [];
  for (const t of todo) for (const e of stepDay(S, t, data, idx, ind)) events.push(e);
  console.log('Candele elaborate: ' + todo.length + ' | ultima: ' + dstr(S.lastT) + ' | capitale: ' + money(equity(S)));

  const sig = pendingSignals(S, data, ind, idx, S.lastT);
  fs.writeFileSync(STATE_FILE, JSON.stringify(S, null, 1));
  writeSummary(S, data, idx, S.lastT, sig);

  const owner = process.env.GITHUB_REPOSITORY_OWNER ? '@' + process.env.GITHUB_REPOSITORY_OWNER : '';
  const parts = [];
  for (const b of sig.buys) parts.push(`compra ${b.s}`);
  for (const x of sig.sells) parts.push(`vendi ${x.s}`);
  const exec = events.filter(e => e.type !== 'HALT').map(e => (e.type === 'BOUGHT' ? 'comprato ' : 'venduto ') + e.s);
  if (parts.length || events.length) {
    const lines = [];
    lines.push(`**Prova virtuale, candela chiusa del ${dstr(S.lastT)}.** Nessun ordine reale.`);
    lines.push('');
    if (sig.halted) lines.push('Stop globale -15% attivo: nessun nuovo acquisto.\n');
    for (const b of sig.buys) {
      lines.push(`### COMPRA ${b.s}`);
      lines.push(`- Ingresso all'apertura di oggi, prezzo indicativo: **${px(b.price)}**`);
      lines.push(`- Stop: **${px(b.stop)}**`);
      lines.push(`- Quantita': **${qtyf(b.qty)}** (circa ${money(b.notional)} di controvalore, rischio ${money(b.risk)})`);
      lines.push('');
    }
    for (const x of sig.sells) {
      lines.push(`### VENDI ${x.s}`);
      lines.push(`- Uscita all'apertura di oggi, prezzo indicativo: **${px(x.price)}**`);
      lines.push('');
    }
    if (sig.skipped.length) lines.push(`Segnali di acquisto non eseguiti (limite posizioni o stop globale): ${sig.skipped.join(', ')}\n`);
    if (events.length) {
      lines.push('### Operazioni virtuali eseguite');
      for (const e of events) lines.push('- ' + describe(e));
      lines.push('');
    }
    lines.push(`Capitale virtuale: **${money(equity(S))}**. Dettagli in PAPER_RIEPILOGO.md.`);
    if (owner) lines.push('\n' + owner);
    const title = `Prova virtuale ${dstr(S.lastT)}: ` + [...parts, ...exec.map(x => '(' + x + ')')].join(', ');
    await openIssue(title.slice(0, 200), lines.join('\n'));
  } else {
    console.log('Nessun segnale e nessuna operazione oggi.');
  }
}

module.exports = { main };
if (require.main === module) main().catch(e => { console.error('Errore:', e.message); process.exit(1); });