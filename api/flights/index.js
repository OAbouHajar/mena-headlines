// api/flights/index.js — exact mirror of dev vite proxy (uses global fetch, Node 18+)
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

let _token = null;
let _tokenExpiry = 0;

async function getOpenSkyToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const clientId     = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const params = new URLSearchParams();
  params.append('grant_type',    'client_credentials');
  params.append('client_id',     clientId);
  params.append('client_secret', clientSecret);

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
    const errText = await resp.text();
    throw new Error(`OAuth2 ${resp.status}: ${errText}`);
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
  if (!resp.ok) throw new Error(`FR24 HTTP ${resp.status}`);
  const json = await resp.json();
  const flights = Object.values(json).filter(val => Array.isArray(val));
  return {
    states: flights.map(f => {
      const s = [];
      s[5] = f[2];              // lon
      s[6] = f[1];              // lat
      s[7] = (f[4] || 0) * 0.3048;   // ft → m
      s[9] = (f[5] || 0) * 0.514444; // kts → m/s
      s[8] = false;
      return s;
    })
  };
}

async function fetchOpenSky(context) {
  const headers = { 'User-Agent': 'Mozilla/5.0' };

  // 1. OAuth2 (preferred)
  try {
    const token = await getOpenSkyToken();
    if (token) {
      context.log('[flights] using OAuth2');
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch (e) {
    context.log.warn('[flights] OAuth2 failed: ' + e.message);
  }

  // 2. Basic Auth fallback if no OAuth2 token
  if (!headers['Authorization']) {
    const u = process.env.OPENSKY_USERNAME;
    const p = process.env.OPENSKY_PASSWORD;
    if (u && p) {
      context.log('[flights] using Basic Auth');
      headers['Authorization'] = 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
    } else {
      context.log('[flights] anonymous request');
    }
  }

  const resp = await fetch(
    'https://opensky-network.org/api/states/all?lamin=8&lamax=42&lomin=9&lomax=77',
    { headers, signal: AbortSignal.timeout(10000) }
  );

  // 3. FR24 fallback only on rate-limit (429)
  if (resp.status === 429) {
    context.log.warn('[flights] OpenSky 429 — trying FR24');
    return await fetchFlightRadar24();
  }

  if (!resp.ok) throw new Error(`OpenSky HTTP ${resp.status}`);
  return await resp.json();
}

module.exports = async function (context, req) {
  try {
    let json;
    try {
      json = await fetchOpenSky(context);
    } catch (e) {
      context.log.error('[flights] fetchOpenSky error: ' + e.message);
      context.res = {
        status: 500,
        body: JSON.stringify({ error: 'Failed to fetch flight data', details: e.message }),
        headers: { 'Content-Type': 'application/json' },
      };
      return;
    }

    const states  = (json.states || []).filter(s => !s[8]);
    const airborne = states.filter(s => s[5] != null && s[6] != null);
    context.log(`[flights] airborne: ${airborne.length}`);

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
    context.log.error('[flights] unhandled: ' + err.message);
    context.res = {
      status: 500,
      body: JSON.stringify({ error: 'Failed to fetch flight data', details: err.message }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
};

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

// Module-level token cache (persists across warm invocations)
let _token = null;
let _tokenExpiry = 0;

async function getOpenSkyToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const clientId     = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const params = new URLSearchParams();
  params.append('grant_type',    'client_credentials');
  params.append('client_id',     clientId);
  params.append('client_secret', clientSecret);

  const body = await httpsPost(
    'auth.opensky-network.org',
    '/auth/realms/opensky-network/protocol/openid-connect/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    params.toString()
  );
  const data = JSON.parse(body);
  if (!data.access_token) throw new Error('No access_token in OAuth2 response');
  _token = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;
  return _token;
}

async function fetchFlightRadar24() {
  const body = await httpGet(
    'data-live.flightradar24.com',
    '/zones/fcgi/feed.js?bounds=42,8,9,77&faa=1&satellite=1&mlat=1&flarm=1&adsb=1&gnd=0&air=1&vehicles=0&estimated=1&maxage=14400&gliders=0&stats=1',
    {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Referer':    'https://www.flightradar24.com/',
    }
  );
  const json = JSON.parse(body);
  // FR24 values: [icao, lat(1), lon(2), track, alt_ft(4), spd_kts(5), ...]
  const flights = Object.values(json).filter(v => Array.isArray(v) && typeof v[1] === 'number');
  return {
    states: flights.map(f => {
      const s = [];
      s[5] = f[2];               // lon
      s[6] = f[1];               // lat
      s[7] = (f[4] || 0) * 0.3048;    // ft → m
      s[9] = (f[5] || 0) * 0.514444;  // kts → m/s
      s[8] = false;              // airborne
      return s;
    })
  };
}

module.exports = async function (context, req) {
  try {
    const reqHeaders = { 'User-Agent': 'Mozilla/5.0' };

    // 1. Try OAuth2
    try {
      const token = await getOpenSkyToken();
      if (token) {
        reqHeaders['Authorization'] = 'Bearer ' + token;
        context.log('[flights] using OAuth2');
      }
    } catch (e) {
      context.log.warn('[flights] OAuth2 failed: ' + e.message);
    }

    // 2. Fall back to Basic Auth if no OAuth2 token
    if (!reqHeaders['Authorization']) {
      const u = process.env.OPENSKY_USERNAME;
      const p = process.env.OPENSKY_PASSWORD;
      if (u && p) {
        reqHeaders['Authorization'] = 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
        context.log('[flights] using Basic Auth');
      } else {
        context.log('[flights] no credentials, anonymous request');
      }
    }

    let json = null;

    try {
      const raw = await httpGet(
        'opensky-network.org',
        '/api/states/all?lamin=8&lamax=42&lomin=9&lomax=77',
        reqHeaders
      );
      json = JSON.parse(raw);
      context.log('[flights] OpenSky OK, states: ' + (json.states ? json.states.length : 0));
    } catch (e) {
      context.log.warn('[flights] OpenSky failed (' + e.message + ') — trying FR24');
    }

    // 3. FR24 fallback on any OpenSky failure or empty result
    if (!json || !Array.isArray(json.states) || json.states.length === 0) {
      try {
        json = await fetchFlightRadar24();
        context.log('[flights] FR24 OK, states: ' + (json.states ? json.states.length : 0));
      } catch (e) {
        context.log.error('[flights] FR24 also failed: ' + e.message);
      }
    }

    if (!json || !Array.isArray(json.states) || json.states.length === 0) {
      context.res = {
        status: 200,
        body: JSON.stringify({ count: 0, countries: [] }),
        headers: { 'Content-Type': 'application/json' },
      };
      return;
    }

    // Filter airborne with valid coords
    const airborne = json.states.filter(s => !s[8] && s[5] != null && s[6] != null);

    // Bin into countries
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
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=300',
      },
    };

  } catch (err) {
    context.log.error('[flights] Unhandled: ' + err.message);
    context.res = {
      status: 500,
      body: JSON.stringify({ error: 'Failed to fetch flight data', details: err.message }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
};

function httpGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'GET', headers, timeout: 12000 }, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' from ' + hostname));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout: ' + hostname)); });
    req.end();
  });
}

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, timeout: 10000 },
      res => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode + ' from ' + hostname));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString()));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout: ' + hostname)); });
    req.write(body);
    req.end();
  });
}

const REGIONS = [
  { code: 'SA', flag: '🇸🇦', ar: 'السعودية', bbox: [16.0, 32.2, 34.5, 55.7] },
  { code: 'AE', flag: '🇦🇪', ar: 'الإمارات',  bbox: [22.5, 26.2, 51.0, 56.5] },
  { code: 'KW', flag: '🇰🇼', ar: 'الكويت',    bbox: [28.3, 30.2, 46.3, 48.7] },
  { code: 'QA', flag: '🇶🇦', ar: 'قطر',       bbox: [24.4, 26.4, 50.5, 51.8] },
  { code: 'BH', flag: '🇧🇭', ar: 'البحرين',   bbox: [25.5, 26.5, 50.2, 50.8] },
  { code: 'OM', flag: '🇴🇲', ar: 'عُمان',     bbox: [16.5, 26.5, 51.5, 60.0] },
  { code: 'YE', flag: '🇾🇪', ar: 'اليمن',     bbox: [12.0, 19.0, 42.0, 54.0] },
  { code: 'IQ', flag: '🇮🇶', ar: 'العراق',    bbox: [29.0, 38.0, 38.5, 49.0] },
  { code: 'IR', flag: '🇮🇷', ar: 'إيران',     bbox: [25.0, 40.0, 44.0, 64.0] },
  { code: 'SY', flag: '🇸🇾', ar: 'سوريا',     bbox: [32.2, 37.5, 35.5, 42.5] },
  { code: 'LB', flag: '🇱🇧', ar: 'لبنان',     bbox: [33.0, 34.7, 35.0, 36.7] },
  { code: 'JO', flag: '🇯🇴', ar: 'الأردن',    bbox: [29.0, 33.5, 34.5, 39.5] },
  { code: 'PS', flag: '🇵🇸', ar: 'فلسطين',    bbox: [29.5, 33.5, 34.2, 35.9] },
  { code: 'EG', flag: '🇪🇬', ar: 'مصر',       bbox: [22.0, 31.7, 24.5, 37.3] },
  { code: 'TR', flag: '🇹🇷', ar: 'تركيا',     bbox: [35.5, 42.2, 26.0, 45.0] },
  { code: 'SD', flag: '🇸🇩', ar: 'السودان',   bbox: [8.5,  22.2, 23.5, 38.7] },
  { code: 'LY', flag: '🇱🇾', ar: 'ليبيا',     bbox: [19.5, 33.3,  9.0, 25.5] },
];

module.exports = async function (context, req) {
  try {
    let points = null;
    let source = 'none';

    // ── 1. Try OpenSky ──────────────────────────────────────────────────────
    try {
      const username = process.env.OPENSKY_USERNAME;
      const password = process.env.OPENSKY_PASSWORD;
      const hdrs = { 'User-Agent': 'Mozilla/5.0' };
      if (username && password) {
        hdrs['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
      }
      const raw = await httpGet(
        'https://opensky-network.org/api/states/all?lamin=8&lomin=9&lamax=42&lomax=77',
        hdrs
      );
      const json = JSON.parse(raw);
      if (json && Array.isArray(json.states) && json.states.length > 0) {
        // state vector: [icao24, callsign, origin, t_pos, last_contact, lon(5), lat(6), baro_alt(7), on_ground(8), vel(9), ...]
        points = json.states
          .filter(s => !s[8] && s[5] != null && s[6] != null)
          .map(s => ({ lon: s[5], lat: s[6] }));
        source = 'opensky';
      }
    } catch (e) {
      context.log.warn('[flights] OpenSky failed (' + e.message + ') — trying FR24 fallback');
    }

    // ── 2. Fallback: FlightRadar24 (no credentials required) ────────────────
    if (!points || points.length === 0) {
      try {
        const raw = await httpGet(
          'https://data-live.flightradar24.com/zones/fcgi/feed.js?bounds=42,8,9,77&faa=1&satellite=1&mlat=1&flarm=1&adsb=1&gnd=0&air=1&vehicles=0&estimated=1&maxage=14400&gliders=0&stats=1',
          {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Referer': 'https://www.flightradar24.com/',
            'Accept': 'application/json',
          }
        );
        const json = JSON.parse(raw);
        // FR24 values are arrays: [icao, lat, lon, hdg, alt_ft, spd_kts, ...]
        points = Object.values(json)
          .filter(v => Array.isArray(v) && v.length > 2 && typeof v[1] === 'number' && typeof v[2] === 'number')
          .map(v => ({ lat: v[1], lon: v[2] }));
        source = 'fr24';
      } catch (e) {
        context.log.error('[flights] FR24 fallback failed: ' + e.message);
      }
    }

    context.log('[flights] source=' + source + ' points=' + (points ? points.length : 0));

    if (!points || points.length === 0) {
      context.res = {
        status: 200,
        body: JSON.stringify({ count: 0, countries: [] }),
        headers: { 'Content-Type': 'application/json' },
      };
      return;
    }

    // ── 3. Bin into countries ────────────────────────────────────────────────
    const counts = {};
    REGIONS.forEach(r => { counts[r.code] = 0; });

    for (const { lat, lon } of points) {
      for (const r of REGIONS) {
        if (lat >= r.bbox[0] && lat <= r.bbox[1] && lon >= r.bbox[2] && lon <= r.bbox[3]) {
          counts[r.code]++;
          break;
        }
      }
    }

    const countries = REGIONS
      .map(r => ({ flag: r.flag, ar: r.ar, n: counts[r.code] }))
      .sort((a, b) => b.n - a.n);

    context.res = {
      status: 200,
      body: JSON.stringify({ count: points.length, countries }),
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=120',
      },
    };

  } catch (err) {
    context.log.error('[flights] Unhandled error: ' + err.message);
    context.res = {
      status: 500,
      body: JSON.stringify({ error: 'Failed to fetch flight data', details: err.message }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
};

// Promisified HTTPS GET with 12s timeout
function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: 12000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error('Status Code: ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}
