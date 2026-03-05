// api/presence/index.js — in-memory session counter
// Sessions older than STALE_MS are automatically excluded.
// NOTE: counter resets on cold start (instance recycle after inactivity).

const STALE_MS = 90_000; // 90 seconds

// Map of sessionId -> lastSeen (Date.now())
const sessions = new Map();

function cleanStale() {
  const now = Date.now();
  for (const [id, ts] of sessions) {
    if (now - ts > STALE_MS) sessions.delete(id);
  }
}

function liveCount() {
  cleanStale();
  return Math.max(1, sessions.size);
}

module.exports = async function (context, req) {
  const sid = req.query.sid;
  const json = (obj) => ({
    status: 200,
    body: JSON.stringify(obj),
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

  if (req.method === 'POST') {
    // Heartbeat — register or refresh this session
    if (sid) sessions.set(sid, Date.now());
    context.res = json({ count: liveCount() });

  } else if (req.method === 'DELETE') {
    // Tab closed — remove session immediately
    if (sid) sessions.delete(sid);
    context.res = json({ count: liveCount() });

  } else {
    // GET — return current count (no sid needed)
    context.res = json({ count: liveCount() });
  }
};
