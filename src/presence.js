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
    return (await r.json()).count;
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
    return (await r.json()).count;
  } catch { return null; }
}

/**
 * Start presence tracking.
 * @param {(count: number) => void} onCountChange  Called whenever count changes.
 * @returns {() => void}  Cleanup function.
 */
export async function initPresence(onCountChange) {
  const notify = (n) => { if (n != null && typeof onCountChange === 'function') onCountChange(n); };

  _sessionId = generateId();

  // Register this session and get initial count
  const initial = await apiPost(_sessionId);
  notify(initial ?? 1);

  // Keep session alive
  _heartbeatTimer = setInterval(async () => {
    const n = await apiPost(_sessionId);
    notify(n);
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
