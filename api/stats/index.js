'use strict';

const https = require('https');
const http = require('http');

// --- Simple in-memory cache (10 minutes) ---
let cache = null;
let cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000;

function fetchUrl(url, method = 'GET', body = null, extraHeaders = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const bodyBuf = body ? Buffer.from(body) : null;
    const options = {
      method,
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'yt-multi-player/1.0',
        ...(bodyBuf ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': bodyBuf.length } : {}),
        ...extraHeaders,
      },
    };
    const req = lib.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => { req.destroy(new Error(`Request timed out: ${url}`)); });
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

async function fetchYahooFinance(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;
    const raw = await fetchUrl(url);
    const json = JSON.parse(raw);
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;
    const price = meta.regularMarketPrice;
    const prev = meta.previousClose ?? meta.chartPreviousClose;
    const change = price - prev;
    const changePct = (change / prev) * 100;
    return {
      price: +price.toFixed(2),
      change: +change.toFixed(2),
      changePct: +changePct.toFixed(2),
      currency: meta.currency,
    };
  } catch {
    return null;
  }
}

// OAuth token cache

// OAuth token cache
let acledToken = null;
let acledTokenExpiry = 0;

async function getACLEDToken() {
  if (acledToken && Date.now() < acledTokenExpiry) return acledToken;
  const email    = process.env.ACLED_EMAIL;
  const password = process.env.ACLED_PASSWORD;
  if (!email || !password) return null;
  const body = `username=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}&grant_type=password&client_id=acled`;
  const raw = await fetchUrl('https://acleddata.com/oauth/token', 'POST', body);
  const json = JSON.parse(raw);
  acledToken = json.access_token;
  acledTokenExpiry = Date.now() + (json.expires_in - 300) * 1000;
  return acledToken;
}

async function fetchACLED() {
  try {
    const token = await getACLEDToken();
    if (!token) return { available: false, events: 0, fatalities: 0 };
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const sinceStr = since.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);
    const url = `https://acleddata.com/api/acled/read?_format=json&event_date=${sinceStr}|${todayStr}&event_date_where=BETWEEN&fields=fatalities&limit=500`;
    const raw = await fetchUrl(url, 'GET', null, { 'Authorization': `Bearer ${token}` });
    const json = JSON.parse(raw);
    const rows = json?.data ?? [];
    const fatalities = rows.reduce((sum, d) => sum + (parseInt(d.fatalities) || 0), 0);
    const count = json?.count ?? rows.length;
    return { available: true, events: Number(count), fatalities };
  } catch {
    return { available: false, events: 0, fatalities: 0 };
  }
}

module.exports = async function (context, req) {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL) {
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
      body: JSON.stringify(cache),
    };
    return;
  }

  const TOP_STOCKS = [
    { symbol: 'AAPL',  name: 'Apple' },
    { symbol: 'MSFT',  name: 'Microsoft' },
    { symbol: 'NVDA',  name: 'Nvidia' },
    { symbol: 'AMZN',  name: 'Amazon' },
    { symbol: 'GOOGL', name: 'Google' },
    { symbol: 'META',  name: 'Meta' },
    { symbol: 'TSLA',  name: 'Tesla' },
    { symbol: 'AVGO',  name: 'Broadcom' },
    { symbol: 'JPM',   name: 'JPMorgan' },
    { symbol: 'V',     name: 'Visa' },
  ];

  try {
    const [oil, gold, brent, natgas, acled, ...stockPrices] = await Promise.all([
      fetchYahooFinance('CL=F'),
      fetchYahooFinance('GC=F'),
      fetchYahooFinance('BZ=F'),
      fetchYahooFinance('NG=F'),
      fetchACLED(),
      ...TOP_STOCKS.map(s => fetchYahooFinance(s.symbol)),
    ]);

    const stocks = TOP_STOCKS.map((s, i) => ({
      symbol: s.symbol,
      name:   s.name,
      ...stockPrices[i],
    })).filter(s => s.price != null);

    const payload = {
      ts: new Date().toISOString(),
      prices: { oil, gold, brent, natgas },
      conflicts: acled,
      stocks,
    };

    cache = payload;
    cacheTime = now;

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
      body: JSON.stringify(payload),
    };
  } catch (err) {
    context.res = {
      status: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
