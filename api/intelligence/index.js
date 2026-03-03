/**
 * Azure Static Web Apps API function.
 * POST /api/intelligence
 * Versioned AI reports stored in Azure Blob Storage.
 * - Generates new report every 3 hours
 * - Keeps last 4 reports per language (12 hours history)
 * - Accepts { lang, historyIndex } — 0=latest, 1=3h ago, 2=6h ago, 3=9h ago
 */

const { AzureOpenAI }       = require('openai');
const { BlobServiceClient } = require('@azure/storage-blob');

const API_KEY     = 'REDACTED_AZURE_OPENAI_KEY';
const API_VERSION = '2024-12-01-preview';
const ENDPOINT    = 'https://***REMOVED***/';
const MODEL_NAME  = '***REMOVED***';
const DEPLOYMENT  = '***REMOVED***';

const BLOB_CONTAINER = 'intel-cache';
const CACHE_TTL_MS   = 3 * 60 * 60 * 1000; // 3 hours
const MAX_HISTORY    = 4;                    // keep 4 reports = 12h history

const RSS_FEEDS_EN = [
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { name: 'BBC News',   url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { name: 'Sky News',   url: 'https://feeds.skynews.com/feeds/rss/world.rss' },
];

const RSS_FEEDS_AR = [
  { name: 'الجزيرة',   url: 'https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9' },
  { name: 'سكاي نيوز', url: 'https://www.skynewsarabia.com/rss/breaking-news' },
  { name: 'العربية',   url: 'https://www.alarabiya.net/feed/last-page' },
];

const SYSTEM_PROMPT = `You are a sharp, well-informed person who follows global news closely. You speak directly and plainly — like someone explaining the situation to a smart friend, not writing a corporate report.

Tone rules:
- Sound human, conversational, and grounded — not stiff or bureaucratic
- Be direct: say what's actually happening and what it means, no hedging filler
- Stay neutral — no political side, no emotional spin
- Short, punchy sentences. No padding.
- key_dynamics should be concise 2-4 word labels (like tags), not full sentences
- IMPORTANT: Always write your response in the same language as the news headlines you are given.

Return ONLY a raw JSON object (no markdown fences) with exactly these keys:
{
  "situation_overview": "2-4 sentences: what's going on right now, stated plainly",
  "why_it_matters": "1-2 sentences: why this actually matters to people",
  "key_dynamics": ["short tag", "short tag", "short tag", "short tag", "short tag"],
  "risk_level": "Low" or "Moderate" or "Elevated" or "High",
  "short_term_outlook": "1-2 sentences: what's likely to happen next, honestly",
  "confidence_level": "High" or "Moderate" or "Low"
}`;

// ─── Blob helpers ──────────────────────────────────────────────────────────────

function getContainerClient() {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) return null;
  return BlobServiceClient.fromConnectionString(connStr).getContainerClient(BLOB_CONTAINER);
}

async function readBlob(container, blobName) {
  const client = container.getBlockBlobClient(blobName);
  const download = await client.download();
  const chunks = [];
  for await (const chunk of download.readableStreamBody) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function writeBlob(container, blobName, data) {
  const client = container.getBlockBlobClient(blobName);
  const json = JSON.stringify(data);
  await client.upload(json, Buffer.byteLength(json), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
    overwrite: true,
  });
}

async function readIndex(container, lang) {
  try { return await readBlob(container, `intel-${lang}-index.json`); }
  catch { return []; }
}

async function saveIndex(container, lang, index) {
  await writeBlob(container, `intel-${lang}-index.json`, index);
}

// ─── RSS helpers ───────────────────────────────────────────────────────────────

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
      const r = await fetch(feed.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const xml = await r.text();
      extractTitles(xml).forEach(t => all.push(`[${feed.name}] ${t}`));
    } catch (e) { console.warn(`RSS fetch failed: ${feed.name}`, e.message); }
  }));
  return all;
}

function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/s);
  const raw    = fenced ? fenced[1].trim() : text.trim();
  const match  = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in response');
  return JSON.parse(match[0]);
}

// ─── Main handler ──────────────────────────────────────────────────────────────

module.exports = async function (context, req) {
  if (req.method !== 'POST') {
    context.res = { status: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    return;
  }

  try {
    const body         = req.body || {};
    const requestLang  = body.lang === 'ar' ? 'ar' : 'en';
    const historyIndex = typeof body.historyIndex === 'number' ? body.historyIndex : 0;

    const container = getContainerClient();

    // ── Serve a historical report (not latest) ──────────────────────────────
    if (historyIndex > 0 && container) {
      const index = await readIndex(container, requestLang);
      const entry = index[historyIndex];
      if (entry) {
        console.log(`[intelligence] Serving history[${historyIndex}] for lang=${requestLang}`);
        const data = await readBlob(container, entry.key);
        data._historyIndex = historyIndex;
        data._historyTotal = index.length;
        context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
        return;
      }
    }

    // ── Serve fresh/cached latest report ────────────────────────────────────
    if (container) {
      const index = await readIndex(container, requestLang);
      if (index.length > 0 && Date.now() - index[0].generatedAt < CACHE_TTL_MS) {
        console.log(`[intelligence] Blob cache hit for lang=${requestLang}`);
        const data = await readBlob(container, index[0].key);
        data._historyIndex = 0;
        data._historyTotal = index.length;
        context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
        return;
      }
    }

    // ── Generate new report ─────────────────────────────────────────────────
    console.log(`[intelligence] Generating new report for lang=${requestLang}...`);
    const feeds     = requestLang === 'ar' ? RSS_FEEDS_AR : RSS_FEEDS_EN;
    const headlines = await fetchHeadlines(feeds);
    if (!headlines.length) {
      context.res = { status: 400, body: JSON.stringify({ error: 'No headlines available' }) };
      return;
    }

    const limit       = requestLang === 'ar' ? 12 : 25;
    const headlineText = headlines.slice(0, limit).map((h, i) => {
      const title = requestLang === 'ar' ? h.replace(/^\[[^\]]+\]\s*/, '') : h;
      return `${i + 1}. ${title}`;
    }).join('\n');

    const client = new AzureOpenAI({ endpoint: ENDPOINT, apiKey: API_KEY, deployment: DEPLOYMENT, apiVersion: API_VERSION });
    const response = await client.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `Analyze these live news headlines and return the JSON assessment:\n\n${headlineText}` },
      ],
      max_completion_tokens: 2000,
    });

    const choice  = response.choices?.[0];
    const content = choice?.message?.content || choice?.message?.refusal || '{}';
    const result  = extractJSON(content);
    result._generatedAt = Date.now();

    // Always set base history fields (overridden below if blob available)
    result._historyIndex = 0;
    result._historyTotal = 1;

    // Save versioned blob + update index
    if (container) {
      const blobKey = `intel-${requestLang}-${result._generatedAt}.json`;
      await writeBlob(container, blobKey, result);

      let index = await readIndex(container, requestLang);
      index.unshift({ key: blobKey, generatedAt: result._generatedAt });
      if (index.length > MAX_HISTORY) index = index.slice(0, MAX_HISTORY);
      await saveIndex(container, requestLang, index);

      result._historyIndex = 0;
      result._historyTotal = index.length;
      console.log(`[intelligence] New report saved. History length: ${index.length} for lang=${requestLang}`);
    }

    context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) };

  } catch (err) {
    console.error('[intelligence]', err);
    context.res = { status: 500, body: JSON.stringify({ error: 'Intelligence analysis failed', detail: err.message }) };
  }
};


