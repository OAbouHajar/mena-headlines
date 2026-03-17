import { t, lang, isRTL, onLangChange } from './i18n.js';

const POLL_MS = 600000; // 10 minutes

let _pollTimer = null;
let _headerTimer = null;
let _statsLoaded = false;

// ---------------------------------------------------------------------------
// Commodity price chart state
// ---------------------------------------------------------------------------

let _chart = null;
let _chartData = null;
let _chartFetched = false;  // true once a successful fetch has been made
let _chartVisible = { oil: false, gold: true, brent: false, natgas: false };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initStatsPanel() {
  // Always fetch in background to keep header prices fresh
  fetchAndUpdateHeader();
  _headerTimer = setInterval(fetchAndUpdateHeader, POLL_MS);

  // Panels are closed by default — defer data loading until first open
  // (Stats data will load when toggleStatsPanel opens it)
  // (Flight data will load when toggleFlightPanel opens it)

  // Close button
  document.getElementById('statsCloseBtn')?.addEventListener('click', () => toggleStatsPanel());
  // Flight panel close button
  document.getElementById('flightCloseBtn')?.addEventListener('click', () => toggleFlightPanel());

  // Fetch flight data once immediately in the background, then every 60 minutes.
  // Panel open/close never triggers a fetch — it only renders the cached snapshot.
  function _fetchFlightBackground() {
    if (_flightFetching) return;
    _flightFetching = true;
    fetchOpenSky()
      .then(data => {
        _flightData = data;
        if (!_flightTimer) _startFlightTicker();
        else {
          const curSlide = document.getElementById(`hfcSlide${_flightActiveSlot}`);
          _fillFlightSlide(curSlide, _FLIGHT_ITEMS[_flightIdx]);
        }
        // Re-render only if the panel is currently open
        const panel = document.getElementById('flightPanel');
        if (panel && !panel.classList.contains('closed')) _renderFlightPanel(data);
      })
      .catch(() => {})
      .finally(() => { _flightFetching = false; });
  }

  _fetchFlightBackground();
  _flightPollTimer = setInterval(_fetchFlightBackground, 3600000); // 60 minutes

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
  panel.classList.toggle('mobile-open', opening);
  btn?.classList.toggle('active', opening);
  if (opening) {
    if (!_statsLoaded) {
      _statsLoaded = true;
      loadStats();
      _pollTimer = setInterval(loadStats, POLL_MS);
    }
    if (!_chartFetched) loadCommodityChart();
  }
}

// ---------------------------------------------------------------------------
// Header price ticker (cycles through all 4 prices every 10s with scroll-up)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

const _TICKER_ITEMS = [
  { id: 'oil',    label: () => `🛢 ${t('statsOil')}`,    unit: '$/bbl'   },
  { id: 'gold',   label: () => `🥇 ${t('statsGold')}`,   unit: '$/oz'    },
  { id: 'brent',  label: () => `⛽ ${t('statsBrent')}`,  unit: '$/bbl'   },
  { id: 'natgas', label: () => `🔥 ${t('statsNatGas')}`, unit: '$/MMBtu' },
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
  if (labelEl)  labelEl.textContent = typeof item.label === 'function' ? item.label() : item.label;
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
let _flightFetching   = false;

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
  if (labelEl)  labelEl.textContent = `✈️ ${t(item.labelKey)}`;
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

  const isAr          = lang() === 'ar';
  const totalToday     = Math.max(data.count, data.totalToday || 0);
  const yesterdayTotal = data.yesterdayTotal || 0;
  const hasYesterday   = yesterdayTotal > 0;

  function buildCountryTable(view) {
    const isYesterday = view === 'yesterday';
    const maxVal = Math.max(...data.countries.map(c => isYesterday ? (c.yesterdayTotal || 0) : c.n), 1);

    const headerLabel2 = isYesterday ? t('flightYesterday') : t('flightToday');
    const header = `
      <div class="flt-table-head">
        <span></span>
        <span></span>
        <span></span>
        <span class="flt-th flt-th-now">${t('flightNow')}</span>
        <span class="flt-th flt-th-total">${headerLabel2}</span>
      </div>`;

    const rows = [...data.countries].sort((a, b) => {
      const aN = isYesterday ? (a.yesterdayTotal || 0) : Math.max(a.n, a.todayTotal || 0);
      const bN = isYesterday ? (b.yesterdayTotal || 0) : Math.max(b.n, b.todayTotal || 0);
      return bN - aN;
    }).map(c => {
      const nowN     = c.n;
      const todayN   = Math.max(c.n, c.todayTotal || 0);
      const yestN    = c.yesterdayTotal || 0;
      const primaryN = isYesterday ? yestN : nowN;
      const barW     = primaryN > 0 ? Math.max(4, Math.round(primaryN / maxVal * 100)) : 0;
      const isZero   = isYesterday ? yestN === 0 : nowN === 0;
      const nowCell   = nowN > 0   ? nowN   : '—';
      const totalCell = isYesterday
        ? (yestN > 0 ? yestN : '—')
        : (todayN > 0 ? todayN : '—');
      return `
        <div class="flt-table-row${isZero ? ' flt-zero' : ''}">
          <span class="flight-country-flag">${c.flag}</span>
          <span class="flight-country-name">${isAr ? c.ar : (c.en || c.ar)}</span>
          <span class="flight-country-bar-wrap">
            <span class="flight-country-bar" style="width:${barW}%"></span>
          </span>
          <span class="flt-col-now">${nowCell}</span>
          <span class="flt-col-total">${totalCell}</span>
        </div>`;
    }).join('');

    return header + rows;
  }

  const tabsHTML = hasYesterday ? `
    <div class="flight-tabs">
      <button class="flight-tab active" data-view="today">${t('flightToday')}</button>
      <button class="flight-tab" data-view="yesterday">${t('flightYesterday')}</button>
    </div>` : '';

  body.innerHTML = `
    <div class="stats-section">
      <p class="flight-hero-desc">${t('flightHeroDesc')}</p>
      <div class="stats-cards-row">
        <div class="stat-card flight-now-card">
          <div class="stat-hero-value">${data.count.toLocaleString()}</div>
          <div class="stat-card-label">✈️ ${t('flightNow')}</div>
        </div>
        <div class="stat-card flight-today-card">
          <div class="stat-hero-value">${totalToday.toLocaleString()}</div>
          <div class="stat-card-label">📊 ${t('flightToday')}</div>
        </div>
      </div>
    </div>
    <div class="stats-section">
      <div class="flight-section-header">
        <span class="stats-section-title" style="margin:0">${t('flightByCountry')}</span>
        ${tabsHTML}
      </div>
      <div class="flight-countries" id="flightCountriesBody">
        ${buildCountryTable('today')}
      </div>
    </div>
    <div class="flight-update-time">${t('flightLastUpdate')}: ${new Date().toLocaleTimeString(isAr ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</div>
  `;

  body.querySelectorAll('.flight-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.flight-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const countriesEl = document.getElementById('flightCountriesBody');
      countriesEl.classList.toggle('flt-hide-now', btn.dataset.view === 'yesterday');
      countriesEl.innerHTML = buildCountryTable(btn.dataset.view);
    });
  });
}

export function toggleFlightPanel() {
  const panel = document.getElementById('flightPanel');
  const btn   = document.getElementById('flightBtn');
  if (!panel) return;
  const opening = panel.classList.contains('closed');
  panel.classList.toggle('closed');
  panel.classList.toggle('mobile-open', opening);
  btn?.classList.toggle('active', opening);
  if (opening) {
    if (_flightData) {
      _renderFlightPanel(_flightData);
    }
    // else: background fetch is in progress — it will render when it completes
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
// Commodity history chart
// ---------------------------------------------------------------------------

const _CHART_COMMODITIES = [
  { id: 'oil',    icon: '🛢', labelKey: 'statsOil',    unit: '$/bbl',   color: '#4e9cd4' },
  { id: 'gold',   icon: '🥇', labelKey: 'statsGold',   unit: '$/oz',    color: '#e8c54a' },
  { id: 'brent',  icon: '⛽', labelKey: 'statsBrent',  unit: '$/bbl',   color: '#e07b38' },
  { id: 'natgas', icon: '🔥', labelKey: 'statsNatGas', unit: '$/MMBtu', color: '#4caf7d' },
];

async function loadCommodityChart() {
  const canvas = document.getElementById('priceHistoryCanvas');
  if (!canvas) return;
  try {
    const resp = await fetch('/api/commodity-history');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    _chartData = await resp.json();
    _chartFetched = true;
    _renderChartToggles();
    _renderPriceChart();
  } catch (err) {
    console.error('[commodity-chart]', err);
    const area = document.querySelector('.price-chart-area');
    if (area) area.innerHTML = `<div class="stats-error">${t('priceChartError')}</div>`;
  }
}

function _formatChartDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString(lang() === 'ar' ? 'ar-SA' : 'en-US', { month: 'short', day: 'numeric' });
}

function _renderPriceChart() {
  const canvas = document.getElementById('priceHistoryCanvas');
  if (!canvas || !_chartData || !window.Chart) return;

  // Collect dates from the longest series
  const base = _chartData.oil?.length ? _chartData.oil : (_chartData.gold || []);
  const labels = base.map(p => _formatChartDate(p.date));

  const datasets = _CHART_COMMODITIES.map(c => ({
    label: `${c.icon} ${t(c.labelKey)} (${c.unit})`,
    data: (_chartData[c.id] || []).map(p => p.close),
    borderColor: c.color,
    backgroundColor: c.color + '22',
    borderWidth: 2,
    pointRadius: 3,
    pointHoverRadius: 5,
    tension: 0.35,
    fill: false,
    hidden: !_chartVisible[c.id],
    yAxisID: (c.id === 'natgas') ? 'yRight' : 'y',
  }));

  if (_chart) {
    _chart.data.labels = labels;
    _chart.data.datasets = datasets;
    _chart.update();
    return;
  }

  _chart = new window.Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a1a',
          borderColor: '#333',
          borderWidth: 1,
          titleColor: '#ccc',
          bodyColor: '#eee',
          padding: 10,
        },
      },
      scales: {
        x: {
          ticks: { color: '#888', font: { size: 11 } },
          grid: { color: '#2a2a2a' },
        },
        y: {
          position: 'left',
          ticks: { color: '#888', font: { size: 11 } },
          grid: { color: '#2a2a2a' },
        },
        yRight: {
          position: 'right',
          ticks: { color: '#4caf7d', font: { size: 11 } },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}

function _renderChartToggles() {
  const wrap = document.getElementById('priceChartToggles');
  if (!wrap) return;
  wrap.innerHTML = _CHART_COMMODITIES.map(c => `
    <button class="pct-btn${_chartVisible[c.id] ? ' active' : ''}" data-id="${c.id}" style="--dot:${c.color}">
      ${c.icon} ${t(c.labelKey)}
    </button>`).join('');
  wrap.querySelectorAll('.pct-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      _chartVisible[id] = !_chartVisible[id];
      btn.classList.toggle('active', _chartVisible[id]);
      if (_chart) {
        const meta = _CHART_COMMODITIES.find(c => c.id === id);
        const dsIdx = _CHART_COMMODITIES.indexOf(meta);
        if (_chart.data.datasets[dsIdx]) {
          _chart.data.datasets[dsIdx].hidden = !_chartVisible[id];
          _chart.update();
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// i18n label refresh
// ---------------------------------------------------------------------------

// (handled inline via onLangChange in initStatsPanel)
