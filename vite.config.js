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

  // RSS feeds — English
  const RSS_FEEDS_EN = [
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { name: 'BBC News',   url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { name: 'Sky News',   url: 'https://feeds.skynews.com/feeds/rss/world.rss' },
  ];

  // RSS feeds — Arabic
  const RSS_FEEDS_AR = [
    { name: 'الجزيرة',       url: 'https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9' },
    { name: 'سكاي نيوز',     url: 'https://www.skynewsarabia.com/rss/breaking-news' },
    { name: 'العربية',       url: 'https://www.alarabiya.net/feed/last-page' },
  ];

  const SYSTEM_PROMPT = `You are a professional global intelligence analyst. Synthesize the provided live headlines into a concise structured assessment.

Rules:
- Write like a seasoned human analyst
- Be neutral, factual, precise
- No emotional language or speculation without basis
- No political bias

You MUST return ONLY a valid JSON object. No text before or after. No markdown fences. No code blocks.
Use exactly these field names:
{
  "situation_overview": "2-4 sentence neutral analytical summary",
  "why_it_matters": "1-2 sentence impact analysis",
  "key_dynamics": ["tag1", "tag2", "tag3"],
  "risk_level": "Low",
  "short_term_outlook": "1-2 sentence near-term projection",
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

  return {
    name: 'intelligence',
    configureServer(server) {
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
            const feeds = requestLang === 'ar' ? RSS_FEEDS_AR : RSS_FEEDS_EN;
            console.log(`[intelligence] lang=${requestLang}, using ${feeds.length} feeds`);

            // Fetch fresh headlines server-side from RSS
            let headlines = await fetchHeadlines(feeds);
            console.log(`[intelligence] RSS fetched ${headlines.length} headlines`);
            if (headlines.length > 0) {
              console.log('[intelligence] Sample:', headlines[0]);
            }

            // Fallback: use client-sent headlines if RSS failed
            if (!headlines.length) {
              headlines = parsed?.headlines || [];
            }

            if (!headlines.length) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'No headlines available' }));
              return;
            }

            const headlineText = headlines.slice(0, 25).map((h, i) => `${i + 1}. ${h}`).join('\n');

            const { AzureOpenAI } = await import('openai');
            const client = new AzureOpenAI({
              endpoint:   ENDPOINT,
              apiKey:     API_KEY,
              deployment: DEPLOYMENT,
              apiVersion: API_VERSION,
            });

            const langNote = requestLang === 'ar'
              ? '\n\nIMPORTANT: Write the values of situation_overview, why_it_matters, key_dynamics, and short_term_outlook in Arabic. Keep all JSON keys in English.'
              : '';

            const response = await client.chat.completions.create({
              model: MODEL_NAME,
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user',   content: `Here are the live news headlines to analyze:\n\n${headlineText}\n\nReturn only the JSON object.${langNote}` },
              ],
              max_completion_tokens: 1200,
            });

            const choice = response.choices?.[0];
            console.log('[intelligence] finish_reason:', choice?.finish_reason);
            console.log('[intelligence] message keys:', Object.keys(choice?.message || {}));
            console.log('[intelligence] refusal:', choice?.message?.refusal);

            // content can be null when the model refuses or a content filter fires
            const content = choice?.message?.content || choice?.message?.refusal || '';
            console.log('[intelligence] Raw AI response:', content.slice(0, 500));

            if (!content) {
              throw new Error(`Empty response from model. finish_reason=${choice?.finish_reason}`);
            }

            const result = extractJSON(content);
            console.log('[intelligence] Parsed keys:', Object.keys(result));

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
