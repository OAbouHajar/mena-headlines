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

// ---------------------------------------------------------------------------
// Stats Plugin — dev-only mirror of /api/stats Azure Function
// ---------------------------------------------------------------------------
function statsPlugin() {
  let statsCache = null;
  let statsCacheTime = 0;
  const STATS_CACHE_TTL = 10 * 60 * 1000;

  function fetchWithTimeout(url, opts = {}, ms = 10000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id));
  }

  async function fetchYahooFinance(symbol) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
      const resp = await fetchWithTimeout(url, { headers: { 'User-Agent': 'yt-multi-player/1.0' } });
      const json = await resp.json();
      const result = json?.chart?.result?.[0];
      if (!result) return null;
      const meta = result.meta;
      const price = meta.regularMarketPrice;
      const prev = meta.previousClose ?? meta.chartPreviousClose;
      const change = price - prev;
      const changePct = (change / prev) * 100;
      return {
        price: +price.toFixed(2),
        change: +change.toFixed(2),
        changePct: +changePct.toFixed(2),
        currency: meta.currency,
      };
    } catch { return null; }
  }

  // GDELT DOC API v2 — free, no auth, real-time conflict/war news
  async function fetchConflictNews() {
    try {
      const query = encodeURIComponent(
        'war OR "armed conflict" OR airstrike OR offensive OR ceasefire OR "military operation" OR shelling OR siege'
      );
      const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&format=json&maxrecords=20&timespan=48h`;
      const resp = await fetchWithTimeout(url, { headers: { 'User-Agent': 'yt-multi-player/1.0' } });
      const json = await resp.json();
      const articles = json?.articles ?? [];
      return articles.map((a) => {
        const title = (a.title || '').toLowerCase();
        let level;
        if (/kill|dead|death|airstrike|bomb|missile|massacre|execut|shoot/i.test(title)) level = 'red';
        else if (/fight|clash|offensive|shelling|troops|casual|soldier|battle|assault|siege/i.test(title)) level = 'orange';
        else level = 'green';
        const rawDate = a.seendate || '';
        const pubDate = rawDate
          ? new Date(rawDate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')).toUTCString()
          : '';
        return {
          title: a.title || '',
          link: a.url || '',
          pubDate,
          level,
          country: a.sourcecountry || '',
          eventType: '',
          severity: '',
          domain: a.domain || '',
          lat: null,
          lon: null,
        };
      });
    } catch { return []; }
  }

  // OAuth token cache (valid 24h, reuse across requests)
  let acledToken = null;
  let acledTokenExpiry = 0;

  async function getACLEDToken() {
    if (acledToken && Date.now() < acledTokenExpiry) return acledToken;
    const email    = process.env.ACLED_EMAIL;
    const password = process.env.ACLED_PASSWORD;
    if (!email || !password || email === 'your@email.com') return null;
    const body = new URLSearchParams({
      username: email, password, grant_type: 'password', client_id: 'acled',
    });
    const resp = await fetchWithTimeout('https://acleddata.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }, 8000);
    if (!resp.ok) throw new Error(`ACLED token error ${resp.status}`);
    const json = await resp.json();
    acledToken = json.access_token;
    acledTokenExpiry = Date.now() + (json.expires_in - 300) * 1000; // 5-min buffer
    return acledToken;
  }

  async function fetchACLED() {
    try {
      const token = await getACLEDToken();
      if (!token) return { available: false, events: 0, fatalities: 0 };
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const sinceStr = since.toISOString().slice(0, 10);
      const todayStr = new Date().toISOString().slice(0, 10);
      const url = `https://acleddata.com/api/acled/read?_format=json&event_date=${sinceStr}|${todayStr}&event_date_where=BETWEEN&fields=fatalities&limit=500`;
      const resp = await fetchWithTimeout(url, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      }, 15000);
      const json = await resp.json();
      const rows = json?.data ?? [];
      const fatalities = rows.reduce((sum, d) => sum + (parseInt(d.fatalities) || 0), 0);
      const count = json?.count ?? rows.length;
      return { available: true, events: Number(count), fatalities };
    } catch (e) {
      console.warn('[stats] ACLED fetch failed:', e.message);
      return { available: false, events: 0, fatalities: 0 };
    }
  }

  async function buildStats() {
    const [oil, gold, brent, natgas, alerts, acled] = await Promise.all([
      fetchYahooFinance('CL=F'),
      fetchYahooFinance('GC=F'),
      fetchYahooFinance('BZ=F'),
      fetchYahooFinance('NG=F'),
      fetchConflictNews(),
      fetchACLED(),
    ]);
    return {
      ts: new Date().toISOString(),
      prices: { oil, gold, brent, natgas },
      alerts,
      conflicts: acled,
    };
  }

  return {
    name: 'stats',
    configureServer(server) {
      server.middlewares.use('/api/stats', async (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405); res.end(); return;
        }
        try {
          const now = Date.now();
          if (!statsCache || now - statsCacheTime > STATS_CACHE_TTL) {
            statsCache = await buildStats();
            statsCacheTime = now;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(statsCache));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

export default defineConfig({
  root: '.',
  plugins: [resolveChannelPlugin(), intelligencePlugin(), statsPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    open: true,
  },
});
