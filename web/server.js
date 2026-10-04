// web/server.js - Pagina privata "Prova virtuale"
// Legge paper_state.json dal repository GitHub (sola lettura) e mostra capitale, posizioni, segnali e trade.
// Protetta da utente e password. Nessun ordine reale, nessun accesso al conto di nessun exchange.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const REPO = process.env.REPO || 'Jollyred06/crypto-backtest';
const TOKEN = process.env.GITHUB_TOKEN;
const USER = process.env.DASH_USER;
const PASS = process.env.DASH_PASS;
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];

// Senza queste tre variabili il server non parte: cosi' la pagina non resta mai pubblica senza password.
if (!TOKEN || !USER || !PASS) {
  console.error('Mancano variabili d\'ambiente: servono GITHUB_TOKEN, DASH_USER e DASH_PASS.');
  process.exit(1);
}

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const SEC = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store'
};

// ---- Password ----
const digest = s => crypto.createHash('sha256').update(String(s)).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));
function hasCreds(req) { return (req.headers.authorization || '').startsWith('Basic '); }
function authed(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const raw = Buffer.from(h.slice(6), 'base64').toString('utf8');
  const i = raw.indexOf(':');
  if (i < 0) return false;
  const okUser = safeEq(raw.slice(0, i), USER);
  const okPass = safeEq(raw.slice(i + 1), PASS);
  return okUser && okPass;
}

// ---- Blocco dopo troppi tentativi sbagliati ----
const fails = new Map();
const MAX_FAILS = 8, BLOCK_MS = 15 * 60 * 1000;
const clientIp = req => ((req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'x';
function isBlocked(ip) { const f = fails.get(ip); return !!(f && f.until && f.until > Date.now()); }
function addFail(ip) {
  const f = fails.get(ip) || { n: 0, until: 0 };
  f.n++;
  if (f.n >= MAX_FAILS) { f.until = Date.now() + BLOCK_MS; f.n = 0; }
  fails.set(ip, f);
}

// ---- Dati ----
const cache = { state: null, stateAt: 0, prices: null, pricesAt: 0 };

async function getState() {
  if (cache.state && Date.now() - cache.stateAt < 120000) return cache.state;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/paper_state.json`, {
      headers: {
        Authorization: 'Bearer ' + TOKEN,
        Accept: 'application/vnd.github.raw+json',
        'User-Agent': 'paper-dashboard',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (r.status === 404) throw new Error('paper_state.json non trovato (file mancante o token senza accesso al repository)');
    if (r.status === 401 || r.status === 403) throw new Error('GitHub rifiuta il token (scaduto o senza permesso di lettura)');
    if (!r.ok) throw new Error('GitHub ha risposto ' + r.status);
    const s = JSON.parse(await r.text());
    cache.state = s; cache.stateAt = Date.now();
    return s;
  } catch (e) {
    if (cache.state) return cache.state; // meglio dati vecchi che niente
    throw e;
  }
}

async function getPrices() {
  if (cache.prices && Date.now() - cache.pricesAt < 60000) return cache.prices;
  const out = {};
  const q = encodeURIComponent(JSON.stringify(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'LTCUSDT', 'LINKUSDT']));
  for (const host of HOSTS) {
    try {
      const r = await fetch(`${host}/api/v3/ticker/price?symbols=${q}`);
      const j = await r.json();
      if (Array.isArray(j)) for (const x of j) out[x.symbol.replace('USDT', '')] = +x.price;
      if (Object.keys(out).length) break;
    } catch (e) { /* si prova il prossimo indirizzo */ }
  }
  cache.prices = out; cache.pricesAt = Date.now();
  return out;
}

async function getRepoText(file) {
  const key = 'txt:' + file;
  const c = cache[key];
  if (c && Date.now() - c.at < 120000) return c.v;
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${file}`, {
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github.raw+json',
      'User-Agent': 'paper-dashboard',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (!r.ok) throw new Error(file + ': GitHub ha risposto ' + r.status);
  const v = await r.text();
  cache[key] = { v, at: Date.now() };
  return v;
}

const dISO = t => new Date(t * 1000).toISOString().slice(0, 10);

// Log completo da caricare in chat: stato attuale + STRATEGIA.md (nessun dato di accesso al suo interno)
function buildLog(S, P, strategia) {
  const f = (n, d) => Number(n).toFixed(d === undefined ? 2 : d);
  const px = n => (Math.abs(n) >= 1 ? f(n, 2) : f(n, 4));
  const pos = Object.keys(S.pos || {});
  const pend = S.pend || {};
  const tr = S.trades || [];
  const eq = S.cash + pos.reduce((a, s) => a + S.pos[s].qty * S.pos[s].last, 0);
  const w = tr.filter(x => x.pnl > 0), l = tr.filter(x => x.pnl <= 0);
  const gw = w.reduce((a, x) => a + x.pnl, 0), gl = -l.reduce((a, x) => a + x.pnl, 0);
  const pf = tr.length ? (gl > 0 ? f(gw / gl) : (gw > 0 ? 'infinito' : '-')) : '-';
  const L = [];
  L.push('# LOG PROVA VIRTUALE (simulazione con prezzi reali, nessun ordine reale)');
  L.push('Generato: ' + new Date().toISOString() + ' (UTC)');
  L.push('Ultima candela chiusa: ' + dISO(S.lastT) + ' | Partenza: ' + dISO(S.startT) + ' | Capitale iniziale: ' + S.startCapital);
  L.push('');
  L.push('## Riepilogo');
  L.push('Capitale: ' + f(eq) + ' (' + (eq >= S.startCapital ? '+' : '') + f((eq / S.startCapital - 1) * 100, 1) + '%)');
  if (P && P.BTC && S.startBtc) L.push('BTC tenuto fermo dalla partenza (prezzo ora ' + px(P.BTC) + '): ' + f((P.BTC / S.startBtc - 1) * 100, 1) + '%');
  L.push('Drawdown massimo: ' + f(S.maxDD * 100, 1) + '% | Trade chiusi: ' + tr.length + ' | Win rate: ' + (tr.length ? Math.round(100 * w.length / tr.length) + '%' : '-') + ' | Profit factor: ' + pf);
  L.push('Stop globale -15%: ' + (S.halted ? 'ATTIVO fino al ' + dISO(S.haltUntilT) : 'non attivo') + ' (scattato ' + (S.halts || 0) + ' volte)');
  L.push('Cassa: ' + f(S.cash) + ' | Picco capitale (per il rischio): ' + f(S.peak) + ' | Picco assoluto: ' + f(S.gPeak));
  L.push('');
  L.push('## Posizioni aperte');
  if (!pos.length) L.push('Nessuna.');
  pos.forEach(s => {
    const p = S.pos[s];
    L.push('- ' + s + ': qta ' + Number(Number(p.qty).toPrecision(4)) + ', entrata ' + px(p.entry) + ', stop ' + px(p.stop) + ', ultima chiusura ' + px(p.last) +
      (P && P[s] ? ', prezzo ora ' + px(P[s]) : '') + (p.openT ? ', aperta il ' + dISO(p.openT) : ''));
  });
  L.push('');
  L.push('## Segnali in attesa (da eseguire alla prossima apertura)');
  const sig = Object.keys(pend);
  if (!sig.length) L.push('Nessuno.');
  sig.forEach(s => L.push('- ' + s + ': ' + (pend[s].type === 'BUY' ? 'COMPRA (ATR ' + px(pend[s].atr) + ')' : 'VENDI')));
  L.push('');
  L.push('## Trade chiusi (tutti)');
  if (!tr.length) L.push('Nessuno.');
  else {
    L.push('chiuso il | moneta | aperto il | entrata | uscita | P&L | P&L %');
    tr.forEach(x => L.push(dISO(x.t) + ' | ' + x.s + ' | ' + (x.openT ? dISO(x.openT) : '-') + ' | ' + px(x.entry) + ' | ' + px(x.exit) + ' | ' + (x.pnl >= 0 ? '+' : '') + f(x.pnl) + ' | ' + f(x.pct * 100, 1) + '%'));
  }
  L.push('');
  L.push('## Capitale giorno per giorno (ultimi ' + (S.days || []).length + ' giorni registrati)');
  L.push('giorno | capitale | eventi');
  (S.days || []).forEach(d => L.push(dISO(d.t) + ' | ' + f(d.eq) + ' | ' + ((d.ev || []).join('; ') || '-')));
  L.push('');
  L.push('---');
  L.push('# STRATEGIA E DIARIO (contenuto di STRATEGIA.md)');
  L.push(strategia);
  return L.join('\n') + '\n';
}

const send = (res, code, type, body, extra = {}) => { res.writeHead(code, { 'Content-Type': type, ...SEC, ...extra }); res.end(body); };

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/health') return send(res, 200, 'text/plain', 'ok');

  const ip = clientIp(req);
  if (isBlocked(ip)) return send(res, 429, 'text/plain; charset=utf-8', 'Troppi tentativi. Riprova tra qualche minuto.');
  if (!authed(req)) {
    if (hasCreds(req)) addFail(ip); // conta solo le password sbagliate, non la prima richiesta del browser
    return send(res, 401, 'text/plain; charset=utf-8', 'Accesso protetto', { 'WWW-Authenticate': 'Basic realm="Prova virtuale", charset="UTF-8"' });
  }
  fails.delete(ip);

  if (url === '/' || url === '/index.html') return send(res, 200, 'text/html; charset=utf-8', HTML);
  if (url === '/api/data') {
    try {
      const [state, prices] = await Promise.all([getState(), getPrices()]);
      return send(res, 200, 'application/json', JSON.stringify({ state, prices, updatedAt: new Date().toISOString() }));
    } catch (e) {
      return send(res, 502, 'application/json', JSON.stringify({ error: e.message }));
    }
  }
  if (url === '/api/log') {
    try {
      const [state, prices] = await Promise.all([getState(), getPrices()]);
      let strategia;
      try { strategia = await getRepoText('STRATEGIA.md'); } catch (e) { strategia = '(STRATEGIA.md non disponibile: ' + e.message + ')'; }
      const name = 'log-prova-virtuale-' + dISO(state.lastT) + '.txt';
      return send(res, 200, 'text/plain; charset=utf-8', buildLog(state, prices, strategia), { 'Content-Disposition': 'attachment; filename="' + name + '"' });
    } catch (e) {
      return send(res, 502, 'text/plain; charset=utf-8', 'Non riesco a preparare il log: ' + e.message);
    }
  }
  return send(res, 404, 'text/plain; charset=utf-8', 'Non trovato');
});

server.listen(PORT, '0.0.0.0', () => console.log('Pagina attiva sulla porta ' + PORT))