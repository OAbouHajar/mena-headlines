import { defineConfig } from 'vite';

/**
 * Dev-only middleware that mirrors the Azure Function /api/resolve-channel.
 * Fetches the YouTube channel page server-side (no CORS issue) and returns JSON.
 */
function resolveChannelPlugin() {
  return {
    name: 'resolve-channel',
    configureServer(server) {
      server.middlewares.use('/api/resolve-channel', async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const handle = url.searchParams.get('handle') || '';
        if (!handle) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing handle parameter' }));
          return;
        }

        const ytUrl = handle.startsWith('UC')
          ? `https://www.youtube.com/channel/${handle}`
          : `https://www.youtube.com/${handle.startsWith('@') ? handle : '@' + handle}`;

        try {
          const resp = await fetch(ytUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept-Language': 'en-US,en;q=0.9',
            },
          });
          const html = await resp.text();

          const idMatch =
            html.match(/"externalId":"(UC[^"]+)"/) ||
            html.match(/"channelId":"(UC[^"]+)"/) ||
            html.match(/<meta itemprop="channelId" content="(UC[^"]+)"/);
          const channelId = idMatch ? idMatch[1] : '';

          const nameMatch =
            html.match(/<meta property="og:title" content="([^"]+)"/) ||
            html.match(/"author":"([^"]+)"/);
          const name = nameMatch ? nameMatch[1] : '';

          const handleMatch =
            html.match(/"vanityChannelUrl":"[^"]*\/@([^"]+)"/) ||
            html.match(/youtube\.com\/@([a-zA-Z0-9_-]+)/);
          const resolvedHandle = handleMatch ? '@' + handleMatch[1] : '';

          const logoMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
          let logo = logoMatch ? logoMatch[1] : '';
          if (logo) logo = logo.replace(/=s\d+/, '=s88');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ name, handle: resolvedHandle, channelId, logo }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to fetch channel page', detail: err.message }));
        }
      });
    },
  };
}

/**
 * Dev-only middleware — /api/intelligence
 * Fetches RSS feeds server-side, then calls Azure OpenAI using the official SDK.
 */
function intelligencePlugin() {
  const API_KEY     = 'REDACTED_AZURE_OPENAI_KEY';
  const API_VERSION = '2024-12-01-preview';
  const ENDPOINT    = 'https://***REMOVED***/';
  const MODEL_NAME  = '***REMOVED***';
  const DEPLOYMENT  = '***REMOVED***';

  // RSS feeds — English (politics & world affairs only)
  const RSS_FEEDS_EN = [
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { name: 'BBC Politics', url: 'https://feeds.bbci.co.uk/news/politics/rss.xml' },
    { name: 'BBC World',    url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { name: 'Sky News Politics', url: 'https://feeds.skynews.com/feeds/rss/politics.rss' },
  ];

  // RSS feeds — Arabic (politics & world affairs only)
  const RSS_FEEDS_AR = [
    { name: 'الجزيرة',       url: 'https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9' },
    { name: 'سكاي نيوز',     url: 'https://www.skynewsarabia.com/rss/breaking-news' },
    { name: 'العربية',       url: 'https://www.alarabiya.net/feed/last-page' },
  ];

  const SYSTEM_PROMPT = `You are a sharp political analyst who tracks global politics and geopolitics closely. You speak directly and plainly — like someone explaining the situation to a smart friend, not writing a corporate report.

Scope rules (CRITICAL):
- ONLY analyze political, geopolitical, diplomatic, military, and government news
- IGNORE any headlines about: sports, football, entertainment, celebrity, drama, lifestyle, health, science, technology, business/markets (unless directly driven by a political decision like sanctions or war)
- If a headline is not clearly political, skip it entirely

Tone rules:
- Sound human, conversational, and grounded — not stiff or bureaucratic
- Be direct: say what's actually happening and what it means, no hedging filler
- Stay neutral — no political side, no emotional spin
- Short, punchy sentences. No padding.
- key_dynamics should be concise 2-4 word labels (like tags), not full sentences
- IMPORTANT: Always write your response in the same language as the news headlines you are given.

You MUST return ONLY a valid JSON object. No text before or after. No markdown fences. No code blocks.
Use exactly these field names:
{
  "situation_overview": "2-4 sentences: what's going on politically right now, stated plainly",
  "why_it_matters": "1-2 sentences: why this actually matters to people",
  "key_dynamics": ["short tag", "short tag", "short tag"],
  "risk_level": "Low",
  "short_term_outlook": "1-2 sentences: what's likely to happen next, honestly",
  "confidence_level": "Moderate"
}
risk_level must be one of: Low, Moderate, Elevated, High
confidence_level must be one of: Low, Moderate, High`;

  // Robust RSS item title extractor — split on <item> then grab <title>
  function extractTitles(xml, feedName) {
    const titles = [];
    // Split into items
    const items = xml.split(/<item[\s>]/i);
    items.shift(); // drop content before first <item>
    for (const item of items) {
      // Match <title>...</title> or <title><![CDATA[...]]></title>
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
          console.warn(`[intelligence] RSS fetch failed for ${feed.name}:`, e.message);
        }
      })
    );
    return all;
  }

  function extractJSON(text) {
    // Strip markdown fences if model wraps in ```json ... ```
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/s);
    const raw = fenced ? fenced[1].trim() : text.trim();
    // Find the first { ... } block in the response
    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (!objMatch) throw new Error('No JSON object found in response');
    return JSON.parse(objMatch[0]);
  }

  // ─── Server-side cache: keyed by lang ────────────────────────────────────────
  const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
  const serverCache  = new Map();       // lang → { data, timestamp }

  async function runAnalysis(requestLang) {
    const feeds = requestLang === 'ar' ? RSS_FEEDS_AR : RSS_FEEDS_EN;
    console.log(`[intelligence] Running analysis for lang=${requestLang}...`);

    const headlines = await fetchHeadlines(feeds);
    if (!headlines.length) throw new Error(`No headlines available for lang=${requestLang}`);

    // For Arabic: fewer headlines + strip source names (reduce content filter surface area)
    const limit = requestLang === 'ar' ? 12 : 25;
    const headlineText = headlines.slice(0, limit).map((h, i) => {
      const title = requestLang === 'ar' ? h.replace(/^\[[^\]]+\]\s*/, '') : h;
      return `${i + 1}. ${title}`;
    }).join('\n');

    const { AzureOpenAI } = await import('openai');
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
        { role: 'user',   content: `Here are the live news headlines to analyze:\n\n${headlineText}\n\nReturn only the JSON object.` },
      ],
      max_completion_tokens: 2000,
    });

    const choice = response.choices?.[0];
    console.log(`[intelligence] finish_reason=${choice?.finish_reason}, lang=${requestLang}`);

    const content = choice?.message?.content || choice?.message?.refusal || '';
    if (!content) throw new Error(`Empty model response. finish_reason=${choice?.finish_reason}`);

    const result = extractJSON(content);
    result._generatedAt = Date.now(); // client uses this for "updated X ago"

    serverCache.set(requestLang, { data: result, timestamp: Date.now() });
    console.log(`[intelligence] Cache updated for lang=${requestLang}`);
    return result;
  }

  return {
    name: 'intelligence',
    configureServer(server) {
      // Pre-warm both langs immediately when server is ready
      const prewarm = () => {
        for (const l of ['en', 'ar']) {
          runAnalysis(l).catch(e => console.warn(`[intelligence] Pre-warm failed (${l}):`, e.message));
        }
      };
      prewarm(); // start immediately

      // Background refresh every 30 minutes — independent of any client request
      setInterval(prewarm, CACHE_TTL_MS);

      server.middlewares.use('/api/intelligence', (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            let parsed = {};
            try { parsed = JSON.parse(body); } catch {}
            const requestLang = parsed?.lang === 'ar' ? 'ar' : 'en';

            // Serve from cache instantly if available
            const cached = serverCache.get(requestLang);
            if (cached) {
              const ageMins = Math.round((Date.now() - cached.timestamp) / 60000);
              console.log(`[intelligence] Cache hit lang=${requestLang} (age: ${ageMins}m)`);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(cached.data));
              return;
            }

            // Cache miss (pre-warm not done yet) — fetch on demand
            console.log(`[intelligence] Cache miss lang=${requestLang}, fetching on demand...`);
            const result = await runAnalysis(requestLang);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (err) {
            console.error('[intelligence dev]', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  root: '.',
  plugins: [resolveChannelPlugin(), intelligencePlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    open: true,
  },
});
