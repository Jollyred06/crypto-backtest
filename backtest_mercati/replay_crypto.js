// replay_crypto.js - riesegue la logica giornaliera di paper_trader.js (stepDay) sullo storico, giorno per giorno,
// e la confronta con la simulazione di riferimento backtest_nove.js (9 monete, i 76 trade del riferimento).
// Si lancia dalla cartella principale: node backtest_mercati/replay_crypto.js
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..');
const W = path.join(os.tmpdir(), 'replay_crypto');
const out = console.log.bind(console);
const DAY = 86400;
const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
const d10 = t => new Date(t * 1000).toISOString().slice(0, 10);

function loadBot() {
  const f = path.join(ROOT, 'paper_trader.js');
  if (!fs.existsSync(f)) { out('Non trovo paper_trader.js in ' + ROOT); process.exit(1); }
  let src = fs.readFileSync(f, 'utf8');
  if (!src.includes('function stepDay(')) { out('Formato di paper_trader.js inatteso, non posso fare il replay.'); process.exit(1); }
  src += '\nObject.assign(module.exports, { stepDay, newState, calcATR, equity, closePos, ATR_N, FETCH_DAYS });\n';
  fs.writeFileSync(path.join(W, 'pt_fn.js'), src);
  return require(path.join(W, 'pt_fn.js'));
}

function loadRef() {
  const f = path.join(ROOT, 'backtest_nove.js');
  if (!fs.existsSync(f)) { out('Non trovo backtest_nove.js in ' + ROOT); process.exit(1); }
  let src = fs.readFileSync(f, 'utf8');
  const i = src.lastIndexOf('(async () => {');
  if (i < 0 || !src.slice(i).includes('PORTAFOGLIO DA 9 MONETE')) { out('Formato di backtest_nove.js inatteso, non posso fare il replay.'); process.exit(1); }
  src = src.slice(0, i) + '\nmodule.exports = { simulate, SYMBOLS, getCandles, sleep };\n';
  fs.writeFileSync(path.join(W, 'bn_fn.js'), src);
  return require(path.join(W, 'bn_fn.js'));
}

(async () => {
  fs.mkdirSync(W, { recursive: true });
  const bot = loadBot(), ref = loadRef();

  out('Scarico lo storico (9 monete, Binance)...');
  const data = {};
  for (const [s, sym] of Object.entries(ref.SYMBOLS)) {
    const c = await ref.getCandles(sym);
    if (c.length < 400) { out('  ' + s + ': dati insufficienti (' + c.length + ' giorni), esclusa'); continue; }
    data[s] = c;
    await ref.sleep(500);
  }
  if (!data.BTC) { out('Storico BTC non disponibile, non posso fare il replay.'); process.exit(1); }
  const names = Object.keys(data);

  // riferimento: backtest_nove.js
  const R = ref.simulate(data);

  // replay: la funzione stepDay del bot, un giorno alla volta, con lo stato salvato e riletto ogni giorno (come su GitHub)
  const ind = {}, idx = {};
  for (const s of names) { ind[s] = { atr: bot.calcATR(data[s], bot.ATR_N) }; idx[s] = new Map(data[s].map((x, i) => [x.t, i])); }
  const times = data.BTC.map(x => x.t);
  let gaps = 0;
  for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] !== DAY) gaps++;
  const union = new Set(names.flatMap(s => data[s].map(x => x.t))).size;
  let S = bot.newState(times[0], data.BTC[0].c);
  for (const t of times) { bot.stepDay(S, t, data, idx, ind); S = JSON.parse(JSON.stringify(S)); }

  // confronto dei trade (il riferimento chiude a forza le posizioni ancora aperte a fine test: non contano come differenze)
  const lastT = times[times.length - 1];
  const openSyms = new Set(Object.keys(S.pos));
  const botTrades = S.trades.slice();
  const diffs = []; let ok = 0, forced = 0;
  const bm = new Map(botTrades.map(x => [x.s + '|' + x.t, x]));
  const perCoin = {};
  for (const r of R.trades) {
    const key = r.s + '|' + r.t, b = bm.get(key);
    if (b) {
      bm.delete(key);
      if (near(b.pnl, r.pnl) && near(b.pct, r.pct)) { ok++; perCoin[r.s] = (perCoin[r.s] || 0) + 1; }
      else diffs.push(r.s + ' chiuso il ' + d10(r.t) + ': bot ' + b.pnl.toFixed(2) + ', riferimento ' + r.pnl.toFixed(2));
    } else if (r.t === lastT && openSyms.has(r.s)) forced++;
    else diffs.push('manca nel bot: ' + r.s + ' chiuso il ' + d10(r.t));
  }
  bm.forEach(b => diffs.push('in più nel bot: ' + b.s + ' chiuso il ' + d10(b.t)));

  // altri controlli: drawdown, stop globale, segnali non eseguiti, capitale finale
  if (!near(S.maxDD, R.maxDD)) diffs.push('drawdown massimo: bot ' + (100 * S.maxDD).toFixed(2) + '%, riferimento ' + (100 * R.maxDD).toFixed(2) + '%');
  if (S.halts !== R.halts) diffs.push('stop globale scattato: bot ' + S.halts + ' volte, riferimento ' + R.halts);
  const missBot = (S.missed || []).reduce((a, m) => a + m.n, 0);
  const missSkip = (S.missed || []).length >= 500;
  if (!missSkip && missBot !== R.missDays) diffs.push('giorni-segnale non eseguiti: bot ' + missBot + ', riferimento ' + R.missDays);
  const eqOpen = bot.equity(S);
  for (const s of Object.keys(S.pos)) bot.closePos(S, s, S.pos[s].last, lastT, [], 'fine test');
  if (!near(S.cash, R.final)) diffs.push('capitale finale: bot ' + S.cash.toFixed(2) + ', riferimento ' + R.final.toFixed(2));

  // finestra di dati del bot dal vivo (ultimi FETCH_DAYS giorni): l'ATR deve coincidere con quello calcolato sullo storico intero
  let worst = 0, where = '';
  for (const s of names) {
    const n = data[s].length;
    for (let j = Math.max(bot.ATR_N + 1, n - 400); j < n; j++) {
      const w = data[s].slice(Math.max(0, j + 1 - bot.FETCH_DAYS), j + 1);
      const rel = Math.abs(bot.calcATR(w, bot.ATR_N)[w.length - 1] / ind[s].atr[j] - 1);
      if (rel > worst) { worst = rel; where = s + ' ' + d10(data[s][j].t); }
    }
  }
  if (worst > 1e-6) diffs.push('ATR sulla finestra di ' + bot.FETCH_DAYS + ' giorni diverso dallo storico intero: ' + (100 * worst).toExponential(1) + '% (' + where + ')');

  const nComp = R.trades.length - forced;
  const yrs = (lastT - times[0]) / (365.25 * DAY);
  out('\nGiorni simulati: ' + times.length + ' | periodo ' + d10(times[0]) + ' -> ' + d10(lastT) + ' | monete: ' + names.join(', '));
  if (gaps || union !== times.length) out('Attenzione: nello storico mancano ' + gaps + ' giorni di BTC (giorni unici in totale: ' + union + ' contro ' + times.length + '): può spostare di qualche giorno la pausa dopo lo stop globale.');
  out('Trade chiusi: riferimento ' + nComp + (forced ? ' (più ' + forced + ' posizione aperta chiusa a forza a fine test)' : '') + ' | bot ' + botTrades.length + ' | identici ' + ok);
  out('  ' + names.map(s => s + ': ' + (perCoin[s] || 0)).join(' | '));
  out('Capitale finale (dopo chiusura forzata): riferimento ' + R.final.toFixed(0) + ' | bot ' + S.cash.toFixed(0) + ' (da 3000) | annuo ' + (100 * (Math.pow(S.cash / 3000, 1 / yrs) - 1)).toFixed(1) + '%');
  out('Drawdown massimo: riferimento ' + (100 * R.maxDD).toFixed(1) + '% | bot ' + (100 * S.maxDD).toFixed(1) + '% | stop globale scattato: ' + R.halts + ' / ' + S.halts + ' volte');
  out('Giorni-segnale non eseguiti: riferimento ' + R.missDays + ' | bot ' + (missSkip ? 'non confrontabile (storico tagliato a 500 righe)' : missBot));
  out('Dati dal vivo (finestra di ' + bot.FETCH_DAYS + ' giorni): differenza massima dell\'ATR rispetto allo storico intero ' + worst.toExponential(1));

  if (diffs.length) { out('\nDIFFERENZE (' + diffs.length + '):'); diffs.slice(0, 15).forEach(x => out(' - ' + x)); process.exitCode = 1; }
  else out('\nREPLAY OK: la logica di paper_trader.js ha fatto esattamente gli stessi trade del riferimento (stesse date e stessi risultati), con stato salvato e riletto ogni giorno.');
})().catch(e => { out('Errore:', e.message); process.exit(1); });
