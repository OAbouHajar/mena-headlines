/**
 * Azure Static Web Apps API function.
 * POST /api/intelligence
 * Fetches RSS headlines server-side, calls Azure OpenAI, returns structured JSON.
 */

import { AzureOpenAI } from 'openai';

const API_KEY     = 'REDACTED_AZURE_OPENAI_KEY';
const API_VERSION = '2024-12-01-preview';
const ENDPOINT    = 'https://***REMOVED***/';
const MODEL_NAME  = '***REMOVED***';
const DEPLOYMENT  = '***REMOVED***';

const RSS_FEEDS = [
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { name: 'BBC News',   url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { name: 'Sky News',   url: 'https://feeds.skynews.com/feeds/rss/world.rss' },
];

const SYSTEM_PROMPT = `You are a professional global intelligence analyst. Synthesize the provided live headlines into a concise structured assessment.

Rules:
- Write like a seasoned human analyst
- Be neutral, factual, precise
- No emotional language, dramatic phrasing, or speculation without basis
- No political bias
- Keep each section tight

Return ONLY a raw JSON object (no markdown fences) with exactly these keys:
{
  "situation_overview": "2-4 sentence neutral analytical summary",
  "why_it_matters": "1-2 sentence impact analysis",
  "key_dynamics": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "risk_level": "Low" or "Moderate" or "Elevated" or "High",
  "short_term_outlook": "1-2 sentence near-term projection",
  "confidence_level": "High" or "Moderate" or "Low"
}`;

function extractTitles(xml) {
  const titles = [];
  const re = /<item[\s\S]*?<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/gi;
  let match;
  while ((match = re.exec(xml)) !== null) {
    const t = match[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').trim();
    if (t && t.length > 10) titles.push(t);
  }
  return titles.slice(0, 10);
}

async function fetchHeadlines() {
  const all = [];
  await Promise.all(
    RSS_FEEDS.map(async (feed) => {
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
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return JSON.parse(fenced[1].trim());
  return JSON.parse(text.trim());
}

export default async function (context, req) {
  if (req.method !== 'POST') {
    context.res = { status: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    return;
  }

  try {
    const headlines = await fetchHeadlines();

    if (!headlines.length) {
      context.res = { status: 400, body: JSON.stringify({ error: 'No headlines available' }) };
      return;
    }

    const headlineText = headlines.slice(0, 25).map((h, i) => `${i + 1}. ${h}`).join('\n');

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
      max_completion_tokens: 800,
    });

    const content = response.choices?.[0]?.message?.content || '{}';
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
