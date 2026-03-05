import { t, lang, isRTL, onLangChange } from './i18n.js';

const POLL_MS = 600000; // 10 minutes

let _pollTimer = null;
let _headerTimer = null;
let _map = null;
let _markers = [];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initStatsPanel() {
  // Always fetch in background to keep header prices fresh
  fetchAndUpdateHeader();
  _headerTimer = setInterval(fetchAndUpdateHeader, POLL_MS);

  // Panel is open by default — load immediately
  loadStats();
  _pollTimer = setInterval(loadStats, POLL_MS);

  // Re-validate map after first paint (panel is already visible)
  setTimeout(() => _map?.invalidateSize(), 500);

  // Close button
  document.getElementById('statsCloseBtn')?.addEventListener('click', () => toggleStatsPanel());
  // Flight panel close button
  document.getElementById('flightCloseBtn')?.addEventListener('click', () => toggleFlightPanel());

  // Flight panel is open by default — load data immediately
  _flightLoaded = true;
  document.getElementById('flightBtn')?.classList.add('active');
  fetchOpenSky()
    .then(data => {
      _flightData = data;
      _startFlightTicker();
      _renderFlightPanel(data);
    })
    .catch(() => {
      const body = document.getElementById('flightBody');
      if (body) body.innerHTML = `<div class="stats-error">${t('flightLoadError')}</div>`;
    });
  _flightPollTimer = setInterval(() => {
    fetchOpenSky().then(data => {
      _flightData = data;
      if (!_flightTimer) _startFlightTicker();
      else {
        // Refresh current slide in-place
        const curSlide = document.getElementById(`hfcSlide${_flightActiveSlot}`);
        _fillFlightSlide(curSlide, _FLIGHT_ITEMS[_flightIdx]);
      }
      const flightPanel = document.getElementById('flightPanel');
      if (flightPanel && !flightPanel.classList.contains('closed')) _renderFlightPanel(data);
    }).catch(() => {});
  }, 120000); // 2 minutes (OpenSky rate limit safe)

  onLangChange(() => {
    const panel = document.getElementById('statsPanel');
    if (panel && !panel.classList.contains('closed')) loadStats();
  });
}

export function toggleStatsPanel() {
  const panel = document.getElementById('statsPanel');
  const btn = document.getElementById('statsBtn');
  if (!panel) return;
  const opening = panel.classList.contains('closed');
  panel.classList.toggle('closed');
  btn?.classList.toggle('active', opening);
  if (opening) {
    // Panel just opened — invalidate map size after transition
    setTimeout(() => _map?.invalidateSize(), 350);
  }
}

// ---------------------------------------------------------------------------
// Header price ticker (cycles through all 4 prices every 10s with scroll-up)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

const _TICKER_ITEMS = [
  { id: 'oil',    label: '🛢 WTI',    unit: '$/bbl'   },
  { id: 'gold',   label: '🥇 Gold',   unit: '$/oz'    },
  { id: 'brent',  label: '⛽ Brent',  unit: '$/bbl'   },
  { id: 'natgas', label: '🔥 NatGas', unit: '$/MMBtu' },
];
let _tickerData   = {};   // keyed by item.id
let _tickerIdx    = 0;
let _tickerTimer  = null;
let _activeSlot   = 'A';  // which slide is currently visible

async function fetchAndUpdateHeader() {
  try {
    const resp = await fetch('/api/stats');
    if (!resp.ok) return;
    const data = await resp.json();
    const p = data.prices || {};
    _tickerData = {
      oil:    p.oil,
      gold:   p.gold,
      brent:  p.brent,
      natgas: p.natgas,
    };
    // If ticker not running yet, seed first slide and start
    if (!_tickerTimer) {
      _fillSlide(document.getElementById('hpcSlideA'), _TICKER_ITEMS[0]);
      _tickerTimer = setInterval(_tickerAdvance, 10000);
    }
  } catch { /* silent */ }
}

function _fillSlide(el, item) {
  if (!el || !item) return;
  const priceData = _tickerData[item.id];
  const labelEl  = el.querySelector('.hpc-label');
  const priceEl  = el.querySelector('.hpc-price');
  const changeEl = el.querySelector('.hpc-change');
  if (labelEl)  labelEl.textContent = item.label;
  if (!priceData) {
    if (priceEl)  priceEl.textContent  = '—';
    if (changeEl) { changeEl.textContent = ''; changeEl.className = 'hpc-change'; }
    return;
  }
  const dir   = priceData.changePct >= 0 ? 'up' : 'down';
  const arrow = dir === 'up' ? '▲' : '▼';
  const sign  = dir === 'up' ? '+' : '';
  if (priceEl)  priceEl.textContent = priceData.price.toLocaleString();
  if (changeEl) {
    changeEl.textContent = `${arrow}${sign}${priceData.changePct.toFixed(2)}%`;
    changeEl.className   = `hpc-change ${dir}`;
  }
}

function _tickerAdvance() {
  _tickerIdx = (_tickerIdx + 1) % _TICKER_ITEMS.length;
  const nextItem   = _TICKER_ITEMS[_tickerIdx];
  const curSlotId  = `hpcSlide${_activeSlot}`;
  const nextSlotId = `hpcSlide${_activeSlot === 'A' ? 'B' : 'A'}`;
  const curSlide   = document.getElementById(curSlotId);
  const nextSlide  = document.getElementById(nextSlotId);
  if (!curSlide || !nextSlide) return;

  // Prepare next slide content (hidden below)
  nextSlide.className = 'hpc-slide hpc-below';
  _fillSlide(nextSlide, nextItem);

  // Force reflow so the initial position is applied before animation
  void nextSlide.offsetWidth;

  // Animate current out (up) and next in (from below)
  curSlide.classList.add('hpc-exit-up');
  nextSlide.classList.add('hpc-enter-up');

  // After animation ends, reset classes
  setTimeout(() => {
    curSlide.className  = 'hpc-slide hpc-below';
    nextSlide.className = 'hpc-slide';
    _activeSlot = _activeSlot === 'A' ? 'B' : 'A';
  }, 400);
}

// ---------------------------------------------------------------------------
// Flight Ticker (OpenSky Network — Middle East airspace ~12–42°N, 25–65°E)
// ---------------------------------------------------------------------------

const _FLIGHT_ITEMS = [
  { id: 'count',   labelKey: 'flightBtn', unit: '' },
];
let _flightData       = null;
let _flightIdx        = 0;
let _flightTimer      = null;
let _flightActiveSlot = 'A';
let _flightPollTimer  = null;
let _flightLoaded     = false;

// Middle East countries with flag, Arabic name, and bounding box [latMin,latMax,lonMin,lonMax]

async function fetchOpenSky() {
  const resp = await fetch('/api/flights');
  if (!resp.ok) throw new Error(`OpenSky HTTP ${resp.status}`);
  return await resp.json();
}


function _fillFlightSlide(el, item) {
  if (!el || !item || !_flightData) return;
  const labelEl  = el.querySelector('.hpc-label');
  const priceEl  = el.querySelector('.hpc-price');
  const changeEl = el.querySelector('.hpc-change');
  if (labelEl)  labelEl.textContent = item.label;
  const val = _flightData[item.id];
  if (priceEl)  priceEl.textContent = val != null ? val.toLocaleString() : '—';
  if (changeEl) { changeEl.textContent = item.unit || ''; changeEl.className = 'hpc-change'; }
}

function _startFlightTicker() {
  if (!_flightData) return;
  _fillFlightSlide(document.getElementById('hfcSlideA'), _FLIGHT_ITEMS[0]);
  if (_flightTimer) clearInterval(_flightTimer);
}

function _flightTickerAdvance() {
  // Only one item now, no need to cycle
  return;
}

function _renderFlightPanel(data) {
  const body = document.getElementById('flightBody');
  if (!body) return;
  if (!data) {
    body.innerHTML = `<div class="stats-error">${t('flightDataError')}</div>`;
    return;
  }

  const maxN = (data.countries[0]?.n) || 1;
  const isAr = lang() === 'ar';
  const countriesHTML = data.countries.map(c => {
    const barW = c.n > 0 ? Math.max(4, Math.round(c.n / maxN * 100)) : 0;
    return `
      <div class="flight-country-row${c.n === 0 ? ' flt-zero' : ''}">
        <span class="flight-country-flag">${c.flag}</span>
        <span class="flight-country-name">${isAr ? c.ar : (c.en || c.ar)}</span>
        <span class="flight-country-bar-wrap">
          <span class="flight-country-bar" style="width:${barW}%"></span>
        </span>
        <span class="flight-country-count">${c.n > 0 ? c.n : '—'}</span>
      </div>`;
  }).join('');

  body.innerHTML = `
    <div class="stats-section">
      <div class="stat-card stat-card-hero-full">
        <div class="stat-hero-value" style="font-size:2rem">${data.count}</div>
        <div class="stat-card-label">✈️ ${t('flightActiveCount')}</div>
      </div>
    </div>
    <div class="stats-section">
      <div class="stats-section-title">${t('flightByCountry')}</div>
      <div class="flight-countries">${countriesHTML}</div>
    </div>
    <div class="stats-section">
      <div class="stats-cards-row">
        <!-- Stats removed by request -->
      </div>
    </div>
    <div class="flight-update-time">${t('flightLastUpdate')}: ${new Date().toLocaleTimeString(isAr ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</div>
  `;
}

export function toggleFlightPanel() {
  const panel = document.getElementById('flightPanel');
  const btn   = document.getElementById('flightBtn');
  if (!panel) return;
  const opening = panel.classList.contains('closed');
  panel.classList.toggle('closed');
  btn?.classList.toggle('active', opening);
  if (opening) {
    if (!_flightLoaded) {
      _flightLoaded = true;
      fetchOpenSky()
        .then(data => {
          _flightData = data;
          if (!_flightTimer) _startFlightTicker();
          _renderFlightPanel(data);
        })
        .catch(() => {
          const body = document.getElementById('flightBody');
          if (body) body.innerHTML = `<div class="stats-error">${t('flightLoadError')}</div>`;
        });
    } else if (_flightData) {
      _renderFlightPanel(_flightData);
    }
  }
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function loadStats() {
  const body = document.getElementById('statsBody');
  if (!body) return;

  // Show skeleton
  renderSkeleton(body);

  try {
    const resp = await fetch('/api/stats');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    renderStats(body, data);
  } catch (err) {
    console.error('[stats]', err);
    renderError(body);
  }
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderSkeleton(container) {
  container.innerHTML = `
    <div class="stats-section">
      <div class="stats-section-title stats-skeleton" style="width:120px;height:14px"></div>
      <div class="stats-cards-row">
        <div class="stat-card stats-skeleton" style="height:72px"></div>
        <div class="stat-card stats-skeleton" style="height:72px"></div>
      </div>
    </div>
    <div class="stats-section">
      <div class="stats-section-title stats-skeleton" style="width:120px;height:14px;margin-bottom:8px"></div>
      <div class="stats-cards-row">
        <div class="stat-card stats-skeleton" style="height:72px"></div>
        <div class="stat-card stats-skeleton" style="height:72px"></div>
      </div>
    </div>
    <div class="stats-section">
      <div class="stats-section-title stats-skeleton" style="width:120px;height:14px;margin-bottom:8px"></div>
      ${[1,2,3].map(() => `<div class="stats-skeleton" style="height:44px;margin-bottom:6px;border-radius:6px"></div>`).join('')}
    </div>
  `;
}

function renderError(container) {
  container.innerHTML = `<div class="stats-error">${t('statsNoData')}</div>`;
}



function renderStats(container, data) {
  const { prices, stocks } = data;

  container.innerHTML = `
    <!-- Market Pulse -->
    <div class="stats-section">
      <div class="stats-section-title">${t('statsMarket')}</div>
      <div class="stats-cards-row">
        ${priceCard('statsOil',    '🛢', prices?.oil,    '$/bbl')}
        ${priceCard('statsGold',   '🥇', prices?.gold,   '$/oz')}
      </div>
      <div class="stats-cards-row" style="margin-top:8px">
        ${priceCard('statsBrent',  '⛽', prices?.brent,  '$/bbl')}
        ${priceCard('statsNatGas', '🔥', prices?.natgas, '$/MMBtu')}
      </div>
    </div>

    <!-- Top 10 Stocks — auto-scroll ticker -->
    ${stocks?.length ? `
    <div class="stats-section">
      <div class="stats-section-title">📈 ${t('topStocks')}</div>
      <div class="stocks-ticker-wrap">
        <div class="stocks-ticker-inner">
          ${[...stocks, ...stocks].map(s => {
            const dir = s.changePct >= 0 ? 'up' : 'down';
            const arrow = dir === 'up' ? '▲' : '▼';
            const sign  = dir === 'up' ? '+' : '';
            return `
            <div class="stock-row">
              <span class="stock-symbol">${s.symbol}</span>
              <span class="stock-name">${s.name}</span>
              <span class="stock-price">$${s.price.toLocaleString()}</span>
              <span class="stock-change ${dir}">${arrow} ${sign}${s.changePct.toFixed(2)}%</span>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>` : ''}

  `;

  // Plot active conflict zones on the Leaflet map
  initMap();
}

function priceCard(labelKey, icon, priceData, unit) {
  if (!priceData) {
    return `
      <div class="stat-card">
        <div class="stat-card-label">${icon} ${t(labelKey)}</div>
        <div class="stat-price stat-unavailable">—</div>
      </div>`;
  }
  const dir = priceData.changePct >= 0 ? 'up' : 'down';
  const arrow = dir === 'up' ? '▲' : '▼';
  const sign = dir === 'up' ? '+' : '';
  return `
    <div class="stat-card">
      <div class="stat-card-label">${icon} ${t(labelKey)}</div>
      <div class="stat-price">${priceData.price.toLocaleString()} <span class="stat-unit">${unit}</span></div>
      <div class="stat-change ${dir}">${arrow} ${sign}${priceData.changePct.toFixed(2)}%</div>
    </div>`;
}

function heroCard(labelKey, value, available) {
  const formatted = typeof value === 'number' ? value.toLocaleString() : value;
  return `
    <div class="stat-card stat-card-hero">
      <div class="stat-hero-value">${available === false ? '—' : formatted}</div>
      <div class="stat-card-label">${t(labelKey)}</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Leaflet map (conflict / disaster markers)
// ---------------------------------------------------------------------------

// Active conflict zones — hardcoded known ongoing conflicts with coordinates
const CONFLICT_ZONES = [
  { nameAr: 'غزة / فلسطين', nameEn: 'Gaza / Palestine', lat: 31.35, lon: 34.31, level: 'red' },
  { nameAr: 'الضفة الغربية', nameEn: 'West Bank', lat: 31.95, lon: 35.30, level: 'red' },
  { nameAr: 'أوكرانيا', nameEn: 'Ukraine', lat: 48.38, lon: 31.17, level: 'red' },
  { nameAr: 'اليمن', nameEn: 'Yemen', lat: 15.55, lon: 48.52, level: 'red' },
  { nameAr: 'السودان', nameEn: 'Sudan', lat: 15.50, lon: 32.56, level: 'red' },
  { nameAr: 'سوريا', nameEn: 'Syria', lat: 34.80, lon: 38.99, level: 'orange' },
  { nameAr: 'لبنان', nameEn: 'Lebanon', lat: 33.85, lon: 35.86, level: 'orange' },
  { nameAr: 'ميانمار', nameEn: 'Myanmar', lat: 19.76, lon: 96.08, level: 'orange' },
  { nameAr: 'الكونغو', nameEn: 'DR Congo', lat: -4.04, lon: 21.76, level: 'orange' },
  { nameAr: 'الصومال', nameEn: 'Somalia', lat: 5.15, lon: 46.20, level: 'orange' },
  { nameAr: 'الساحل', nameEn: 'Sahel / Mali', lat: 17.57, lon: -3.99, level: 'orange' },
  { nameAr: 'إثيوبيا', nameEn: 'Ethiopia', lat: 9.15, lon: 40.49, level: 'orange' },
  { nameAr: 'هايتي', nameEn: 'Haiti', lat: 18.97, lon: -72.29, level: 'orange' },
  { nameAr: 'ليبيا', nameEn: 'Libya', lat: 26.34, lon: 17.23, level: 'green' },
];

function initMap() {
  const el = document.getElementById('statsConflictMap');
  if (!el) return;

  // Remove old markers
  _markers.forEach((m) => m && m.remove ? m.remove() : null);
  _markers = [];

  // Init map once
  if (!_map) {
    if (!window.L) return; // Leaflet not loaded
    _map = window.L.map(el, {
      center: [20, 20],
      zoom: 2,
      scrollWheelZoom: false,
      attributionControl: false,
      zoomControl: false,
    });
    window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
      crossOrigin: true,
    }).addTo(_map);
    setTimeout(() => _map.invalidateSize(), 250);
    setTimeout(() => _map.invalidateSize(), 800);
  } else {
    setTimeout(() => _map.invalidateSize(), 100);
  }

  const isAr = lang() === 'ar';
  const colorMap = { red: '#c94040', orange: '#e8a838', green: '#4caf7d' };
  for (const z of CONFLICT_ZONES) {
    const color  = colorMap[z.level] || '#4caf7d';
    const radius = z.level === 'red' ? 8 : z.level === 'orange' ? 6 : 4;
    const label  = isAr ? z.nameAr : z.nameEn;
    const marker = window.L.circleMarker([z.lat, z.lon], {
      radius,
      color,
      fillColor: color,
      fillOpacity: 0.80,
      weight: 1.5,
    }).bindTooltip(label, { direction: 'top', className: 'gdacs-tooltip' });
    marker.addTo(_map);
    _markers.push(marker);
  }
}

// ---------------------------------------------------------------------------
// i18n label refresh
// ---------------------------------------------------------------------------

// (handled inline via onLangChange in initStatsPanel)
