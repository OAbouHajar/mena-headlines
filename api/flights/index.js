// api/flights/index.js
const https = require('https');

// Key Middle East countries with approximate bounding boxes [minLat, maxLat, minLon, maxLon]
const REGIONS = [
  { code: 'SA', flag: '🇸🇦', ar: 'السعودية', bbox: [16, 32.2, 34.5, 55.7] },
  { code: 'EG', flag: '🇪🇬', ar: 'مصر', bbox: [22, 31.7, 24.7, 36.9] },
  { code: 'IQ', flag: '🇮🇶', ar: 'العراق', bbox: [29, 37.4, 38.8, 48.6] },
  { code: 'IR', flag: '🇮🇷', ar: 'إيران', bbox: [25, 39.8, 44, 63.3] },
  { code: 'TR', flag: '🇹🇷', ar: 'تركيا', bbox: [35.8, 42.1, 25.7, 44.8] },
  { code: 'AE', flag: '🇦🇪', ar: 'الإمارات', bbox: [22.6, 26.1, 51.5, 56.4] },
  { code: 'JO', flag: '🇯🇴', ar: 'الأردن', bbox: [29.2, 33.4, 34.9, 39.3] },
  { code: 'SY', flag: '🇸🇾', ar: 'سوريا', bbox: [32.3, 37.3, 35.6, 42.4] },
  { code: 'IL', flag: '🇵🇸', ar: 'فلسطين', bbox: [29.5, 33.3, 34.2, 35.9] }, // Covers IL/PS roughly
  { code: 'LB', flag: '🇱🇧', ar: 'لبنان', bbox: [33.0, 34.7, 35.1, 36.6] },
  { code: 'QA', flag: '🇶🇦', ar: 'قطر', bbox: [24.4, 26.2, 50.7, 51.7] },
  { code: 'KW', flag: '🇰🇼', ar: 'الكويت', bbox: [28.5, 30.1, 46.5, 48.5] },
  { code: 'YE', flag: '🇾🇪', ar: 'اليمن', bbox: [12.1, 19, 41.8, 54] },
  { code: 'OM', flag: '🇴🇲', ar: 'عُمان', bbox: [16.6, 26.4, 52, 59.8] },
  { code: 'SD', flag: '🇸🇩', ar: 'السودان', bbox: [8.5, 23, 21.8, 38.6] }
];

module.exports = async function (context, req) {
  // Use user-provided env vars if available (from .env or Azure settings)
  // The user provided OPENSKY_USERNAME and OPENSKY_PASSWORD.
  // If running locally with SWA CLI, .env is loaded.
  // If running in Azure, Application Settings are loaded.
  const username = process.env.OPENSKY_USERNAME;
  const password = process.env.OPENSKY_PASSWORD;

  // Middle East wider box for the main query
  const lamin = 12, lomin = 25, lamax = 45, lomax = 65;
  const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;

  const headers = {};
  if (username && password) {
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    headers['Authorization'] = `Basic ${auth}`;
  }

  try {
    const data = await fetchJson(url, headers);
    
    // OpenSky returns { time: number, states: [ [icao24, callsign, origin_country, time_position, last_contact, longitude, latitude, baro_altitude, on_ground, velocity, true_track, vertical_rate, sensors, geo_altitude, squawk, spi, position_source], ... ] }
    // We only care about states[5] (longitude) and states[6] (latitude) and specific countries
    
    if (!data || !data.states) {
      context.res = { body: { count: 0, countries: [] } };
      return;
    }

    const flights = data.states;
    const countryCounts = {};

    // Initialize counts
    REGIONS.forEach(r => countryCounts[r.code] = 0);

    let totalActive = 0;

    for (const flight of flights) {
      const lon = flight[5];
      const lat = flight[6];
      const onGround = flight[8];

      if (onGround || !lat || !lon) continue; // Skip ground aircraft or null pos

      totalActive++;

      // Assign to first matching country box
      for (const region of REGIONS) {
        if (lat >= region.bbox[0] && lat <= region.bbox[1] &&
            lon >= region.bbox[2] && lon <= region.bbox[3]) {
          countryCounts[region.code]++;
          break; // Count in one region only (prioritize order in array if overlap)
                 // Note: simple box check, not perfect polygon
        }
      }
    }

    // Format for frontend
    const countries = REGIONS.map(r => ({
      flag: r.flag,
      ar: r.ar,
      n: countryCounts[r.code]
    })).sort((a, b) => b.n - a.n);

    context.res = {
      body: {
        count: totalActive,
        countries: countries
      },
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=60, stale-while-revalidate=300' // Cache for 1 min
      }
    };

  } catch (error) {
    context.log.error('OpenSky fetch error:', error.message);
    context.res = {
      status: 500,
      body: { error: 'Failed to fetch flight data', details: error.message }
    };
  }
};

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    const opts = { headers, timeout: 8000 };
    https.get(url, opts, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`Status Code: ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}
