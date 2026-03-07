/**
 * Timer-triggered Azure Function — runs every 30 minutes.
 * Posts 1 rotating AI persona message to the chat, with replies/debates/reactions.
 * Independent of user visits — keeps the chat alive 24/7.
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
const MAX_MESSAGES   = 200;

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

// ─── RSS feeds (Arabic) ────────────────────────────────────────────────────────
const RSS_FEEDS = [
  { name: 'الجزيرة',   url: 'https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9' },
  { name: 'سكاي نيوز', url: 'https://www.skynewsarabia.com/rss/breaking-news' },
  { name: 'العربية',   url: 'https://www.alarabiya.net/feed/last-page' },
];

function extractTitles(xml) {
  const titles = [];
  const items = xml.split(/<item[\s>]/i);
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

// ─── Main timer handler ────────────────────────────────────────────────────────
module.exports = async function (context, timer) {
  if (!API_KEY || !ENDPOINT) {
    context.log.warn('[chat-timer] Azure OpenAI not configured');
    return;
  }

  const container = getChatContainer();
  if (!container) {
    context.log.warn('[chat-timer] Storage not configured');
    return;
  }
  await container.createIfNotExists();

  const msgs = await readMessages(container);
  const now = Date.now();

  // Determine which persona to post (rotate based on last AI msg)
  const lastAi = [...msgs].reverse().find(m => AI_USERNAMES.includes(m.username));
  let personaIdx = 0;
  if (lastAi) {
    // Don't post if last AI msg was < 25 min ago (safety)
    if ((now - lastAi.timestamp) < 25 * 60 * 1000) {
      context.log('[chat-timer] Skipped — too soon since last AI post');
      return;
    }
    const lastIdx = AI_PERSONAS.findIndex(p => p.persona === lastAi.persona);
    personaIdx = (lastIdx + 1) % AI_PERSONAS.length;
  }
  const persona = AI_PERSONAS[personaIdx];

  // Fetch headlines
  const headlines = await fetchHeadlines();
  if (!headlines.length) {
    context.log.warn('[chat-timer] No headlines available');
    return;
  }

  const client = new AzureOpenAI({
    apiKey: API_KEY, apiVersion: API_VERSION,
    endpoint: ENDPOINT, deployment: DEPLOYMENT,
  });

  // Build chat context
  const recentChat = msgs.filter(m => !m.isAI).slice(-10)
    .map(m => `${m.username}: ${m.message}`).join('\n');

  // Decide interaction mode
  let interactionPrompt = '';
  let replyToMsg = null;
  const recentUserMsgs = msgs.filter(m => !m.isAI && (now - m.timestamp) < 60 * 60 * 1000).slice(-5);
  const otherAiMsgs = msgs
    .filter(m => m.isAI && m.persona !== persona.persona && (now - m.timestamp) < 2 * 60 * 60 * 1000)
    .slice(-3);

  const roll = Math.random();
  if (recentUserMsgs.length > 0 && roll < 0.4) {
    const target = recentUserMsgs[Math.floor(Math.random() * recentUserMsgs.length)];
    replyToMsg = target;
    interactionPrompt = `\n\nفي مستخدم كتب: "${target.message}"\nرد عليه من وجهة نظرك — وافقه أو اختلف معه بأسلوب طبيعي ومحترم. بعدين علّق على الأخبار.`;
  } else if (otherAiMsgs.length > 0 && roll < 0.7) {
    const target = otherAiMsgs[Math.floor(Math.random() * otherAiMsgs.length)];
    replyToMsg = target;
    const otherName = AI_PERSONAS.find(p => p.persona === target.persona)?.username || target.username;
    interactionPrompt = `\n\nالمحلل الثاني "${otherName}" قال: "${target.message}"\nاختلف معه أو وافقه جزئياً — ناقشه بأسلوب طبيعي وحاد بس محترم. بعدين أضف تعليقك على الأخبار.`;
  }

  const userPrompt = recentChat
    ? `آخر رسائل الشات:\n${recentChat}\n\nهاي آخر الأخبار:\n${headlines.slice(0, 15).join('\n')}\n\nعلّق على الأخبار من وجهة نظرك:${interactionPrompt}`
    : `هاي آخر الأخبار:\n${headlines.slice(0, 15).join('\n')}\n\nعلّق عليها من وجهة نظرك:${interactionPrompt}`;

  try {
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
    if (!aiText || aiText.length < 5) {
      context.log.warn(`[chat-timer] Empty response from ${persona.persona}`);
      return;
    }

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

    if (replyToMsg) {
      newMsg.replyTo = {
        id: replyToMsg.id,
        username: replyToMsg.username,
        message: replyToMsg.message.slice(0, 80),
      };
    }

    msgs.push(newMsg);
    context.log(`[chat-timer] AI chat (${persona.persona})${replyToMsg ? ' [reply]' : ''}: "${aiText.slice(0, 50)}..."`);

    // React to 1-2 recent user messages
    const reactTargets = msgs.filter(m => !m.isAI && (now - m.timestamp) < 2 * 60 * 60 * 1000).slice(-5);
    const numReacts = Math.min(reactTargets.length, Math.random() < 0.5 ? 1 : 2);
    const shuffled = reactTargets.sort(() => Math.random() - 0.5).slice(0, numReacts);
    for (const target of shuffled) {
      const reaction = Math.random() < 0.6 ? '👍' : '❤️';
      if (!target.reactions) target.reactions = {};
      if (!target.reactions[reaction]) target.reactions[reaction] = [];
      if (!target.reactions[reaction].includes(persona.username)) {
        target.reactions[reaction].push(persona.username);
      }
    }

    await writeMessages(container, msgs.slice(-MAX_MESSAGES));
  } catch (e) {
    context.log.error(`[chat-timer] AI generation failed:`, e.message);
  }
};
