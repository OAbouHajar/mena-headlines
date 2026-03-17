// api/presence/index.js — in-memory session counter with geo location
// Sessions older than STALE_MS are automatically excluded.
// NOTE: counter resets on cold start (instance recycle after inactivity).

const STALE_MS = 90_000; // 90 seconds

// Map of sessionId -> { lastSeen, city, country, code }
const sessions = new Map();
// Map of ip -> { city, country, code } — cache geo lookups to avoid redundant calls
const ipCache  = new Map();

function countryFlag(code) {
  if (!code || code.length !== 2) return '🌐';
  return [...code.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('');
}

function cleanStale() {
  const now = Date.now();
  for (const [id, d] of sessions) {
    if (now - d.lastSeen > STALE_MS) sessions.delete(id);
  }
}

function liveCount() {
  cleanStale();
  return Math.max(1, sessions.size);
}

function buildLocations() {
  cleanStale();
  const groups = new Map();
  for (const { city, country, code } of sessions.values()) {
    const key = `${code || '??'}:${city || 'Unknown'}`;
    if (!groups.has(key)) groups.set(key, { flag: countryFlag(code), city: city || 'Unknown', country: country || 'Unknown', count: 0 });
    groups.get(key).count++;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

async function geoLookup(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return { city: 'Local', country: 'Local', code: null };
  }
  if (ipCache.has(ip)) return ipCache.get(ip);
  try {
    const r = await fetch(`http://ip-api.com/json/${ip}?fields=country,countryCode,city`);
    if (!r.ok) throw new Error('geo fail');
    const d = await r.json();
    const geo = { city: d.city || 'Unknown', country: d.country || 'Unknown', code: d.countryCode || null };
    ipCache.set(ip, geo);
    return geo;
  } catch {
    return { city: 'Unknown', country: 'Unknown', code: null };
  }
}

module.exports = async function (context, req) {
  const sid = req.query.sid;
  const json = (obj) => ({
    status: 200,
    body: JSON.stringify(obj),
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

  if (req.method === 'POST') {
    // Heartbeat — register or refresh this session with geo location
    if (sid) {
      const rawIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '127.0.0.1';
      const geo   = await geoLookup(rawIp);
      sessions.set(sid, { lastSeen: Date.now(), ...geo });
    }
    context.res = json({ count: liveCount(), locations: buildLocations() });

  } else if (req.method === 'DELETE') {
    // Tab closed — remove session immediately
    if (sid) sessions.delete(sid);
    context.res = json({ count: liveCount(), locations: buildLocations() });

  } else {
    // GET — return current count + locations (no sid needed)
    context.res = json({ count: liveCount(), locations: buildLocations() });
  }
};
