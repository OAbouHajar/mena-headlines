/**
 * Azure Static Web Apps API function.
 * POST /api/intelligence
 * Fetches RSS headlines server-side, calls Azure OpenAI, returns structured JSON.
 */

import { AzureOpenAI } from 'openai';

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

export default async function (context, req) {
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
