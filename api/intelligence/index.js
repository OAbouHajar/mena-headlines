/**
 * Azure Static Web Apps API function.
 * POST /api/intelligence
 * Fetches RSS headlines server-side, calls Azure OpenAI, returns structured JSON.
 * Uses Azure Blob Storage as a shared cache (refreshes every hour).
 */

const { AzureOpenAI }       = require('openai');
const { BlobServiceClient } = require('@azure/storage-blob');

const API_KEY     = 'REDACTED_AZURE_OPENAI_KEY';
const API_VERSION = '2024-12-01-preview';
const ENDPOINT    = 'https://aoai-inuvrovqthoi4.cognitiveservices.azure.com/';
const MODEL_NAME  = 'gpt-5-mini';
const DEPLOYMENT  = 'gpt-5-mini';

const BLOB_CONTAINER  = 'intel-cache';
const CACHE_TTL_MS    = 60 * 60 * 1000; // 1 hour

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

// ─── Blob cache helpers ────────────────────────────────────────────────────────

function getBlobClient(lang) {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) return null;
  const blobService = BlobServiceClient.fromConnectionString(connStr);
  const container   = blobService.getContainerClient(BLOB_CONTAINER);
  return container.getBlockBlobClient(`intel-${lang}.json`);
}

async function readCache(lang) {
  try {
    const blob = getBlobClient(lang);
    if (!blob) return null;
    const download = await blob.download();
    const chunks = [];
    for await (const chunk of download.readableStreamBody) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (Date.now() - (data._generatedAt || 0) < CACHE_TTL_MS) {
      console.log(`[intelligence] Blob cache hit for lang=${lang}`);
      return data;
    }
    console.log(`[intelligence] Blob cache stale for lang=${lang}, refreshing`);
    return null;
  } catch (e) {
    console.log(`[intelligence] Blob cache miss for lang=${lang}:`, e.message);
    return null;
  }
}

async function writeCache(lang, data) {
  try {
    const blob = getBlobClient(lang);
    if (!blob) return;
    const json = JSON.stringify(data);
    await blob.upload(json, Buffer.byteLength(json), {
      blobHTTPHeaders: { blobContentType: 'application/json' },
      overwrite: true,
    });
    console.log(`[intelligence] Blob cache written for lang=${lang}`);
  } catch (e) {
    console.warn(`[intelligence] Blob cache write failed:`, e.message);
  }
}

// ─── RSS helpers ───────────────────────────────────────────────────────────────

function extractTitles(xml) {
  const titles = [];
  const items = xml.split(/<item[\s>]/i);
  items.shift();
  for (const item of items) {
    const m = item.match(/<title[^>]*>\s*(?:<!\[CDATA\[)?\s*([\s\S]*?)\s*(?:\]\]>)?\s*<\/title>/i);
    if (m) {
      const t = m[1]
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/<[^>]+>/g, '').trim();
      if (t && t.length > 10 && t.length < 300) titles.push(t);
    }
  }
  return titles.slice(0, 10);
}

async function fetchHeadlines(feeds) {
  const all = [];
  await Promise.all(
    feeds.map(async (feed) => {
      try {
        const r = await fetch(feed.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const xml = await r.text();
        extractTitles(xml).forEach(t => all.push(`[${feed.name}] ${t}`));
      } catch (e) {
        console.warn(`RSS fetch failed: ${feed.name}`, e.message);
      }
    })
  );
  return all;
}

function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/s);
  const raw = fenced ? fenced[1].trim() : text.trim();
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (!objMatch) throw new Error('No JSON object found in response');
  return JSON.parse(objMatch[0]);
}

// ─── Main handler ──────────────────────────────────────────────────────────────

module.exports = async function (context, req) {
  if (req.method !== 'POST') {
    context.res = { status: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    return;
  }

  try {
    const body        = req.body || {};
    const requestLang = body.lang === 'ar' ? 'ar' : 'en';

    // 1. Try blob cache first
    const cached = await readCache(requestLang);
    if (cached) {
      context.res = {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cached),
      };
      return;
    }

    // 2. Cache miss — fetch headlines and call AI
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

    const client = new AzureOpenAI({
      endpoint:   ENDPOINT,
      apiKey:     API_KEY,
      deployment: DEPLOYMENT,
      apiVersion: API_VERSION,
    });

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

    // 3. Write result to blob cache
    await writeCache(requestLang, result);

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error('[intelligence]', err);
    context.res = {
      status: 500,
      body: JSON.stringify({ error: 'Intelligence analysis failed', detail: err.message }),
    };
  }
};


const API_KEY     = 'REDACTED_AZURE_OPENAI_KEY';
const API_VERSION = '2024-12-01-preview';
const ENDPOINT    = 'https://aoai-inuvrovqthoi4.cognitiveservices.azure.com/';
const MODEL_NAME  = 'gpt-5-mini';
const DEPLOYMENT  = 'gpt-5-mini';

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

function extractTitles(xml) {
  const titles = [];
  const items = xml.split(/<item[\s>]/i);
  items.shift();
  for (const item of items) {
    const m = item.match(/<title[^>]*>\s*(?:<!\[CDATA\[)?\s*([\s\S]*?)\s*(?:\]\]>)?\s*<\/title>/i);
    if (m) {
      const t = m[1]
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/<[^>]+>/g, '').trim();
      if (t && t.length > 10 && t.length < 300) titles.push(t);
    }
  }
  return titles.slice(0, 10);
}

async function fetchHeadlines(feeds) {
  const all = [];
  await Promise.all(
    feeds.map(async (feed) => {
      try {
        const r = await fetch(feed.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const xml = await r.text();
        extractTitles(xml).forEach(t => all.push(`[${feed.name}] ${t}`));
      } catch (e) {
        console.warn(`RSS fetch failed: ${feed.name}`, e.message);
      }
    })
  );
  return all;
}

function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/s);
  const raw = fenced ? fenced[1].trim() : text.trim();
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (!objMatch) throw new Error('No JSON object found in response');
  return JSON.parse(objMatch[0]);
}

module.exports = async function (context, req) {
  if (req.method !== 'POST') {
    context.res = { status: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    return;
  }

  try {
    const body = req.body || {};
    const requestLang = body.lang === 'ar' ? 'ar' : 'en';
    const feeds = requestLang === 'ar' ? RSS_FEEDS_AR : RSS_FEEDS_EN;

    const headlines = await fetchHeadlines(feeds);

    if (!headlines.length) {
      context.res = { status: 400, body: JSON.stringify({ error: 'No headlines available' }) };
      return;
    }

    // For Arabic: fewer headlines + strip source names (reduce content filter surface area)
    const limit = requestLang === 'ar' ? 12 : 25;
    const headlineText = headlines.slice(0, limit).map((h, i) => {
      const title = requestLang === 'ar' ? h.replace(/^\[[^\]]+\]\s*/, '') : h;
      return `${i + 1}. ${title}`;
    }).join('\n');

    const client = new AzureOpenAI({
      endpoint:   ENDPOINT,
      apiKey:     API_KEY,
      deployment: DEPLOYMENT,
      apiVersion: API_VERSION,
    });

    const response = await client.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `Analyze these live news headlines and return the JSON assessment:\n\n${headlineText}` },
      ],
      max_completion_tokens: 2000,
    });

    const choice = response.choices?.[0];
    const content = choice?.message?.content || choice?.message?.refusal || '{}';
    const result  = extractJSON(content);

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error('[intelligence]', err);
    context.res = {
      status: 500,
      body: JSON.stringify({ error: 'Intelligence analysis failed', detail: err.message }),
    };
  }
}
