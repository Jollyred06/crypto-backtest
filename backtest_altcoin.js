// backtest_altcoin.js - STESSA strategia v3 (trend-following) provata su 6 monete NUOVE: BNB, XRP, ADA, DOGE, LTC, LINK
// Dati REALI Binance, giornaliero. Nessun parametro ritoccato. Un solo tentativo.
const SYMBOLS = { BNB: 'BNBUSDT', XRP: 'XRPUSDT', ADA: 'ADAUSDT', DOGE: 'DOGEUSDT', LTC: 'LTCUSDT', LINK: 'LINKUSDT' };
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const START = Date.UTC(2017, 7, 17);
const CAPITAL = 3000;
const FEE = 0.0026;        // commissione per operazione (0,26%)
const SLIP = 0.0005;       // slippage 0,05%
const BASE_RISK = 0.01;    // rischio 1% per trade
const MAX_RISK = 0.02;     // tetto rischio per trade (Kelly)
const MAX_TOT_RISK = 0.02; // rischio totale aperto
const MAX_POS = 2;         // posizioni aperte contemporanee
const HALT_DD = 0.15;      // stop globale a -15% dal massimo
const HALT_PAUSE = 30;     // giorni di pausa dopo lo stop, poi si riparte (revisione manuale)
const ATR_N = 14, ATR_MULT = 3;                 // stop iniziale a 3 ATR
const ENTRY_N = 55, EXIT_N = 20, SMA_N = 200;   // breakout 55g, uscita sotto minimo 20g, filtro media 200
const KELLY_MIN = 30;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const sum = a => a.reduce((x, y) => x + y, 0);

async function getCandles(symbol) {
  let lastErr = null;
  for (const host of HOSTS) {
    try {
      const out = [];
      let cursor = START;
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

function maxDrawdownOf(closes) {
  let pk = closes[0], m = 0;
  for (const c of closes) { if (c > pk) pk = c; m = Math.max(m, (pk - c) / pk); }
  return m;
}

function simulate(data) {
  const ind = {}, idx = {}, times = new Set();
  for (const s in data) {
    ind[s] = { atr: calcATR(data[s], ATR_N) };
    idx[s] = new Map(data[s].map((x, i) => [x.t, i]));
    data[s].forEach(x => times.add(x.t));
  }
  const T = [...times].sort((a, b) => a - b);
  let cash = CAPITAL, peak = CAPITAL, gPeak = CAPITAL, maxDD = 0;
  let halted = false, haltUntil = 0, halts = 0;
  const pos = {}, pend = {}, trades = [];

  const equity = () => cash + sum(Object.values(pos).map(p => p.qty * p.last));
  const closePos = (s, px, t) => {
    const p = pos[s];
    const exitPx = px * (1 - SLIP);
    const proceeds = p.qty * exitPx * (1 - FEE);
    cash += proceeds;
    trades.push({ s, pnl: proceeds - p.cost, pct: (proceeds - p.cost) / p.cost, t });
    delete pos[s]; delete pend[s];
  };

  for (let ti = 0; ti < T.length; ti++) {
    const t = T[ti];
    // 1) uscite
    for (const s of Object.keys(pos)) {
      const i = idx[s].get(t); if (i === undefined) continue;
      const k = data[s][i], p = pos[s];
      let px = null;
      if (pend[s] && pend[s].type === 'SELL') px = k.o;
      else if (k.o <= p.stop) px = k.o;
      else if (k.l <= p.stop) px = p.stop;
      else if (k.h >= p.tp) px = p.tp;
      if (px !== null) closePos(s, px, t);
    }

    // 2) entrate (segnali della candela precedente, ingresso all'apertura)
    let eq = equity();
    if (halted && ti >= haltUntil) { halted = false; peak = eq; }
    let dd = (peak - eq) / peak;
    if (!halted && dd >= HALT_DD) { halted = true; haltUntil = ti + HALT_PAUSE; halts++; }
    const cands = Object.keys(pend)
      .filter(s => pend[s].type === 'BUY' && !pos[s] && idx[s].has(t))
      .sort((a, b) => pend[a].rank - pend[b].rank);
    for (const s of cands) {
      if (halted || Object.keys(pos).length >= MAX_POS) break;
      let r = BASE_RISK;
      if (trades.length >= KELLY_MIN) {
        const st = stats(trades);
        const R = st.avgL > 0 ? st.avgW / st.avgL : 0;
        const f = R > 0 ? st.winRate - (1 - st.winRate) / R : 0;
        r = Math.min(MAX_RISK, Math.max(0, f / 4));
      }
      r *= Math.max(0, 1 - dd / HALT_DD);
      if (r <= 0) continue;
      const k = data[s][idx[s].get(t)];
      const entry = k.o * (1 + SLIP);
      const stopDist = ATR_MULT * pend[s].atr;
      const stop = entry - stopDist;
      if (stop <= 0) continue;
      let qty = eq * r / stopDist;
      qty = Math.min(qty, eq * 0.5 / entry, cash / (entry * (1 + FEE)));
      const openRisk = sum(Object.values(pos).map(p => p.qty * (p.entry - p.stop)));
      if (openRisk + qty * stopDist > MAX_TOT_RISK * eq + 1e-9)
        qty = Math.max(0, (MAX_TOT_RISK * eq - openRisk) / stopDist);
      if (qty * entry < 10) continue;
      const cost = qty * entry * (1 + FEE);
      cash -= cost;
      pos[s] = { qty, entry, stop, tp: Infinity, cost, last: k.o };
    }
    for (const s of Object.keys(pend)) if (pend[s].type === 'BUY') delete pend[s];

    // 3) segnali a chiusura candela
    for (const s of Object.keys(data)) {
      const i = idx[s].get(t); if (i === undefined) continue;
      const k = data[s][i], av = ind[s].atr[i];
      if (pos[s]) pos[s].last = k.c;
      if (av === null) continue;
      if (pos[s]) {
        const lowExit = Math.min(...data[s].slice(Math.max(0, i - EXIT_N), i).map(x => x.c));
        if (k.c < lowExit) pend[s] = { type: 'SELL' };
      } else if (i >= SMA_N) {
        const sma = sum(data[s].slice(i - SMA_N + 1, i + 1).map(x => x.c)) / SMA_N;
        const hi = Math.max(...data[s].slice(i - ENTRY_N, i).map(x => x.c));
        if (k.c > sma && k.c > hi) pend[s] = { type: 'BUY', atr: av, rank: -(k.c / sma) };
      }
    }

    eq = equity();
    if (eq > peak) peak = eq;
    if (eq > gPeak) gPeak = eq;
    maxDD = Math.max(maxDD, (gPeak - eq) / gPeak);
  }

  // chiusura forzata delle posizioni ancora aperte
  for (const s of Object.keys(pos)) closePos(s, pos[s].last, T[T.length - 1]);
  return { trades, final: cash, maxDD, halts, from: T[0], to: T[T.length - 1] };
}

(async () => {
  console.log('CRITERI FISSATI PRIMA DEL TEST (stessa strategia v3, nessun ritocco):');
  console.log('  1) almeno 4 monete su 6 con P&L positivo (ognuna da sola, con 3000)');
  console.log('  2) portafoglio delle 6: almeno 30 trade, profit factor >= 1.3,');
  console.log('     drawdown massimo <= 20%, rendimento > 0');
  console.log('Non si confronta con BTC: qui si misura se il vantaggio si ripete su altre monete.\n');
  console.log('Scarico lo storico...');
  const data = {};
  for (const [s, sym] of Object.entries(SYMBOLS)) {
    const c = await getCandles(sym);
    if (c.length < 400) { console.log('  ' + s + ': dati insufficienti (' + c.length + ' giorni), esclusa'); continue; }
    data[s] = c;
    await sleep(500);
  }
  const names = Object.keys(data);
  if (names.length < 4) throw new Error('troppe poche monete scaricate: ' + names.join(','));
  console.log('Caricate: ' + names.map(s => s + ' ' + data[s].length + 'g').join(', ') + '\n');

  const pad = (x, n) => String(x).padEnd(n);
  console.log(pad('Moneta', 7) + pad('Trade', 6) + pad('Vinti', 6) + pad('PF', 8) + pad('Rend%', 7) + pad('DD%', 5) + 'Tieni%(DD%)');
  let positive = 0;
  for (const s of names) {
    const r = simulate({ [s]: data[s] });
    const st = stats(r.trades);
    const ret = (r.final / CAPITAL - 1) * 100;
    const closes = data[s].map(x => x.c);
    const bh = (closes[closes.length - 1] / closes[0] - 1) * 100;
    const bhdd = maxDrawdownOf(closes) * 100;
    if (ret > 0) positive++;
    console.log(pad(s, 7) + pad(st.n, 6) + pad(Math.round(st.winRate * 100) + '%', 6) + pad(st.pf === Infinity ? 'inf' : st.pf.toFixed(2), 8) +
      pad(ret.toFixed(0), 7) + pad((r.maxDD * 100).toFixed(0), 5) + bh.toFixed(0) + '(' + bhdd.toFixed(0) + ')');
  }
  console.log('\nMonete con P&L positivo: ' + positive + ' su ' + names.length);

  const res = simulate(data);
  const st = stats(res.trades);
  const ret = (res.final / CAPITAL - 1) * 100;
  const d = x => new Date(x * 1000).toISOString().slice(0, 10);
  console.log('\nPORTAFOGLIO ' + names.length + ' MONETE | ' + d(res.from) + ' -> ' + d(res.to));
  console.log('Capitale finale: ' + res.final.toFixed(2) + ' (' + ret.toFixed(1) + '%)');
  console.log('Trade: ' + st.n + ' | Vinti: ' + (st.winRate * 100).toFixed(1) + '% | Profit factor: ' + (st.pf === Infinity ? 'inf' : st.pf.toFixed(2)));
  console.log('Max drawdown: ' + (res.maxDD * 100).toFixed(1) + '% | Stop -15% scattati: ' + res.halts + ' volte');

  const years = {};
  for (const x of res.trades) {
    const y = new Date(x.t * 1000).getUTCFullYear();
    years[y] = years[y] || { n: 0, pnl: 0 };
    years[y].n++; years[y].pnl += x.pnl;
  }
  const ys = Object.keys(years).sort().map(y => y + ': ' + (years[y].pnl >= 0 ? '+' : '') + years[y].pnl.toFixed(0) + ' (' + years[y].n + ')');
  console.log('Per anno P&L (trade):');
  for (let i = 0; i < ys.length; i += 3) console.log('  ' + ys.slice(i, i + 3).join(' | '));

  const c1 = positive >= 4;
  const c2 = st.n >= 30 && st.pf >= 1.3 && res.maxDD <= 0.20 && ret > 0;
  console.log('\nCriterio 1 (almeno 4 monete positive): ' + (c1 ? 'SI' : 'NO'));
  console.log('Criterio 2 (portafoglio): ' + (c2 ? 'SI' : 'NO'));
  console.log(c1 && c2 ? 'ESITO: il vantaggio si ripete su altre monete (con i limiti indicati)' : 'ESITO: il vantaggio NON si ripete in modo convincente');
})().catch(e => console.error('Errore:', e.message));