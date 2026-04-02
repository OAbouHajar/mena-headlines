/**
 * Azure Static Web Apps API function.
 * GET  /api/market-brief?lang=en|ar           → latest brief
 * POST /api/market-brief  { lang, historyIndex } → latest or historical brief
 *
 * AI market analyst persona ("محلل الأسواق 📊") that:
 *  - Accumulates knowledge day-by-day (7-day versioned history in Blob Storage)
 *  - Feeds yesterday's own analysis back into today's prompt for self-evaluation
 *  - Scrapes live news headlines to connect events to price movements
 *  - Generates honest, direct market commentary with per-asset outlook
 *
 * Cache strategy: one brief per language per day boundary (21:30 UTC).
 * Falls back to in-memory cache if Blob Storage is unavailable.
 */

'use strict';

const { AzureOpenAI }       = require('openai');
const { BlobServiceClient } = require('@azure/storage-blob');

const API_KEY    = process.env.AZURE_OPENAI_API_KEY;
const API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2024-04-01-preview';
const ENDPOINT   = process.env.AZURE_OPENAI_ENDPOINT;
const MODEL_NAME = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5-mini';
const DEPLOYMENT = MODEL_NAME;

const BLOB_CONTAINER = 'market-brief-cache';
const MAX_HISTORY    = 7;

// Regenerate after 21:30 UTC (US futures settlement)
function getDailyBoundary() {
  const now = new Date();
  const boundary = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 21, 30, 0);
  return now.getTime() >= boundary ? boundary : boundary - 86400000;
}

// ─── Blob helpers ─────────────────────────────────────────────────────────────

function getContainerClient() {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) return null;
  return BlobServiceClient.fromConnectionString(connStr).getContainerClient(BLOB_CONTAINER);
}

async function readBlob(container, name) {
  const client = container.getBlockBlobClient(name);
  const dl = await client.download();
  const chunks = [];
  for await (const chunk of dl.readableStreamBody) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function writeBlob(container, name, data) {
  const client = container.getBlockBlobClient(name);
  const json = JSON.stringify(data);
  await client.upload(json, Buffer.byteLength(json), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
    overwrite: true,
  });
}

async function readIndex(container, lang) {
  try { return await readBlob(container, `market-brief-${lang}-index.json`); }
  catch { return []; }
}

async function saveIndex(container, lang, index) {
  await writeBlob(container, `market-brief-${lang}-index.json`, index);
}

// ─── RSS headline scraping ────────────────────────────────────────────────────

const RSS_FEEDS_EN = [
  { name: 'Al Jazeera',   url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { name: 'BBC World',    url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
];

const RSS_FEEDS_AR = [
  { name: 'الجزيرة',   url: 'https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9' },
  { name: 'سكاي نيوز', url: 'https://www.skynewsarabia.com/rss/breaking-news' },
  { name: 'العربية',   url: 'https://www.alarabiya.net/feed/last-page' },
];

function extractTitles(xml) {
  const titles = [];
  const items  = xml.split(/<item[\s>]/i);
  items.shift();
  for (const item of items) {
    const m = item.match(/<title[^>]*>\s*(?:<!\[CDATA\[)?\s*([\s\S]*?)\s*(?:\]\]>)?\s*<\/title>/i);
    if (m) {
      const t = m[1]
        .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
        .replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/<[^>]+>/g,'').trim();
      if (t && t.length > 10 && t.length < 300) titles.push(t);
    }
  }
  return titles.slice(0, 10);
}

async function fetchHeadlines(feeds) {
  const all = [];
  await Promise.all(feeds.map(async (feed) => {
    try {
      const r = await fetch(feed.url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000),
      });
      const xml = await r.text();
      extractTitles(xml).forEach(t => all.push(`[${feed.name}] ${t}`));
    } catch (e) { console.warn(`RSS fetch failed: ${feed.name}`, e.message); }
  }));
  return all;
}

// ─── Market data helpers ──────────────────────────────────────────────────────

async function fetchPrice(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    const json = await resp.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice;
    const prev  = meta.previousClose ?? meta.chartPreviousClose;
    return {
      price:     +price.toFixed(2),
      changePct: prev ? +(((price - prev) / prev) * 100).toFixed(2) : 0,
      prev:      prev ? +prev.toFixed(2) : null,
    };
  } catch { return null; }
}

async function fetchHistory(symbol, days = 30) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${days}d`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
    const json = await resp.json();
    const result = json?.chart?.result?.[0];
    if (!result) return [];
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const out = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] == null || isNaN(closes[i])) continue;
      out.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), close: +closes[i].toFixed(2) });
    }
    return out;
  } catch { return []; }
}

function historyToText(name, unit, points) {
  if (!points.length) return `${name}: no data`;
  const first = points[0].close;
  const last  = points[points.length - 1].close;
  const pct   = (((last - first) / first) * 100).toFixed(1);
  const trend = last > first ? 'up' : 'down';
  const recent = points.slice(-5).map(p => `${p.date}: $${p.close}`).join(', ');
  return `${name} (${unit}): ${trend} ${Math.abs(pct)}% over period. Last 5 days — ${recent}. Current: $${last}`;
}

// ─── OpenAI prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are "محلل الأسواق 📊" (Market Analyst) — a sharp, experienced commodities market analyst who tracks oil, gold, and energy markets day by day. You build knowledge over time: each day you receive your previous analysis alongside new data, so you can track patterns, evaluate whether your past calls were right, and explain what actually moved prices.

Your personality:
- Honest and direct — you say what you actually think, not what sounds safe
- You track your own predictions and admit when you were wrong
- You connect specific news events to price movements — not vague "geopolitical tensions"
- You notice multi-day patterns and trends building up
- You speak like a smart analyst talking to a friend, not writing a corporate report

You will receive:
1. Today's prices + 30-day price history for WTI, Brent, Gold, Natural Gas
2. Today's news headlines from major sources
3. Your own previous analysis (if available) — use it to evaluate your past calls

Rules:
- Be honest. If you were wrong yesterday, say so and explain why.
- Connect specific headlines to specific price moves. If oil went up 2%, explain which event(s) drove it.
- If no headline explains a move, say "no clear news catalyst" — don't invent connections.
- No generic disclaimers. Get to the point.
- Write in the SAME LANGUAGE as the lang field in the request.
- For Arabic: use Modern Standard Arabic, not dialect. Be direct and clear.

Return ONLY a raw JSON object (no markdown, no fences) with exactly these keys:
{
  "headline": "One punchy sentence — the most important market story today",
  "prediction_review": "1-2 sentences: honestly evaluate your previous prediction vs what actually happened. If this is your first analysis, set to null.",
  "commentary": "2-3 sentences: what happened across these markets today, with specific numbers. Connect news events to price moves.",
  "news_drivers": [
    { "event": "Short description of the news event", "impact": "How it affected prices", "assets_affected": ["WTI Oil", "Gold"] }
  ],
  "outlook": [
    { "asset": "WTI Oil",      "direction": "up|down|sideways", "conviction": "high|moderate|low", "reason": "1 sentence honest reason" },
    { "asset": "Brent Oil",    "direction": "up|down|sideways", "conviction": "high|moderate|low", "reason": "1 sentence honest reason" },
    { "asset": "Gold",         "direction": "up|down|sideways", "conviction": "high|moderate|low", "reason": "1 sentence honest reason" },
    { "asset": "Natural Gas",  "direction": "up|down|sideways", "conviction": "high|moderate|low", "reason": "1 sentence honest reason" }
  ],
  "pattern": "1 sentence: any multi-day pattern or trend you notice building up across days. null if none.",
  "watch": "1 sentence: the one thing that could change ALL of these views"
}`;

// ─── In-memory fallback ───────────────────────────────────────────────────────
const _memCache = {};

// ─── Main handler ─────────────────────────────────────────────────────────────

module.exports = async function (context, req) {
  const requestLang = (req.query?.lang || req.body?.lang) === 'ar' ? 'ar' : 'en';
  const historyIndex = typeof req.body?.historyIndex === 'number' ? req.body.historyIndex : 0;
  const boundary    = getDailyBoundary();

  // ── Try blob cache ──────────────────────────────────────────────────────────
  let container = null;
  try { container = getContainerClient(); } catch { /* no blob */ }

  // ── Serve a historical report (not latest) ────────────────────────────────
  if (historyIndex > 0 && container) {
    try {
      const index = await readIndex(container, requestLang);
      const entry = index[historyIndex];
      if (entry) {
        const data = await readBlob(container, entry.key);
        data._historyIndex = historyIndex;
        data._historyTotal = index.length;
        context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
        return;
      }
    } catch { /* fall through */ }
  }

  // ── Serve cached latest ───────────────────────────────────────────────────
  if (container) {
    try {
      const index = await readIndex(container, requestLang);
      if (index.length > 0 && index[0].generatedAt >= boundary) {
        const data = await readBlob(container, index[0].key);
        data._historyIndex = 0;
        data._historyTotal = index.length;
        context.res = { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' }, body: JSON.stringify(data) };
        return;
      }
    } catch { /* not found — generate */ }
  }

  // ── Try in-memory fallback ──────────────────────────────────────────────────
  const mem = _memCache[requestLang];
  if (mem?.generatedAt >= boundary) {
    context.res = { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' }, body: JSON.stringify(mem) };
    return;
  }

  // ── Check OpenAI credentials ────────────────────────────────────────────────
  if (!API_KEY || !ENDPOINT) {
    context.res = { status: 503, body: JSON.stringify({ error: 'OpenAI not configured' }) };
    return;
  }

  try {
    // Fetch prices, history, headlines, and yesterday's brief in parallel
    const feeds = requestLang === 'ar' ? RSS_FEEDS_AR : RSS_FEEDS_EN;

    const previousBriefPromise = (async () => {
      if (!container) return null;
      try {
        const index = await readIndex(container, requestLang);
        if (index.length > 0) return await readBlob(container, index[0].key);
      } catch { /* no previous */ }
      return null;
    })();

    const [wti, brent, gold, natgas, hWti, hBrent, hGold, hNatgas, headlines, previousBrief] = await Promise.all([
      fetchPrice('CL=F'),
      fetchPrice('BZ=F'),
      fetchPrice('GC=F'),
      fetchPrice('NG=F'),
      fetchHistory('CL=F', 30),
      fetchHistory('BZ=F', 30),
      fetchHistory('GC=F', 30),
      fetchHistory('NG=F', 30),
      fetchHeadlines(feeds),
      previousBriefPromise,
    ]);

    // Build market context
    const marketContext = [
      `Today's moves:`,
      wti    ? `  WTI Oil:     $${wti.price}   (${wti.changePct >= 0 ? '+' : ''}${wti.changePct}% today)` : '  WTI Oil: unavailable',
      brent  ? `  Brent Oil:   $${brent.price}  (${brent.changePct >= 0 ? '+' : ''}${brent.changePct}% today)` : '  Brent Oil: unavailable',
      gold   ? `  Gold:        $${gold.price}  (${gold.changePct >= 0 ? '+' : ''}${gold.changePct}% today)` : '  Gold: unavailable',
      natgas ? `  Natural Gas: $${natgas.price}  (${natgas.changePct >= 0 ? '+' : ''}${natgas.changePct}% today)` : '  Natural Gas: unavailable',
      `\n30-day history:`,
      historyToText('WTI Oil',     '$/bbl',   hWti),
      historyToText('Brent Oil',   '$/bbl',   hBrent),
      historyToText('Gold',        '$/oz',    hGold),
      historyToText('Natural Gas', '$/MMBtu', hNatgas),
    ].join('\n');

    // Build headlines context
    const headlinesContext = headlines.length > 0
      ? `\n\nToday's news headlines:\n${headlines.slice(0, 20).map((h, i) => `${i + 1}. ${h}`).join('\n')}`
      : '\n\nNo news headlines available today.';

    // Build previous analysis context
    let previousContext = '';
    if (previousBrief && previousBrief.headline) {
      const prev = previousBrief;
      const outlookSummary = Array.isArray(prev.outlook)
        ? prev.outlook.map(o => `  ${o.asset}: ${o.direction} (${o.conviction}) — ${o.reason}`).join('\n')
        : '  (no outlook)';
      previousContext = `\n\n--- YOUR PREVIOUS ANALYSIS (from ${new Date(prev.generatedAt).toISOString().slice(0, 10)}) ---
Headline: ${prev.headline}
Commentary: ${prev.commentary}
Your outlook was:
${outlookSummary}
${prev.pattern ? `Pattern you noticed: ${prev.pattern}` : ''}
${prev.watch ? `You said to watch: ${prev.watch}` : ''}
--- END PREVIOUS ANALYSIS ---
Use this to evaluate whether your past calls were correct or wrong. Be honest.`;
    }

    const userMessage = `lang: ${requestLang}\n\n${marketContext}${headlinesContext}${previousContext}`;

    const client = new AzureOpenAI({ endpoint: ENDPOINT, apiKey: API_KEY, apiVersion: API_VERSION, deployment: DEPLOYMENT });
    const response = await client.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ],
      max_completion_tokens: 2000,
      temperature: 0.6,
    });

    const content = response.choices?.[0]?.message?.content || '{}';
    const raw = content.replace(/```(?:json)?/g, '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const result = JSON.parse(match[0]);

    result.generatedAt = Date.now();
    result._snapshot   = { wti, brent, gold, natgas };
    result._headlines  = headlines.slice(0, 10);

    // Always set base history fields
    result._historyIndex = 0;
    result._historyTotal = 1;

    // Save versioned blob + update index
    _memCache[requestLang] = result;
    if (container) {
      try {
        await container.createIfNotExists();
        const blobKey = `market-brief-${requestLang}-${result.generatedAt}.json`;
        await writeBlob(container, blobKey, result);

        let index = await readIndex(container, requestLang);
        index.unshift({ key: blobKey, generatedAt: result.generatedAt });
        if (index.length > MAX_HISTORY) index = index.slice(0, MAX_HISTORY);
        await saveIndex(container, requestLang, index);

        result._historyIndex = 0;
        result._historyTotal = index.length;
      } catch (e) { console.warn('[market-brief] blob write failed:', e.message); }
    }

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
      body: JSON.stringify(result),
    };

  } catch (err) {
    console.error('[market-brief]', err);
    context.res = { status: 500, body: JSON.stringify({ error: 'Market brief generation failed', detail: err.message }) };
  }
};
