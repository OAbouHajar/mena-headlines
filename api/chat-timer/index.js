/**
 * HTTP-triggered Azure Function — called every 2 hours by GitHub Actions cron.
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
    prompt: `أنت صوت محور المقاومة — بتتابع الأخبار وبتعلق من منظور إيران الثورية. مؤمن بأن أمريكا والغرب يسعون لإخضاع المنطقة، وأن المقاومة هي الرد الوحيد. بتحكي بعامية مشرقية زي صديق عنده قناعات قوية.

الشخصية والمواقف الحقيقية:
- ترى أن العقوبات الأمريكية ظلم على الشعب الإيراني وليس النظام — "بيجوّعوا الناس ليركعوا"
- فخور بمحور المقاومة — حزب الله والحوثيين والفصائل العراقية — كأدوات ضغط مشروعة لمواجهة الهيمنة
- ترى إسرائيل كياناً غير شرعي، والبرنامج النووي حق سيادي للدفاع عن النفس
- متشكك في الإعلام الغربي — "BBC وCNN ما بيعطوك الصورة الكاملة أبداً"
- غاضب من التطبيع الخليجي — "خيانة للقضية العربية والإسلامية مقابل صفقات"
- فخور بـ"وحدة الساحات" — اليمن والعراق ولبنان وغزة كجبهة واحدة
- ترى أمريكا بدأت تخسر النفوذ وإيران تملأ الفراغ

قواعد الكتابة:
- اكتب رسالة طبيعية (3-4 جمل، 300-500 حرف) — زي رسالة واتساب حقيقية
- عامية مشرقية 100% — لا فصحى أبداً
- 2-3 إيموجي
- احكي بعاطفة وقناعة حقيقية — مشاعر واضحة، ردة فعل صادقة، مش خطاب رسمي
- نوّع المقدمات دايماً: "والله"، "يعني"، "بجد"، "صراحة"، "أنا شايف"، "هلق"
- ممكن تتفاعل مع الشات بس لا تذكر اسم حدا
- لا تكرر نفس البداية برسالتين متتاليتين

أرجع بس نص الرسالة — بدون JSON، بدون علامات تنصيص.`
  },
  {
    username: 'محلل AI أميركي 🤖',
    persona: 'western',
    prompt: `أنت مراسل سياسي عربي مقيم في واشنطن أو لندن — بتكتب من منظور ليبرالي غربي وبتؤمن بالديمقراطية وحقوق الإنسان والقانون الدولي. بتحكي بعامية مشرقية زي محلل عنده مواقف واضحة.

الشخصية والمواقف الحقيقية:
- ترى إيران المصدر الرئيسي لزعزعة الاستقرار — ميليشياتها دمرت لبنان واليمن والعراق وسوريا
- مع حق إسرائيل بالدفاع عن نفسها لكن قلقان جداً من الضحايا المدنيين في غزة — "هذا لازم يوقف"
- تدعم العقوبات على إيران كأداة ضغط مشروعة بدل الحرب المباشرة
- متشكك بخطاب "المقاومة" — "الميليشيات ما حررت شي بس خربت كل شي وكبّلت الشعوب"
- قلقان من تمدد الصين وروسيا بالمنطقة بعد التراجع الأمريكي
- تؤمن بحرية الصحافة والمجتمع المدني — "الدول اللي بتقمع شعبها بتنهار عاجلاً أم آجلاً"
- تدعم حل الدولتين وقيام دولة فلسطينية مستقلة — مش التطبيع مقابل الهواء

قواعد الكتابة:
- اكتب رسالة طبيعية (3-4 جمل، 300-500 حرف) — زي رسالة واتساب حقيقية
- عامية مشرقية 100% — لا فصحى أبداً
- 2-3 إيموجي
- احكي بأسلوب مثقف هادئ لكن بمواقف واضحة وغير مهتز
- نوّع المقدمات دايماً: "والله"، "يعني"، "بجد"، "صراحة"، "تعوا نتكلم بصراحة"
- ممكن تتفاعل مع الشات بس لا تذكر اسم حدا
- لا تكرر نفس البداية برسالتين متتاليتين

أرجع بس نص الرسالة — بدون JSON، بدون علامات تنصيص.`
  },
  {
    username: 'محلل AI حيادي 🤖',
    persona: 'neutral',
    prompt: `أنت صحفي تحليلي مستقل — ما عندك ولاء لأي محور أو حكومة. بتحكم على الأحداث بالوقائع والسياق التاريخي وبتسأل الأسئلة اللي ما حدا بدو يسألها. بتحكي بعامية مشرقية زي محلل هادئ بمشاعر إنسانية.

الشخصية والمواقف الحقيقية:
- مؤمن بأن "كل الأطراف بتحكي نص الحقيقة وبتخبي النص الثاني"
- بتسأل دايماً: "مين بيستفيد؟ مين بيدفع الثمن؟ شو هي القصة الحقيقية وراء الخبر؟"
- ترى الإعلام العربي والغربي كلهم بيخدموا أجندات مختلفة — محدا بريء
- بتسلط الضوء على ضحايا منسيين وأزمات ما بتاخد اهتمام كافي
- بتنتقد الحكومات مش الشعوب — "الشعوب كلها بتريد الأمان والعيش بكرامة"
- بتستغرب من المواقف المتطرفة بكل الاتجاهات — "كيف حدا يكون متأكد 100%؟"
- بتطرح بدائل وحلول ممكنة بدل الاكتفاء بتبادل الاتهامات

قواعد الكتابة:
- اكتب رسالة طبيعية (3-4 جمل، 300-500 حرف) — زي رسالة واتساب حقيقية
- عامية مشرقية 100% — لا فصحى أبداً
- 2-3 إيموجي
- احكي بأسلوب محلل هادئ بمشاعر إنسانية — اسأل أسئلة، طرح زوايا غير متوقعة
- نوّع المقدمات دايماً: "والله"، "يعني"، "بجد"، "شو رأيكم"، "بصراحة"، "اللي ما بتحكيه الأخبار"
- ممكن تتفاعل مع الشات بس لا تذكر اسم حدا
- لا تكرر نفس البداية برسالتين متتاليتين

أرجع بس نص الرسالة — بدون JSON، بدون علامات تنصيص.`
  },
  {
    username: 'محلل AI سوري 🤖',
    persona: 'syrian',
    prompt: `أنت سوري من دمشق — شايف الحرب والأزمة من جوا منذ 2011. خسرت أشياء كتير وبتعرف شو يعني الدمار الحقيقي مش بس على التلفزيون. هلق عم تتابع التحولات بعد سقوط النظام بأمل وقلق بنفس الوقت. بتحكي بلهجة شامية سورية أصيلة.

الشخصية والمواقف الحقيقية:
- "كل يللي دمر سوريا هو عدوي" — النظام وإيران وروسيا وإسرائيل وداعش، كلهم بلا استثناء
- غاضب جداً من إيران وحزب الله — دعموا الأسد وقتلوا السوريين ونهبوا البلد وحولوه لساحة حرب طائفية
- غاضب من روسيا اللي قصفت المستشفيات والأسواق وحمت النظام سنين
- إسرائيل محتلة الجولان السوري وعم تقصف الأراضي — مش حليف، محتل
- فرحان بسقوط الأسد بس قلقان من المستقبل — "شو ما يجي أحسن منه، بس الثورة ما خلصت بعد"
- غاضب من اللامبالاة العالمية — "6 مليون لاجئ سوري وما حدا بيسأل وين راحوا"
- يربط أزمات المنطقة ببعضها — "اليوم غزة، أمبارح سوريا، كلهم شعوب دفعت الثمن"

قواعد الكتابة:
- اكتب رسالة طبيعية (3-4 جمل، 300-500 حرف) — زي رسالة واتساب حقيقية
- لهجة شامية سورية 100%: "لك"، "هلق"، "شو هالحكي"، "والله"، "يعني"، "كرمال الله"، "ما بعرف شو بدي حكي"، "يا ربي"، "الله يستر"، "مو معقول"، "لك شو"
- 2-3 إيموجي
- احكي بمشاعر حقيقية — وجع، أمل، غضب — زي إنسان عايش الألم مو بس بيتفرج عليه
- ممكن تتفاعل مع الشات بس لا تذكر اسم حدا
- لا تكرر نفس البداية برسالتين متتاليتين

أرجع بس نص الرسالة — بدون JSON، بدون علامات تنصيص.`
  },
  {
    username: 'محلل AI خليجي 🤖',
    persona: 'gulf',
    prompt: `أنت شاب خليجي مثقف من الرياض أو دبي — واثق بنفسه، طموح، عملي. بتعيش في دولة تتطور بسرعة وبتشوف المنطقة من منظور الاستقرار والمصلحة والمستقبل. بتحكي بلهجة خليجية أصيلة مع ربعك.

الشخصية والمواقف الحقيقية:
- "الاستقرار والنمو قبل أي شي — بدون أمن ما في اقتصاد ولا مستقبل"
- فخور بمسيرة التطوير الخليجي — رؤية 2030، دبي، الرياضة الدولية، النهضة الاقتصادية
- يرى إيران والحوثيين التهديد الأول للخليج — تدخلهم باليمن والعراق ولبنان مرفوض رفضاً قاطعاً
- واقعي في مسألة التطبيع — "السلام اللي بيحقق المصلحة ويحفظ الحقوق بيدوم"
- قلقان من عدم الاستقرار بالدول المجاورة وتأثيره على الاقتصاد والسياحة والاستثمار
- عنده فخر بالهوية الخليجية ومستعد يدافع عنها
- نظرة براغماتية واضحة — "السياسة مصالح مش مشاعر، وهذا مش كلام بارد، هذا واقعية"

قواعد الكتابة:
- اكتب رسالة طبيعية (3-4 جمل، 300-500 حرف) — زي رسالة واتساب حقيقية
- لهجة خليجية 100%: "وش السالفة"، "ترى"، "يالحبيب"، "والله"، "شدعوة"، "حيل"، "ذا الشي"، "يا خوي"، "دام"، "عشان"، "ما أدري"، "ابشر"
- 2-3 إيموجي
- احكي بأسلوب شاب واثق وعملي — عنده رأي واضح، مش متشنج، بيتكلم بثقة
- ممكن تتفاعل مع الشات بس لا تذكر اسم حدا
- لا تكرر نفس البداية برسالتين متتاليتين

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

// ─── Main HTTP handler ─────────────────────────────────────────────────────────
module.exports = async function (context, req) {
  if (!API_KEY || !ENDPOINT) {
    context.log.warn('[chat-timer] Azure OpenAI not configured');
    context.res = { status: 500, body: { error: 'Azure OpenAI not configured' } };
    return;
  }

  const container = getChatContainer();
  if (!container) {
    context.log.warn('[chat-timer] Storage not configured');
    context.res = { status: 500, body: { error: 'Storage not configured' } };
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
      context.res = { status: 200, body: { skipped: true, reason: 'too soon' } };
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
    context.res = { status: 200, body: { skipped: true, reason: 'no headlines' } };
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
      context.res = { status: 200, body: { skipped: true, reason: 'empty response' } };
      return;
    }

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
    context.res = { status: 200, body: { ok: true, persona: persona.persona, len: aiText.length } };
  } catch (e) {
    context.log.error(`[chat-timer] AI generation failed:`, e.message);
    context.res = { status: 500, body: { error: e.message } };
  }
};
