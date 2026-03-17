// api/presence/index.js — in-memory session counter
// Geo location is resolved CLIENT-SIDE and sent as query params on each POST.
// Sessions older than STALE_MS are automatically excluded.
// NOTE: counter resets on cold start (instance recycle after inactivity).

const STALE_MS = 90_000; // 90 seconds

// Map of sessionId -> { lastSeen, city, country, code }
const sessions = new Map();

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
    const key = code ? `${code}:${city}` : '??:?';
    if (!groups.has(key)) groups.set(key, { flag: countryFlag(code), city: city || null, country: country || null, code: code || null, count: 0 });
    groups.get(key).count++;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

module.exports = async function (context, req) {
  const sid = req.query.sid;
  const json = (obj) => ({
    status: 200,
    body: JSON.stringify(obj),
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

  if (req.method === 'POST') {
    if (sid) {
      // Geo sent by the client (browser resolved its own IP via ipwho.is)
      const city    = req.query.city    || null;
      const country = req.query.country || null;
      const code    = req.query.code    || null;
      sessions.set(sid, { lastSeen: Date.now(), city, country, code });
    }
    context.res = json({ count: liveCount(), locations: buildLocations() });

  } else if (req.method === 'DELETE') {
    if (sid) sessions.delete(sid);
    context.res = json({ count: liveCount(), locations: buildLocations() });

  } else {
    // GET — return current count + locations
    context.res = json({ count: liveCount(), locations: buildLocations() });
  }
};
