import { defineConfig, loadEnv } from 'vite';

// ── Presence Plugin — dev mirror of /api/presence Azure Function ──────────────
function presencePlugin() {
  const STALE_MS = 90_000;
  const sessions = new Map();
  function cleanStale() {
    const now = Date.now();
    for (const [id, ts] of sessions) if (now - ts > STALE_MS) sessions.delete(id);
  }
  function liveCount() { cleanStale(); return Math.max(1, sessions.size); }

  return {
    name: 'presence',
    configureServer(server) {
      server.middlewares.use('/api/presence', (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const sid = url.searchParams.get('sid');
        const send = (obj) => {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(obj));
        };
        if (req.method === 'POST') {
          if (sid) sessions.set(sid, Date.now());
          send({ count: liveCount() });
        } else if (req.method === 'DELETE') {
          if (sid) sessions.delete(sid);
          send({ count: liveCount() });
        } else {
          send({ count: liveCount() });
        }
      });
    },
  };
}

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
  const ENDPOINT    = 'https://aoai-inuvrovqthoi4.cognitiveservices.azure.com/';
  const MODEL_NAME  = 'gpt-5-mini';
  const DEPLOYMENT  = 'gpt-5-mini';

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
  // OAuth token cache (valid 24h, reuse across requests)

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

  const TOP_STOCKS = [
    { symbol: 'AAPL',  name: 'Apple' },
    { symbol: 'MSFT',  name: 'Microsoft' },
    { symbol: 'NVDA',  name: 'Nvidia' },
    { symbol: 'AMZN',  name: 'Amazon' },
    { symbol: 'GOOGL', name: 'Google' },
    { symbol: 'META',  name: 'Meta' },
    { symbol: 'TSLA',  name: 'Tesla' },
    { symbol: 'AVGO',  name: 'Broadcom' },
    { symbol: 'JPM',   name: 'JPMorgan' },
    { symbol: 'V',     name: 'Visa' },
  ];

  async function buildStats() {
    const [oil, gold, brent, natgas, acled, ...stockPrices] = await Promise.all([
      fetchYahooFinance('CL=F'),
      fetchYahooFinance('GC=F'),
      fetchYahooFinance('BZ=F'),
      fetchYahooFinance('NG=F'),
      fetchACLED(),
      ...TOP_STOCKS.map(s => fetchYahooFinance(s.symbol)),
    ]);
    const stocks = TOP_STOCKS.map((s, i) => ({
      symbol: s.symbol,
      name:   s.name,
      ...stockPrices[i],
    })).filter(s => s.price != null);
    return {
      ts: new Date().toISOString(),
      prices: { oil, gold, brent, natgas },
      conflicts: acled,
      stocks,
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


// ---------------------------------------------------------------------------
// Flights Plugin — dev-only mirror of /api/flights Azure Function
// ---------------------------------------------------------------------------
function flightsPlugin(env = {}) {
  console.log('[flights] Plugin initialized. Client ID present:', !!(env.OPENSKY_CLIENT_ID || process.env.OPENSKY_CLIENT_ID));
  const _ME_COUNTRIES = [
    { flag: '🇸🇦', ar: 'السعودية',        bbox: [16.0, 32.2, 34.5, 55.7] },
    { flag: '🇦🇪', ar: 'الإمارات',         bbox: [22.5, 26.2, 51.0, 56.5] },
    { flag: '🇰🇼', ar: 'الكويت',            bbox: [28.3, 30.2, 46.3, 48.7] },
    { flag: '🇶🇦', ar: 'قطر',              bbox: [24.4, 26.4, 50.5, 51.8] },
    { flag: '🇧🇭', ar: 'البحرين',           bbox: [25.5, 26.5, 50.2, 50.8] },
    { flag: '🇴🇲', ar: 'عُمان',             bbox: [16.5, 26.5, 51.5, 60.0] },
    { flag: '🇾🇪', ar: 'اليمن',             bbox: [12.0, 19.0, 42.0, 54.0] },
    { flag: '🇮🇶', ar: 'العراق',            bbox: [29.0, 38.0, 38.5, 49.0] },
    { flag: '🇮🇷', ar: 'إيران',             bbox: [25.0, 40.0, 44.0, 64.0] },
    { flag: '🇸🇾', ar: 'سوريا',             bbox: [32.2, 37.5, 35.5, 42.5] },
    { flag: '🇱🇧', ar: 'لبنان',             bbox: [33.0, 34.7, 35.0, 36.7] },
    { flag: '🇯🇴', ar: 'الأردن',            bbox: [29.0, 33.5, 34.5, 39.5] },
    { flag: '🇵🇸', ar: 'فلسطين',           bbox: [29.5, 33.5, 34.2, 35.9] },
    { flag: '🇪🇬', ar: 'مصر',              bbox: [22.0, 31.7, 24.5, 37.3] },
    { flag: '🇹🇷', ar: 'تركيا',            bbox: [35.5, 42.2, 26.0, 45.0] },
    { flag: '🇮🇱', ar: 'إسرائيل',          bbox: [29.5, 33.5, 34.2, 35.9] },
    { flag: '🇸🇩', ar: 'السودان',           bbox: [8.5,  22.2, 23.5, 38.7] },
    { flag: '🇱🇾', ar: 'ليبيا',            bbox: [19.5, 33.3, 9.0,  25.5] },
    { flag: '🇵🇰', ar: 'باكستان',           bbox: [23.5, 37.5, 60.5, 77.5] },
    { flag: '🇦🇫', ar: 'أفغانستان',         bbox: [29.0, 38.5, 60.5, 75.0] },
  ];

  // In-memory cache for flight data to avoid OpenSky 429 errors
  // Cache for 5 minutes to stay within OpenSky's anonymous rate limits (~400 req/day)
  let _cache = null;
  let _cacheTime = 0;
  const CACHE_TTL = 300 * 1000; 

  // OAuth2 Token handling
  let _token = null;
  let _tokenExpiry = 0;

  async function getOpenSkyToken() {
    if (_token && Date.now() < _tokenExpiry) return _token;
    
    // Prefer OAuth2 (Client Creds)
    const clientId = env.OPENSKY_CLIENT_ID || process.env.OPENSKY_CLIENT_ID;
    const clientSecret = env.OPENSKY_CLIENT_SECRET || process.env.OPENSKY_CLIENT_SECRET;

    if (clientId && clientSecret) {
      try {
        console.log(`[flights] Attempting OAuth2 with Client ID: ${clientId.substring(0,5)}...`);
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', clientId);
        params.append('client_secret', clientSecret);

        // Corrected URL based on official docs (added /auth/ path)
        const resp = await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params
        });

        if (!resp.ok) {
           const errText = await resp.text();
           console.warn('[flights] OAuth2 token fetch failed:', resp.status, errText);
           return null;
        }

        const data = await resp.json();
        _token = data.access_token;
        // Buffer expiry by 60s
        _tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;
        return _token;
      } catch (e) {
        console.warn('[flights] OAuth2 Exception:', e.message);
        return null; 
      }
    }
    return null;
  }

  async function fetchFlightRadar24() {
    // FlightRadar24 unofficial API (bounds=maxY,minY,minX,maxX)
    // 8-42 Lat, 9-77 Lon -> 42,8,9,77
    try {
      const resp = await fetch('https://data-live.flightradar24.com/zones/fcgi/feed.js?bounds=42,8,9,77&faa=1&satellite=1&mlat=1&flarm=1&adsb=1&gnd=0&air=1&vehicles=0&estimated=1&maxage=14400&gliders=0&stats=1', {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Referer': 'https://www.flightradar24.com/',
        },
        signal: AbortSignal.timeout(10000)
      });
      if (!resp.ok) throw new Error(`FR24 HTTP ${resp.status}`);
      const json = await resp.json();
      
      // FR24 returns object with IDs as keys. Values are arrays.
      // Array indices: 1: lat, 2: lon, 3: track, 4: alt (ft), 5: speed (kts)
      const flights = Object.values(json).filter(val => Array.isArray(val));
      
      // Map to OpenSky format for compatibility
      // OpenSky: 5: lon, 6: lat, 7: alt(m), 9: vel(m/s)
      return {
        states: flights.map(f => {
          const s = [];
          s[5] = f[2]; // lon
          s[6] = f[1]; // lat
          s[7] = f[4] * 0.3048; // ft -> m
          s[9] = f[5] * 0.514444; // kts -> m/s
          return s;
        })
      };
    } catch (e) {
      console.warn('[flights] FR24 fetch failed:', e.message);
      return null;
    }
  }

  async function fetchOpenSky() {
    // Determine TTL based on available credentials
    // Auth: 600s (10 min) per user request
    const hasCreds = !!(env.OPENSKY_CLIENT_ID || (env.OPENSKY_USERNAME && env.OPENSKY_PASSWORD));
    const currentTTL = 600 * 1000; // 10 minutes for all

    // Serve from cache if fresh
    if (_cache && (Date.now() - _cacheTime < currentTTL)) {
       return _cache;
    }

    try {
      const headers = { 'User-Agent': 'Mozilla/5.0' };
      
      const token = await getOpenSkyToken();
      if (token) {
        console.log('[flights] Using OAuth2 Token');
        headers['Authorization'] = `Bearer ${token}`;
      } else if (env.OPENSKY_USERNAME && env.OPENSKY_PASSWORD) {
        // Basic Auth Fallback
        console.log('[flights] Using Basic Auth');
        const auth = Buffer.from(`${env.OPENSKY_USERNAME}:${env.OPENSKY_PASSWORD}`).toString('base64');
        headers['Authorization'] = `Basic ${auth}`;
      } else {
        console.log('[flights] No credentials found, using anonymous fetch');
      }

      console.log('[flights] Fetching OpenSky API...');
      const resp = await fetch('https://opensky-network.org/api/states/all?lamin=8&lamax=42&lomin=9&lomax=77', {
        headers,
        signal: AbortSignal.timeout(10000)
      });
      
      let json;
      if (resp.status === 429) {
        console.warn('[flights] OpenSky 429 Rate Limit. Trying fallback source (FlightRadar24)...');
        // Try FR24 fallback immediately
        const fr24Data = await fetchFlightRadar24();
        if (fr24Data && fr24Data.states && fr24Data.states.length > 0) {
           console.log(`[flights] Switching to FlightRadar24 data (${fr24Data.states.length} flights)`);
           json = fr24Data;
        } else {
           // Fallback to cache or mock
           console.warn('[flights] All sources failed (or returned 0). Returning mock/cache.');
           return _cache || {
             count: 120, 
             highest: 11500,
             fastest: 920,
             countries: [
               { flag: '⚠️', ar: 'Mock Data (API Error)', n: 120 }
             ]
           };
        }
      } else if (!resp.ok) {
        throw new Error(`OpenSky HTTP ${resp.status}`);
      } else {
        // Normal OpenSky success
        json = await resp.json();
      }
      
      const states = (json.states || []).filter(s => !s[8]); // exclude on-ground
      const airborne = states.filter(s => s[5] != null && s[6] != null);
      console.log(`[flights] Parsed ${airborne.length} airborne flights.`);

      let actualLat, actualLon;
      
      const countryCounts = {};
      for (const s of airborne) {
        // OpenSky index 5: lon, index 6: lat
        actualLon = s[5];
        actualLat = s[6];

        for (const c of _ME_COUNTRIES) {
          const [latMin, latMax, lonMin, lonMax] = c.bbox;
          if (actualLat >= latMin && actualLat <= latMax && actualLon >= lonMin && actualLon <= lonMax) {
            countryCounts[c.ar] = (countryCounts[c.ar] || 0) + 1;
            break;
          }
        }
      }

      const countries = _ME_COUNTRIES.map(c => ({
        flag: c.flag,
        ar:   c.ar,
        n:    countryCounts[c.ar] || 0,
      })).sort((a, b) => b.n - a.n);

      const count   = airborne.length;
      const highest = airborne.length ? Math.round(Math.max(...airborne.map(s => s[7] || 0))) : 0;
      const fastest = airborne.length ? Math.round(Math.max(...airborne.map(s => s[9] || 0)) * 3.6) : 0;

      const result = { count, highest, fastest, countries };
      
      // Update cache
      if (airborne.length > 0) {
        _cache = result;
        _cacheTime = Date.now();
      } else {
        console.warn('[flights] Got 0 flights, skipping cache update.');
      }
      
      return result;
    } catch (err) {
      console.error('[flights] Fetch failed:', err.message);
      return _cache || { 
        count: 0, 
        highest: 0, 
        fastest: 0, 
        countries: [{ flag: '❌', ar: 'خطأ في الاتصال', n: 0 }] 
      };
    }
  }

  return {
    name: 'flights',
    configureServer(server) {
      server.middlewares.use('/api/flights', async (req, res) => {
        try {
          const data = await fetchOpenSky();
          if (!data) {
             res.writeHead(500, { 'Content-Type': 'application/json' });
             res.end(JSON.stringify({ error: 'Failed to fetch flight data' }));
             return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Tweets Plugin — dev-only mirror of /api/tweets Azure Function
// Uses official gov/org RSS feeds (Nitter is globally dead as of 2026)
// Each source is linked to the corresponding X.com profile handle
// ---------------------------------------------------------------------------
function tweetsPlugin() {
  // Official RSS sources grouped by country, linked to X handles
  const SOURCES = [
    // 🇺🇸 US Government & Policy
    { handle: 'WhiteHouse',    label: 'White House',   flag: '🇺🇸', group: 'us',     rss: 'https://www.cbsnews.com/latest/rss/politics' },
    { handle: 'StateDept',     label: 'US Policy',     flag: '🇺🇸', group: 'us',     rss: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { handle: 'DeptofDefense', label: 'AP US',         flag: '🇺🇸', group: 'us',     rss: 'https://feeds.apnews.com/rss/apf-intlnews' },
    // 🇮🇱 Israel
    { handle: 'netanyahu',     label: 'Israel PM',     flag: '🇮🇱', group: 'israel', rss: 'https://www.timesofisrael.com/feed/' },
    { handle: 'IDF',           label: 'IDF / JPost',   flag: '🇮🇱', group: 'israel', rss: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx' },
    // 🇮🇷 Iran
    { handle: 'khamenei_ir',   label: 'Khamenei',      flag: '🇮🇷', group: 'iran',   rss: 'https://english.khamenei.ir/rss/' },
    { handle: 'IranMFA_Media', label: 'Iran Analysis', flag: '🇮🇷', group: 'iran',   rss: 'https://www.al-monitor.com/rss' },
    { handle: 'PressTV',       label: 'PressTV',       flag: '🇮🇷', group: 'iran',   rss: 'https://www.presstv.ir/RSS' },
  ];

  function decodeEntities(str) {
    return str
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
      .replace(/&#\d+;/g, '');
  }

  function parseRssItems(xml, maxItems = 3) {
    const items = [];
    const parts = xml.split(/<item[\s>]/i);
    parts.shift();
    for (const part of parts) {
      if (items.length >= maxItems) break;
      const titleMatch = part.match(/<title[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/i);
      const linkMatch  = part.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
      const dateMatch  = part.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
      if (titleMatch) {
        const title = decodeEntities(titleMatch[1].replace(/<[^>]+>/g, '').trim());
        if (title.length > 5) {
          items.push({
            title: title.length > 200 ? title.slice(0, 197) + '…' : title,
            link:  linkMatch ? linkMatch[1].trim() : '',
            date:  dateMatch ? new Date(dateMatch[1].trim()).getTime() : Date.now(),
          });
        }
      }
    }
    return items;
  }

  async function fetchSourceItems(src) {
    try {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), 12000);
      const resp = await fetch(src.rss, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml,application/xml,text/xml' },
        signal: ctrl.signal,
      });
      clearTimeout(id);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const xml = await resp.text();
      const parsed = parseRssItems(xml);
      console.log(`[tweets] ${src.handle} → ${parsed.length} items`);
      return parsed;
    } catch (e) {
      console.warn(`[tweets] ${src.handle} failed: ${e.message}`);
      return [];
    }
  }

  let tweetsCache = null;
  let tweetsCacheTime = 0;
  const CACHE_TTL = 5 * 60 * 1000; // 5 min

  return {
    name: 'tweets',
    configureServer(server) {
      server.middlewares.use('/api/tweets', async (req, res) => {
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
        try {
          const now = Date.now();
          if (!tweetsCache || now - tweetsCacheTime > CACHE_TTL) {
            const results = await Promise.allSettled(
              SOURCES.map(async (src) => {
                const items = await fetchSourceItems(src);
                return { ...src, items };
              })
            );
            tweetsCache = results
              .filter(r => r.status === 'fulfilled' && r.value.items.length > 0)
              .map(r => r.value);
            tweetsCacheTime = now;
            console.log(`[tweets] Cache updated: ${tweetsCache.length}/${SOURCES.length} sources`);
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=180' });
          res.end(JSON.stringify(tweetsCache || []));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load environment variables for the current mode
  const env = loadEnv(mode, process.cwd(), '');
  return {
    root: '.',
    plugins: [presencePlugin(), resolveChannelPlugin(), intelligencePlugin(), statsPlugin(), flightsPlugin(env), tweetsPlugin()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      port: 3000,
      open: true,
    },
  };
});
