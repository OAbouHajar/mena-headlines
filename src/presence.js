/**
 * Presence tracking — in-memory counter via Azure Function /api/presence.
 * Each session sends a POST heartbeat every 30 s.
 * Geo lookup is done CLIENT-SIDE (browser → ipwho.is) to avoid Azure
 * datacenter IP blocks on free geo APIs.
 */

const HEARTBEAT_MS = 30_000;  // POST to keep session alive
const POLL_MS      = 10_000;  // GET to refresh count shown in badge

let _sessionId = null;
let _heartbeatTimer = null;
let _pollTimer      = null;
let _geo = null; // { city, country, code } resolved once per session

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/** Resolve this browser's own location. Cached in sessionStorage. */
async function selfGeo() {
  const cached = sessionStorage.getItem('_presence_geo');
  if (cached) { try { return JSON.parse(cached); } catch {} }

  async function tryFetch(url, mapFn) {
    try {
      const ac  = new AbortController();
      const tid = setTimeout(() => ac.abort(), 5000);
      const r   = await fetch(url, { signal: ac.signal });
      clearTimeout(tid);
      if (!r.ok) return null;
      const d = await r.json();
      return mapFn(d);
    } catch { return null; }
  }

  const geo =
    await tryFetch('https://ipwho.is/',
      d => d.success && d.city ? { city: d.city, country: d.country, code: d.country_code } : null) ||
    await tryFetch('https://ip-api.com/json/?fields=status,country,countryCode,city',
      d => d.status === 'success' && d.city ? { city: d.city, country: d.country, code: d.countryCode } : null) ||
    await tryFetch('https://freeipapi.com/api/json',
      d => d.cityName && d.cityName !== '-' ? { city: d.cityName, country: d.countryName, code: d.countryCode } : null);

  if (geo) sessionStorage.setItem('_presence_geo', JSON.stringify(geo));
  return geo || null;
}

async function apiPost(sid, geo) {
  try {
    const geoQ = geo
      ? `&city=${encodeURIComponent(geo.city || '')}&country=${encodeURIComponent(geo.country || '')}&code=${encodeURIComponent(geo.code || '')}`
      : '';
    const r = await fetch(`/api/presence?sid=${sid}${geoQ}`, { method: 'POST' });
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

  // Resolve geo first (client-side, browser → ipwho.is — avoids datacenter IP blocks)
  // Must be awaited so the first heartbeat carries geo params
  _geo = await selfGeo();

  // Register this session and get initial count + locations
  const initial = await apiPost(_sessionId, _geo);
  notify(initial ?? { count: 1, locations: [] });

  // Keep session alive
  _heartbeatTimer = setInterval(async () => {
    notify(await apiPost(_sessionId, _geo));
  }, HEARTBEAT_MS);

  // Poll for count updates (other users joining/leaving)
  _pollTimer = setInterval(async () => {
    notify(await apiGet());
  }, POLL_MS);

  // Refresh when tab becomes visible after being hidden
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      notify(await apiPost(_sessionId, _geo));
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
