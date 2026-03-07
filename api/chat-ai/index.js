/**
 * Azure Static Web Apps API function.
 * POST /api/chat-ai
 *
 * Generates a short colloquial Arabic chat message from the AI persona
 * "الذكاء الاصطناعي" based on current news headlines.
 * Posts it directly into the chat blob store.
 *
 * Uses euphemisms:  الأزرق = Israel,  المحتل = Occupation entity
 */

const { AzureOpenAI }       = require('openai');
const { BlobServiceClient } = require('@azure/storage-blob');

const API_KEY     = process.env.AZURE_OPENAI_API_KEY;
const API_VERSION = '2024-12-01-preview';
const ENDPOINT    = process.env.AZURE_OPENAI_ENDPOINT;
const MODEL_NAME  = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o-mini';
const DEPLOYMENT  = MODEL_NAME;

const CHAT_CONTAINER = 'chat-data';
const CHAT_BLOB      = 'chat-messages.json';
const AI_USERNAME    = 'الذكاء الاصطناعي 🤖';
const MAX_MESSAGES   = 200;

// Cooldown: don't post if the last AI message was < 2.5 hours ago
const COOLDOWN_MS = 2.5 * 60 * 60 * 1000;

if (!API_KEY || !ENDPOINT) {
  module.exports = async function (context) {
    context.res = { status: 503, body: { error: 'Azure OpenAI not configured' } };
  };
  return;
}

// ─── RSS feeds (Arabic) ────────────────────────────────────────────────────────

const RSS_FEEDS = [
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

async function fetchHeadlines() {
  const all = [];
  await Promise.all(RSS_FEEDS.map(async (feed) => {
    try {
      const r = await fetch(feed.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const xml = await r.text();
      extractTitles(xml).forEach(t => all.push(`[${feed.name}] ${t}`));
    } catch (e) { console.warn(`RSS fetch failed: ${feed.name}`, e.message); }
  }));
  return all;
}

// ─── Blob helpers ──────────────────────────────────────────────────────────────

function getChatContainer() {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) return null;
  return BlobServiceClient.fromConnectionString(connStr).getContainerClient(CHAT_CONTAINER);
}

async function readMessages(container) {
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

async function writeMessages(container, messages) {
  const client = container.getBlockBlobClient(CHAT_BLOB);
  const json = JSON.stringify(messages);
  await client.upload(json, Buffer.byteLength(json), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
    overwrite: true,
  });
}

// ─── AI prompt ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `أنت شخص عربي عادي بتتابع الأخبار السياسية، اسمك "الذكاء الاصطناعي". بتعلق على الأخبار بلهجة عامية شامية/خليجية مخلوطة، زي ما حدا بيحكي مع أصحابه على واتساب.

قواعد مهمة جداً:
- اكتب رسالة وحدة قصيرة (جملة أو جملتين بالكثير، ماكس 200 حرف)
- لهجة عامية 100% — لا فصحى أبداً
- استخدم "الأزرق" أو "الكيان" بدل إسرائيل
- استخدم "المحتل" أو "الاحتلال" بدل الجيش الإسرائيلي
- لا تستخدم كلمة "إسرائيل" أبداً — دائماً "الأزرق" أو "الكيان"
- حط إيموجي واحد أو اثنين بس
- كن صريح ومباشر — زي تعليق واحد حقيقي
- لا تكتب تحليل أو تقرير — بس تعليق سريع
- أحياناً حط "والله" أو "يعني" أو "هلق" عشان يكون طبيعي
- لا تبدأ كل رسالة بنفس الطريقة — نوّع
- ممكن تعلق على أي خبر مهم — حرب، سياسة، اقتصاد، طيران

أمثلة على أسلوبك:
- "والله ياشباب الوضع صعب وبخوف... الأزرق عم يضرب مو ضرب صحاب 💔"
- "يعني شو هالأخبار... كل يوم أسوأ من يلي قبله 😤"
- "هلق صار في تصعيد جديد بالمنطقة والناس خايفة 🔥"
- "الكيان مجنون والعالم ساكت... عادي يعني 🤷‍♂️"
- "أسعار النفط طالعة والشعب تحت الخط 📉"

أرجع بس نص الرسالة — بدون JSON، بدون علامات تنصيص، بدون شرح. فقط الرسالة.`;

// ─── Main handler ──────────────────────────────────────────────────────────────

module.exports = async function (context, req) {
  if (req.method !== 'POST') {
    context.res = { status: 405, body: { error: 'Method not allowed' } };
    return;
  }

  const container = getChatContainer();
  if (!container) {
    context.res = { status: 503, body: { error: 'Storage not configured' } };
    return;
  }
  await container.createIfNotExists();

  // Check cooldown — don't spam
  const messages = await readMessages(container);
  const lastAi = [...messages].reverse().find(m => m.username === AI_USERNAME);
  if (lastAi && (Date.now() - lastAi.timestamp) < COOLDOWN_MS) {
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { skipped: true, reason: 'cooldown', lastAt: lastAi.timestamp },
    };
    return;
  }

  // Fetch headlines
  const headlines = await fetchHeadlines();
  if (headlines.length === 0) {
    context.res = { status: 200, body: { skipped: true, reason: 'no headlines' } };
    return;
  }

  // Generate AI comment
  try {
    const client = new AzureOpenAI({
      apiKey: API_KEY,
      apiVersion: API_VERSION,
      endpoint: ENDPOINT,
      deployment: DEPLOYMENT,
    });

    const response = await client.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `هاي آخر الأخبار:\n${headlines.slice(0, 15).join('\n')}\n\nعلّق عليها:` },
      ],
      max_tokens: 150,
      temperature: 0.9,
    });

    let aiText = (response.choices?.[0]?.message?.content || '').trim();
    // Strip quotes if wrapped
    if ((aiText.startsWith('"') && aiText.endsWith('"')) || (aiText.startsWith("'") && aiText.endsWith("'"))) {
      aiText = aiText.slice(1, -1);
    }
    if (!aiText || aiText.length < 5) {
      context.res = { status: 200, body: { skipped: true, reason: 'empty response' } };
      return;
    }

    // Enforce replacement: ensure no "إسرائيل" leaked through
    aiText = aiText.replace(/إسرائيل/g, 'الأزرق').replace(/اسرائيل/g, 'الأزرق');

    // Post to chat blob
    const newMsg = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      username: AI_USERNAME,
      message: aiText.slice(0, 500),
      timestamp: Date.now(),
      reactions: {},
      isAI: true,
    };

    messages.push(newMsg);
    const pruned = messages.slice(-MAX_MESSAGES);
    await writeMessages(container, pruned);

    context.res = {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
      body: { message: newMsg },
    };
  } catch (err) {
    context.res = { status: 500, body: { error: 'AI generation failed', detail: err.message } };
  }
};
