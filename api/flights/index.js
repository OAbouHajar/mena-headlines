// api/flights/index.js — uses global fetch (Node 18+), credentials loaded from environment variables
const _ME_COUNTRIES = [
  { flag: '🇸🇦', ar: 'السعودية',   bbox: [16.0, 32.2, 34.5, 55.7] },
  { flag: '🇦🇪', ar: 'الإمارات',    bbox: [22.5, 26.2, 51.0, 56.5] },
  { flag: '🇰🇼', ar: 'الكويت',      bbox: [28.3, 30.2, 46.3, 48.7] },
  { flag: '🇶🇦', ar: 'قطر',         bbox: [24.4, 26.4, 50.5, 51.8] },
  { flag: '🇧🇭', ar: 'البحرين',     bbox: [25.5, 26.5, 50.2, 50.8] },
  { flag: '🇴🇲', ar: 'عُمان',       bbox: [16.5, 26.5, 51.5, 60.0] },
  { flag: '🇾🇪', ar: 'اليمن',       bbox: [12.0, 19.0, 42.0, 54.0] },
  { flag: '🇮🇶', ar: 'العراق',      bbox: [29.0, 38.0, 38.5, 49.0] },
  { flag: '🇮🇷', ar: 'إيران',       bbox: [25.0, 40.0, 44.0, 64.0] },
  { flag: '🇸🇾', ar: 'سوريا',       bbox: [32.2, 37.5, 35.5, 42.5] },
  { flag: '🇱🇧', ar: 'لبنان',       bbox: [33.0, 34.7, 35.0, 36.7] },
  { flag: '🇯🇴', ar: 'الأردن',      bbox: [29.0, 33.5, 34.5, 39.5] },
  { flag: '🇵🇸', ar: 'فلسطين',      bbox: [29.5, 33.5, 34.2, 35.9] },
  { flag: '🇪🇬', ar: 'مصر',         bbox: [22.0, 31.7, 24.5, 37.3] },
  { flag: '🇹🇷', ar: 'تركيا',       bbox: [35.5, 42.2, 26.0, 45.0] },
  { flag: '🇸🇩', ar: 'السودان',     bbox: [8.5,  22.2, 23.5, 38.7] },
  { flag: '🇱🇾', ar: 'ليبيا',       bbox: [19.5, 33.3,  9.0, 25.5] },
  { flag: '🇵🇰', ar: 'باكستان',     bbox: [23.5, 37.5, 60.5, 77.5] },
  { flag: '🇦🇫', ar: 'أفغانستان',   bbox: [29.0, 38.5, 60.5, 75.0] },
];

// Credentials — set via environment variables (see .env.example)
const CLIENT_ID     = process.env.OPENSKY_CLIENT_ID;
const CLIENT_SECRET = process.env.OPENSKY_CLIENT_SECRET;
const USERNAME      = process.env.OPENSKY_USERNAME;
const PASSWORD      = process.env.OPENSKY_PASSWORD;

let _token = null;
let _tokenExpiry = 0;

async function getOpenSkyToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const params = new URLSearchParams();
  params.append('grant_type',    'client_credentials');
  params.append('client_id',     CLIENT_ID);
  params.append('client_secret', CLIENT_SECRET);

  const resp = await fetch(
    'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params,
      signal:  AbortSignal.timeout(10000),
    }
  );

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error('OAuth2 ' + resp.status + ': ' + txt);
  }

  const data = await resp.json();
  _token       = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;
  return _token;
}

async function fetchFlightRadar24() {
  const resp = await fetch(
    'https://data-live.flightradar24.com/zones/fcgi/feed.js?bounds=42,8,9,77&faa=1&satellite=1&mlat=1&flarm=1&adsb=1&gnd=0&air=1&vehicles=0&estimated=1&maxage=14400&gliders=0&stats=1',
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer':    'https://www.flightradar24.com/',
      },
      signal: AbortSignal.timeout(10000),
    }
  );
  if (!resp.ok) throw new Error('FR24 HTTP ' + resp.status);
  const json = await resp.json();
  const flights = Object.values(json).filter(v => Array.isArray(v) && typeof v[1] === 'number');
  return {
    states: flights.map(f => {
      const s = [];
      s[5] = f[2];
      s[6] = f[1];
      s[7] = (f[4] || 0) * 0.3048;
      s[9] = (f[5] || 0) * 0.514444;
      s[8] = false;
      return s;
    })
  };
}

module.exports = async function (context, req) {
  try {
    const headers = { 'User-Agent': 'Mozilla/5.0' };

    // 1. Try OAuth2
    try {
      const token = await getOpenSkyToken();
      if (token) {
        headers['Authorization'] = 'Bearer ' + token;
        context.log('[flights] OAuth2 token obtained');
      }
    } catch (e) {
      context.log.warn('[flights] OAuth2 failed: ' + e.message);
    }

    // 2. Basic Auth fallback
    if (!headers['Authorization'] && USERNAME && PASSWORD) {
      headers['Authorization'] = 'Basic ' + Buffer.from(USERNAME + ':' + PASSWORD).toString('base64');
      context.log('[flights] using Basic Auth');
    }

    let json;
    const resp = await fetch(
      'https://opensky-network.org/api/states/all?lamin=8&lamax=42&lomin=9&lomax=77',
      { headers, signal: AbortSignal.timeout(12000) }
    );

    if (resp.status === 429) {
      // 3. FR24 only on rate-limit
      context.log.warn('[flights] OpenSky 429 — falling back to FR24');
      json = await fetchFlightRadar24();
    } else if (!resp.ok) {
      throw new Error('OpenSky HTTP ' + resp.status);
    } else {
      json = await resp.json();
    }

    const states   = (json.states || []).filter(s => !s[8]);
    const airborne = states.filter(s => s[5] != null && s[6] != null);
    context.log('[flights] airborne: ' + airborne.length);

    const countryCounts = {};
    for (const s of airborne) {
      const lon = s[5], lat = s[6];
      for (const c of _ME_COUNTRIES) {
        const [latMin, latMax, lonMin, lonMax] = c.bbox;
        if (lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax) {
          countryCounts[c.ar] = (countryCounts[c.ar] || 0) + 1;
          break;
        }
      }
    }

    const countries = _ME_COUNTRIES
      .map(c => ({ flag: c.flag, ar: c.ar, n: countryCounts[c.ar] || 0 }))
      .sort((a, b) => b.n - a.n);

    const count   = airborne.length;
    const highest = count ? Math.round(Math.max(...airborne.map(s => s[7] || 0))) : 0;
    const fastest = count ? Math.round(Math.max(...airborne.map(s => s[9] || 0)) * 3.6) : 0;

    context.res = {
      status: 200,
      body: JSON.stringify({ count, highest, fastest, countries }),
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=300' },
    };
  } catch (err) {
    context.log.error('[flights] error: ' + err.message);
    context.res = {
      status: 500,
      body: JSON.stringify({ error: 'Failed to fetch flight data', details: err.message }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
};
