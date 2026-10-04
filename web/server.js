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
  const q = encodeURIComponent(JSON.stringify(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']));
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
  return send(res, 404, 'text/plain; charset=utf-8', 'Non trovato');
});

server.listen(PORT, '0.0.0.0', () => console.log('Pagina attiva sulla porta ' + PORT));