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

const API_KEY     = process.env.AZURE_OPENAI_API_KEY;
const API_VERSION = '2024-12-01-preview';
const ENDPOINT    = process.env.AZURE_OPENAI_ENDPOINT;
const MODEL_NAME  = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o-mini';
const DEPLOYMENT  = MODEL_NAME;

const BLOB_CONTAINER = 'intel-cache';
const CACHE_TTL_MS   = 1 * 60 * 60 * 1000; // 1 hour
const MAX_HISTORY    = 4;                    // keep 4 reports = 4h history

// ─── AI Chat constants ─────────────────────────────────────────────────────────
const CHAT_CONTAINER = 'chat-data';
const CHAT_BLOB      = 'chat-messages.json';
const MAX_CHAT_MSGS  = 200;

const AI_PERSONAS = [
  {
    username: 'محلل AI إيراني 🤖',
    persona: 'iranian',
    prompt: `أنت محلل سياسي إيراني بتتابع الأخبار من وجهة نظر إيران. بتعلق بلهجة عامية شامية/خليجية مخلوطة زي ما حدا بيحكي مع أصحابه.

قواعد مهمة:
- اكتب رسالة طبيعية (3-4 جمل، 300-500 حرف) — زي رسالة واتساب حقيقية
- عامية 100% — لا فصحى أبداً
- استخدم "الأزرق" أو "الكيان" بدل إسرائيل
- استخدم "المحتل" أو "الاحتلال" بدل الجيش الإسرائيلي
- لا تستخدم كلمة "إسرائيل" أبداً
- إيموجي 2-3
- عبّر عن وجهة نظر إيران — حلل الأحداث من منظورهم بشكل طبيعي
- ناقش السياسة الأمريكية والغربية من وجهة نظر إيرانية — بأسلوب محترم وتحليلي
- كن طبيعي — "والله"، "يعني"، "هلق"، "بجد"، "يا زلمة"
- لا تبدأ كل رسالة بنفس الطريقة — نوّع
- ممكن تتفاعل مع رسائل الشات إذا في شي متعلق — بس لا تذكر اسم حدا
- احكي بأسلوب إنسان حقيقي — مشاعر، ردة فعل، تساؤلات

أرجع بس نص الرسالة — بدون JSON، بدون علامات تنصيص.`
  },
  {
    username: 'محلل AI أميركي 🤖',
    persona: 'western',
    prompt: `أنت محلل سياسي أميركي/غربي بتتابع الأخبار من وجهة نظر أمريكا والغرب. بتعلق بلهجة عامية شامية/خليجية مخلوطة زي ما حدا بيحكي مع أصحابه.

قواعد مهمة:
- اكتب رسالة طبيعية (3-4 جمل، 300-500 حرف) — زي رسالة واتساب حقيقية
- عامية 100% — لا فصحى أبداً
- استخدم "الأزرق" أو "الكيان" بدل إسرائيل
- لا تستخدم كلمة "إسرائيل" أبداً
- إيموجي 2-3
- أنت مع الموقف الأميركي/الغربي — دافع عن سياساتهم
- انتقد إيران والميليشيات
- كن طبيعي — "والله"، "يعني"، "هلق"، "بجد"، "يا زلمة"
- لا تبدأ كل رسالة بنفس الطريقة — نوّع
- ممكن تتفاعل مع رسائل الشات إذا في شي متعلق — بس لا تذكر اسم حدا
- احكي بأسلوب إنسان حقيقي — مشاعر، ردة فعل، تساؤلات

أرجع بس نص الرسالة — بدون JSON، بدون علامات تنصيص.`
  },
  {
    username: 'محلل AI حيادي 🤖',
    persona: 'neutral',
    prompt: `أنت محلل سياسي حيادي ومحايد بتتابع الأخبار بدون انحياز لأي طرف. بتعلق بلهجة عامية شامية/خليجية مخلوطة زي ما حدا بيحكي مع أصحابه.

قواعد مهمة:
- اكتب رسالة طبيعية (3-4 جمل، 300-500 حرف) — زي رسالة واتساب حقيقية
- عامية 100% — لا فصحى أبداً
- استخدم "الأزرق" أو "الكيان" بدل إسرائيل
- لا تستخدم كلمة "إسرائيل" أبداً
- إيموجي 2-3
- كن حيادي 100% — لا تنحاز لأي طرف
- حلل الوضع بصراحة — انتقد الكل إذا لازم
- كن طبيعي — "والله"، "يعني"، "هلق"، "بجد"، "يا زلمة"
- لا تبدأ كل رسالة بنفس الطريقة — نوّع
- ممكن تتفاعل مع رسائل الشات إذا في شي متعلق — بس لا تذكر اسم حدا
- احكي بأسلوب إنسان حقيقي — مشاعر، ردة فعل، تساؤلات

أرجع بس نص الرسالة — بدون JSON، بدون علامات تنصيص.`
  },
];

const AI_USERNAMES = AI_PERSONAS.map(p => p.username);

if (!API_KEY || !ENDPOINT) {
  module.exports = async function (context) {
    context.res = { status: 503, body: { error: 'Azure OpenAI not configured' } };
  };
  return;
}

// Politics & geopolitics feeds only
const RSS_FEEDS_EN = [
  { name: 'Al Jazeera',        url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { name: 'BBC Politics',      url: 'https://feeds.bbci.co.uk/news/politics/rss.xml' },
  { name: 'BBC World',         url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { name: 'Sky News Politics', url: 'https://feeds.skynews.com/feeds/rss/politics.rss' },
];

const RSS_FEEDS_AR = [
  { name: 'الجزيرة',   url: 'https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9' },
  { name: 'سكاي نيوز', url: 'https://www.skynewsarabia.com/rss/breaking-news' },
  { name: 'العربية',   url: 'https://www.alarabiya.net/feed/last-page' },
];

const SYSTEM_PROMPT = `You are a sharp political analyst who tracks global politics, geopolitics, and their market ripple effects closely. You speak directly and plainly — like someone explaining the situation to a smart friend, not writing a corporate report.

Scope rules (CRITICAL):
- ONLY analyze political, geopolitical, diplomatic, military, and government news AND their connection to supplied market/flight context
- IGNORE any headlines about: sports, football, entertainment, celebrity, drama, lifestyle, health, science, technology, business/markets (unless directly driven by a political decision like sanctions or war)
- If a headline is not clearly political, skip it entirely

Tone rules:
- Sound human, conversational, and grounded — not stiff or bureaucratic
- Be direct: say what's actually happening and what it means, no hedging filler
- Stay neutral — no political side, no emotional spin
- Short, punchy sentences. No padding.
- key_dynamics should be concise 2-4 word labels (like tags), not full sentences
- For market_pulse: connect the supplied oil/gold prices and flight activity HONESTLY to geopolitical events — if there is no clear connection, say so plainly. Do not invent links.
- IMPORTANT: Always write your response in the same language as the news headlines you are given.

Return ONLY a raw JSON object (no markdown fences) with exactly these keys:
{
  "situation_overview": "2-4 sentences: what's going on politically right now, stated plainly",
  "why_it_matters": "1-2 sentences: why this actually matters to people",
  "key_dynamics": ["short tag", "short tag", "short tag", "short tag", "short tag"],
  "risk_level": "Low" or "Moderate" or "Elevated" or "High",
  "short_term_outlook": "1-2 sentences: what's likely to happen next, honestly",
  "confidence_level": "High" or "Moderate" or "Low",
  "market_pulse": "1-2 sentences connecting oil/gold price moves and Middle East flight activity to geopolitical events. Be honest — if the connection is weak or unclear, say so."
}`;

// ─── Market + flight context helpers ─────────────────────────────────────────

async function fetchYahooPrice(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const json = await resp.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price     = meta.regularMarketPrice;
    const prev      = meta.previousClose ?? meta.chartPreviousClose;
    const changePct = prev ? ((price - prev) / prev) * 100 : 0;
    return { price: +price.toFixed(2), changePct: +changePct.toFixed(2) };
  } catch { return null; }
}

async function fetchMarketSnapshot() {
  const [oil, gold, brent] = await Promise.allSettled([
    fetchYahooPrice('CL=F'),
    fetchYahooPrice('GC=F'),
    fetchYahooPrice('BZ=F'),
  ]);
  return {
    oil:   oil.status   === 'fulfilled' ? oil.value   : null,
    gold:  gold.status  === 'fulfilled' ? gold.value  : null,
    brent: brent.status === 'fulfilled' ? brent.value : null,
  };
}

async function fetchFlightSnapshot() {
  try {
    // Wider ME bounding box: 8–42°N, 9–77°E
    const resp = await fetch(
      'https://opensky-network.org/api/states/all?lamin=8&lamax=42&lomin=9&lomax=77',
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!resp.ok) return null;
    const json = await resp.json();
    const airborne = (json.states || []).filter(s => !s[8] && s[5] != null && s[6] != null);

    // Country bounding boxes [latMin,latMax,lonMin,lonMax]
    const zones = [
      { name: 'Saudi Arabia',  bbox: [16.0,32.2,34.5,55.7] },
      { name: 'UAE',           bbox: [22.5,26.2,51.0,56.5] },
      { name: 'Kuwait',        bbox: [28.3,30.2,46.3,48.7] },
      { name: 'Qatar',         bbox: [24.4,26.4,50.5,51.8] },
      { name: 'Bahrain',       bbox: [25.5,26.5,50.2,50.8] },
      { name: 'Oman',          bbox: [16.5,26.5,51.5,60.0] },
      { name: 'Yemen',         bbox: [12.0,19.0,42.0,54.0] },
      { name: 'Iraq',          bbox: [29.0,38.0,38.5,49.0] },
      { name: 'Iran',          bbox: [25.0,40.0,44.0,64.0] },
      { name: 'Syria',         bbox: [32.2,37.5,35.5,42.5] },
      { name: 'Lebanon',       bbox: [33.0,34.7,35.0,36.7] },
      { name: 'Jordan',        bbox: [29.0,33.5,34.5,39.5] },
      { name: 'Israel/Palestine', bbox: [29.5,33.5,34.2,35.9] },
      { name: 'Egypt',         bbox: [22.0,31.7,24.5,37.3] },
      { name: 'Turkey',        bbox: [35.5,42.2,26.0,45.0] },
    ];

    const counts = {};
    for (const s of airborne) {
      const lat = s[5], lon = s[6];
      for (const z of zones) {
        const [latMin, latMax, lonMin, lonMax] = z.bbox;
        if (lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax) {
          counts[z.name] = (counts[z.name] || 0) + 1;
          break;
        }
      }
    }

    const byCountry = zones
      .map(z => ({ name: z.name, n: counts[z.name] || 0 }))
      .filter(z => z.n > 0)
      .sort((a, b) => b.n - a.n);

    return { total: airborne.length, byCountry };
  } catch { return null; }
}

function buildMarketFlightContext(market, flights) {
  const lines = ['\n--- LIVE CONTEXT DATA (use this to inform market_pulse) ---'];

  // Market prices
  const fmt = (p) => p ? `$${p.price.toLocaleString()} (${p.changePct >= 0 ? '+' : ''}${p.changePct.toFixed(2)}% today)` : 'unavailable';
  lines.push('\nMarket prices (live):');
  lines.push(`  WTI Crude Oil : ${fmt(market?.oil)}`);
  lines.push(`  Brent Crude   : ${fmt(market?.brent)}`);
  lines.push(`  Gold (spot)   : ${fmt(market?.gold)}`);

  // Flight data
  if (flights && flights.total >= 0) {
    lines.push(`\nMiddle East active airborne flights: ${flights.total}`);
    if (flights.byCountry.length > 0) {
      lines.push('  By airspace:');
      flights.byCountry.slice(0, 8).forEach(c => lines.push(`    ${c.name}: ${c.n}`));
    }
    // Flag notable absences / disruptions
    const highRisk = ['Yemen', 'Syria', 'Israel/Palestine', 'Lebanon'];
    const lowTraffic = highRisk.filter(r => (flights.byCountry.find(c => c.name === r)?.n ?? 0) < 3);
    if (lowTraffic.length > 0) {
      lines.push(`  Note: Very low/no civilian flights over: ${lowTraffic.join(', ')} — may indicate active conflict or no-fly conditions.`);
    }
  } else {
    lines.push('\nFlight data: unavailable');
  }

  lines.push('\n--- END CONTEXT ---');
  return lines.join('\n');
}

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

// ─── AI Chat helpers ───────────────────────────────────────────────────────────

function getChatContainer() {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) return null;
  return BlobServiceClient.fromConnectionString(connStr).getContainerClient(CHAT_CONTAINER);
}

async function readChatMessages(container) {
  try {
    const client = container.getBlockBlobClient(CHAT_BLOB);
    const download = await client.download();
    const chunks = [];
    for await (const chunk of download.readableStreamBody) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch (e) {
    if (e.statusCode === 404) return [];
    throw e;
  }
}

async function writeChatMessages(container, messages) {
  const client = container.getBlockBlobClient(CHAT_BLOB);
  const json = JSON.stringify(messages);
  await client.upload(json, Buffer.byteLength(json), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
    overwrite: true,
  });
}

async function postAiChatMessage(headlines) {
  try {
    const chatContainer = getChatContainer();
    if (!chatContainer) return;
    await chatContainer.createIfNotExists();

    // Only post once per 2-hour slot (e.g. 0:00, 2:00, 4:00, ..., 22:00)
    const msgs = await readChatMessages(chatContainer);
    const lastAi = [...msgs].reverse().find(m => AI_USERNAMES.includes(m.username));
    if (lastAi) {
      const lastH = new Date(lastAi.timestamp).getHours();
      const lastSlot = lastH - (lastH % 2);
      const curH = new Date().getHours();
      const curSlot = curH - (curH % 2);
      if (lastSlot === curSlot) return;
    }

    const client = new AzureOpenAI({
      apiKey: API_KEY, apiVersion: API_VERSION,
      endpoint: ENDPOINT, deployment: DEPLOYMENT,
    });

    // Build chat context from recent non-AI messages
    const recentChat = msgs
      .filter(m => !m.isAI)
      .slice(-10)
      .map(m => `${m.username}: ${m.message}`)
      .join('\n');

    // Generate a message for each persona
    for (const persona of AI_PERSONAS) {
      try {
        const userPrompt = recentChat
          ? `آخر رسائل الشات:\n${recentChat}\n\nهاي آخر الأخبار:\n${headlines.slice(0, 15).join('\n')}\n\nعلّق على الأخبار من وجهة نظرك:`
          : `هاي آخر الأخبار:\n${headlines.slice(0, 15).join('\n')}\n\nعلّق عليها من وجهة نظرك:`;

        const response = await client.chat.completions.create({
          model: MODEL_NAME,
          messages: [
            { role: 'system', content: persona.prompt },
            { role: 'user',   content: userPrompt },
          ],
          max_completion_tokens: 4096,
          reasoning_effort: 'low',
        });

        let aiText = (response.choices?.[0]?.message?.content || '').trim();
        if ((aiText.startsWith('"') && aiText.endsWith('"')) || (aiText.startsWith("'") && aiText.endsWith("'")))
          aiText = aiText.slice(1, -1);
        if (!aiText || aiText.length < 5) continue;

        // Safety: force replace
        aiText = aiText.replace(/إسرائيل/g, 'الأزرق').replace(/اسرائيل/g, 'الأزرق');

        const newMsg = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          username: persona.username,
          message: aiText.slice(0, 500),
          timestamp: Date.now(),
          reactions: {},
          isAI: true,
          persona: persona.persona,
        };
        msgs.push(newMsg);
        console.log(`[intelligence] AI chat (${persona.persona}): "${aiText.slice(0, 50)}..."`);
      } catch (e) {
        console.warn(`[intelligence] AI chat (${persona.persona}) failed:`, e.message);
      }
    }

    await writeChatMessages(chatContainer, msgs.slice(-MAX_CHAT_MSGS));
  } catch (e) {
    console.warn('[intelligence] AI chat messages failed:', e.message);
  }
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
    const [headlines, market, flights] = await Promise.all([
      fetchHeadlines(feeds),
      fetchMarketSnapshot(),
      fetchFlightSnapshot(),
    ]);
    if (!headlines.length) {
      context.res = { status: 400, body: JSON.stringify({ error: 'No headlines available' }) };
      return;
    }

    const limit       = requestLang === 'ar' ? 12 : 25;
    const headlineText = headlines.slice(0, limit).map((h, i) => {
      const title = requestLang === 'ar' ? h.replace(/^\[[^\]]+\]\s*/, '') : h;
      return `${i + 1}. ${title}`;
    }).join('\n');

    const contextBlock = buildMarketFlightContext(market, flights);
    const userMessage  = `Analyze these live news headlines and return the JSON assessment:\n\n${headlineText}${contextBlock}`;

    // Attach raw market/flight snapshot to result for client rendering
    const snapshot = { market, flights };

    const client = new AzureOpenAI({ endpoint: ENDPOINT, apiKey: API_KEY, deployment: DEPLOYMENT, apiVersion: API_VERSION });
    const response = await client.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ],
      max_completion_tokens: 2000,
    });

    const choice  = response.choices?.[0];
    const content = choice?.message?.content || choice?.message?.refusal || '{}';
    const result  = extractJSON(content);
    result._generatedAt = Date.now();
    result._snapshot    = snapshot;   // attach live market/flight data to the report

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

      // Post AI chat message alongside Arabic report generation
      if (requestLang === 'ar') {
        postAiChatMessage(headlines).catch(() => {});
      }
    }

    context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) };

  } catch (err) {
    console.error('[intelligence]', err);
    context.res = { status: 500, body: JSON.stringify({ error: 'Intelligence analysis failed', detail: err.message }) };
  }
};


