// api/flights/index.js
// Strategy: Try OpenSky (with Basic Auth if env vars set), fall back to FlightRadar24 (no auth needed)
const https = require('https');

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
