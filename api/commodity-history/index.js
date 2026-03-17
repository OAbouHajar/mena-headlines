'use strict';

const https = require('https');

// In-memory cache — 2h TTL (daily bars are stable)
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 2 * 60 * 60 * 1000;

const SYMBOLS = {
  oil:    'CL=F',
  gold:   'GC=F',
  brent:  'BZ=F',
  natgas: 'NG=F',
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      timeout: 12000,
      headers: { 'User-Agent': 'yt-multi-player/1.0' },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout: ${url}`)));
    req.on('error', reject);
    req.end();
  });
}

async function fetchHistory(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=7d`;
    const raw = await fetchUrl(url);
    const json = JSON.parse(raw);
    const result = json?.chart?.result?.[0];
    if (!result) return [];
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const points = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (close == null || isNaN(close)) continue;
      const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
      points.push({ date, close: +close.toFixed(2) });
    }
    return points;
  } catch {
    return [];
  }
}

module.exports = async function (context, req) {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL) {
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify(_cache),
    };
    return;
  }

  try {
    const [oil, gold, brent, natgas] = await Promise.all([
      fetchHistory(SYMBOLS.oil),
      fetchHistory(SYMBOLS.gold),
      fetchHistory(SYMBOLS.brent),
      fetchHistory(SYMBOLS.natgas),
    ]);

    const payload = { ts: new Date().toISOString(), oil, gold, brent, natgas };
    _cache = payload;
    _cacheTime = now;

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify(payload),
    };
  } catch (err) {
    context.res = { status: 500, body: JSON.stringify({ error: err.message }) };
  }
};
