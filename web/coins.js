// web/coins.js - sezione "Monete seguite": dove si trova ogni moneta rispetto alle regole della strategia (sola lettura)
module.exports = function (HOSTS) {
  const COINS = { BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT', BNB: 'BNBUSDT', XRP: 'XRPUSDT', ADA: 'ADAUSDT', DOGE: 'DOGEUSDT', LTC: 'LTCUSDT', LINK: 'LINKUSDT' };
  let cache = null, cacheAt = 0;

  async function loadOne(sym) {
    for (const host of HOSTS) {
      try {
        const r = await fetch(`${host}/api/v3/klines?symbol=${sym}&interval=1d&limit=260`);
        const j = await r.json();
        if (!Array.isArray(j)) continue;
        const c = j.filter(x => x[6] < Date.now()).map(x => +x[4]); // solo chiusure di candele chiuse
        if (c.length < 205) continue;
        const sma = c.slice(-200).reduce((a, b) => a + b, 0) / 200;
        return { close: c[c.length - 1], sma, hi: Math.max(...c.slice(-55)), lo20: Math.min(...c.slice(-20)) };
      } catch (e) { /* si prova il prossimo indirizzo */ }
    }
    return null;
  }

  async function load() {
    if (cache && Date.now() - cacheAt < 30 * 60 * 1000) return cache;
    const names = Object.keys(COINS);
    const res = await Promise.all(names.map(s => loadOne(COINS[s])));
    const out = {};
    names.forEach((s, i) => { if (res[i]) out[s] = res[i]; });
    cache = out; cacheAt = Date.now();
    return out;
  }

  const nf = (n, d) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
  const px = n => (Math.abs(n) >= 1 ? nf(n, 2) : nf(n, 4));
  const sg = n => (n >= 0 ? '+' : '') + nf(n, 1) + '%';
  const row = (s, price, below, rb, rs) => '<div class="row"><div><b>' + s + '</b> <span class="muted">' + price + '</span><small>' + below + '</small></div>' +
    '<div style="text-align:right">' + rb + '<small>' + rs + '</small></div></div>';

  return async function coinsHtml(S, P) {
    let data = {};
    try { data = await load(); } catch (e) { data = {}; }
    const pos = (S && S.pos) || {}, pend = (S && S.pend) || {};
    const rows = Object.keys(COINS).map(s => {
      const c = data[s];
      const price = (P && P[s]) || (c && c.close);
      if (!c || !price) return { rank: 1e9, html: row(s, '', 'dati non disponibili', '<b class="muted">-</b>', '') };
      if (pos[s]) {
        return { rank: 0, html: row(s, px(price), '<span class="pill buy">IN POSIZIONE</span> esce se chiude sotto ' + px(c.lo20),
          '<b class="' + (price >= pos[s].entry ? 'up' : 'down') + '">' + sg((price / pos[s].entry - 1) * 100) + '</b>', 'dall\'entrata') };
      }
      if (pend[s] && pend[s].type === 'BUY') {
        return { rank: 0.5, html: row(s, px(price), '<span class="pill buy">SEGNALE</span> acquisto alla prossima apertura', '', '') };
      }
      const toSma = (price / c.sma - 1) * 100;
      if (price > c.sma) {
        const gap = (c.hi / price - 1) * 100;
        return { rank: 1 + Math.max(gap, 0), html: row(s, px(price), 'sopra la media 200 (' + sg(toSma) + ')',
          gap <= 0 ? '<b class="up">sul massimo</b>' : '<b>' + sg(gap) + '</b>', gap <= 0 ? 'segnale se chiude cosi' : 'al massimo a 55 giorni') };
      }
      return { rank: 1000 + (c.sma / price - 1) * 100, html: row(s, px(price), '<span class="down">sotto la media 200 (' + sg(toSma) + ')</span>', '<b class="muted">-</b>', 'nessun segnale possibile') };
    });
    rows.sort((a, b) => a.rank - b.rank);
    return '<h2>Monete seguite (' + rows.length + ')</h2><div class="card">' + rows.map(r => r.html).join('') + '</div>' +
      '<p class="note">Una moneta diventa candidata quando sta sopra la media a 200 giorni e supera il massimo degli ultimi 55 giorni. Il segnale vale solo a chiusura giornaliera (00:00 UTC).</p>';
  };
};