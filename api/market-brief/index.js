/**
 * Azure Static Web Apps API function.
 * GET/POST /api/market-brief?lang=en|ar
 *
 * Generates a daily AI-powered market commentary and directional outlook
 * for WTI, Brent, Gold, and Natural Gas — from an honest analyst perspective.
 *
 * Cache strategy: one brief per language per day, refreshed after 21:30 UTC
 * (US futures settlement / end-of-day). Stored in Azure Blob Storage.
 * Falls back to in-memory cache if Blob Storage is unavailable.
 */

'use strict';

const { OpenAI }            = require('openai');
const { BlobServiceClient } = require('@azure/storage-blob');

const API_KEY    = process.env.AZURE_OPENAI_API_KEY;
const ENDPOINT   = process.env.AZURE_OPENAI_ENDPOINT;
const MODEL_NAME = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o-mini';

const BLOB_CONTAINER = 'market-brief-cache';

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

const SYSTEM_PROMPT = `You are an experienced commodities market analyst. You are honest and direct — you tell people what you actually think, not what sounds good. You do not hedge everything into meaninglessness. You acknowledge uncertainty but still give a clear view.

You will receive 30-day price history for WTI crude oil, Brent crude, gold, and natural gas, along with today's price moves.

Your job: write a concise daily market brief that a smart non-expert can understand.

Rules:
- Be honest. If you think oil is likely to stay flat, say so. If gold looks like it's in a sustained run, say so.
- No generic disclaimers ("past performance is not..."). Get to the point.
- Acknowledge what you don't know or what could change your view.
- Write in the SAME LANGUAGE as the lang field in the request.
- For Arabic: use Modern Standard Arabic, not dialect. Be direct and clear, not flowery.

Return ONLY a raw JSON object (no markdown, no fences) with exactly these keys:
{
  "headline": "One punchy sentence summarising the day — the most important thing",
  "commentary": "2-3 sentences: what actually happened across these markets today and over the past month. Be specific with numbers.",
  "outlook": [
    { "asset": "WTI Oil",      "direction": "up|down|sideways", "conviction": "high|moderate|low", "reason": "1 sentence honest reason" },
    { "asset": "Brent Oil",    "direction": "up|down|sideways", "conviction": "high|moderate|low", "reason": "1 sentence honest reason" },
    { "asset": "Gold",         "direction": "up|down|sideways", "conviction": "high|moderate|low", "reason": "1 sentence honest reason" },
    { "asset": "Natural Gas",  "direction": "up|down|sideways", "conviction": "high|moderate|low", "reason": "1 sentence honest reason" }
  ],
  "watch": "1 sentence: the one thing that could change ALL of these views"
}`;

// ─── In-memory fallback ───────────────────────────────────────────────────────
const _memCache = {};

// ─── Main handler ─────────────────────────────────────────────────────────────

module.exports = async function (context, req) {
  const requestLang = (req.query?.lang || req.body?.lang) === 'ar' ? 'ar' : 'en';
  const blobName    = `market-brief-${requestLang}.json`;
  const boundary    = getDailyBoundary();

  // ── Try blob cache ──────────────────────────────────────────────────────────
  let container = null;
  try { container = getContainerClient(); } catch { /* no blob */ }

  if (container) {
    try {
      const cached = await readBlob(container, blobName);
      if (cached?.generatedAt >= boundary) {
        context.res = { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' }, body: JSON.stringify(cached) };
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
    // Fetch prices + 30-day history in parallel
    const [wti, brent, gold, natgas, hWti, hBrent, hGold, hNatgas] = await Promise.all([
      fetchPrice('CL=F'),
      fetchPrice('BZ=F'),
      fetchPrice('GC=F'),
      fetchPrice('NG=F'),
      fetchHistory('CL=F', 30),
      fetchHistory('BZ=F', 30),
      fetchHistory('GC=F', 30),
      fetchHistory('NG=F', 30),
    ]);

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

    const userMessage = `lang: ${requestLang}\n\n${marketContext}`;

    const client = new OpenAI({ baseURL: ENDPOINT, apiKey: API_KEY });
    const response = await client.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ],
      max_tokens: 1200,
      temperature: 0.6,
    });

    const content = response.choices?.[0]?.message?.content || '{}';
    // Strip any accidental markdown fences
    const raw = content.replace(/```(?:json)?/g, '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const result = JSON.parse(match[0]);

    result.generatedAt = Date.now();
    result._snapshot   = { wti, brent, gold, natgas };

    // Save to blob + memory
    _memCache[requestLang] = result;
    if (container) {
      try {
        await container.createIfNotExists();
        await writeBlob(container, blobName, result);
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
