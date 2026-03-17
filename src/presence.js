/**
 * Presence tracking — in-memory counter via Azure Function /api/presence.
 * Each session sends a POST heartbeat every 30 s.
 * The server counts sessions active within the last 90 s and returns the total.
 * No external database required.
 */

const HEARTBEAT_MS = 30_000;  // POST to keep session alive
const POLL_MS      = 10_000;  // GET to refresh count shown in badge

let _sessionId     = null;
let _heartbeatTimer = null;
let _pollTimer      = null;

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

async function apiPost(sid) {
  try {
    const r = await fetch(`/api/presence?sid=${sid}`, { method: 'POST' });
    if (!r.ok) return null;
    return await r.json(); // { count, locations }
  } catch { return null; }
}

async function apiDelete(sid) {
  try {
    await fetch(`/api/presence?sid=${sid}`, { method: 'DELETE', keepalive: true });
  } catch { /* best-effort */ }
}

async function apiGet() {
  try {
    const r = await fetch('/api/presence');
    if (!r.ok) return null;
    return await r.json(); // { count, locations }
  } catch { return null; }
}

/**
 * Start presence tracking.
 * @param {(count: number, locations: Array) => void} onCountChange  Called whenever count/locations change.
 * @returns {() => void}  Cleanup function.
 */
export async function initPresence(onCountChange) {
  const notify = (data) => {
    if (data != null && typeof onCountChange === 'function') {
      onCountChange(data.count ?? 1, data.locations ?? []);
    }
  };

  _sessionId = generateId();

  // Register this session and get initial count + locations
  const initial = await apiPost(_sessionId);
  notify(initial ?? { count: 1, locations: [] });

  // Keep session alive
  _heartbeatTimer = setInterval(async () => {
    notify(await apiPost(_sessionId));
  }, HEARTBEAT_MS);

  // Poll for count updates (other users joining/leaving)
  _pollTimer = setInterval(async () => {
    notify(await apiGet());
  }, POLL_MS);

  // Refresh when tab becomes visible after being hidden
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      notify(await apiPost(_sessionId));
    }
  });

  // Remove session on tab close
  window.addEventListener('beforeunload', () => apiDelete(_sessionId));

  return () => {
    clearInterval(_heartbeatTimer);
    clearInterval(_pollTimer);
    apiDelete(_sessionId);
  };
}
