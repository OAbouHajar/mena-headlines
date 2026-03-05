/**
 * /api/tweets — Azure Function
 * Official gov/org RSS feeds for US, Israel, Iran — linked to X.com handles.
 * (Nitter is globally blocked as of 2026; X API = $100/mo)
 */
'use strict';

const https = require('https');
const http  = require('http');

// Official gov/org RSS sources — grouped by country, linked to X handles
const SOURCES = [
  // 🇺🇸 US Government & Policy
  { handle: 'WhiteHouse',    label: 'White House',   flag: '🇺🇸', group: 'us',     rss: 'https://www.whitehouse.gov/briefing-room/statements-and-releases/feed/' },
  { handle: 'StateDept',     label: 'Politico',      flag: '🇺🇸', group: 'us',     rss: 'https://www.politico.com/rss/politicopicks.xml' },
  { handle: 'DeptofDefense', label: 'AP Politics',   flag: '🇺🇸', group: 'us',     rss: 'https://feeds.apnews.com/rss/apf-politics' },
  // 🇮🇱 Israel
  { handle: 'netanyahu',     label: 'Israel PM',     flag: '🇮🇱', group: 'israel', rss: 'https://www.timesofisrael.com/feed/' },
  { handle: 'IDF',           label: 'IDF / JPost',   flag: '🇮🇱', group: 'israel', rss: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx' },
  // 🇮🇷 Iran
  { handle: 'khamenei_ir',   label: 'Khamenei',      flag: '🇮🇷', group: 'iran',   rss: 'https://english.khamenei.ir/rss/' },
  { handle: 'IranMFA_Media', label: 'Iran Analysis', flag: '🇮🇷', group: 'iran',   rss: 'https://www.al-monitor.com/rss' },
];

let _cache     = null;
let _cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#\d+;/g, '');
}

function getUrl(urlStr, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(urlStr);
    const lib     = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      headers:  { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml,application/xml,text/xml' },
      timeout:  timeoutMs,
    };
    const req = lib.get(options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return getUrl(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    setTimeout(() => { try { req.destroy(); } catch {} reject(new Error('timeout')); }, timeoutMs);
  });
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

async function fetchSource(src) {
  try {
    const xml    = await getUrl(src.rss);
    const parsed = parseRssItems(xml);
    return parsed;
  } catch { return []; }
}

module.exports = async function (context, req) {
  try {
    const now = Date.now();
    if (!_cache || now - _cacheTime > CACHE_TTL) {
      const results = await Promise.allSettled(
        SOURCES.map(async (src) => {
          const items = await fetchSource(src);
          return { ...src, items };
        })
      );
      _cache     = results.filter(r => r.status === 'fulfilled' && r.value.items.length > 0).map(r => r.value);
      _cacheTime = now;
    }

    context.res = {
      status:  200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=180' },
      body:    JSON.stringify(_cache || []),
    };
  } catch (err) {
    context.res = {
      status: 500,
      body:   JSON.stringify({ error: err.message }),
    };
  }
};
