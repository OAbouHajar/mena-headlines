import { t, lang, onLangChange } from './i18n.js';

const POLL_MS = 10 * 60 * 1000; // 10 minutes

let _pollTimer = null;
let _headerTimer = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initStatsPanel() {
  const tabBtn = document.getElementById('tabStats');
  if (!tabBtn) return;

  // Always fetch in background to keep header prices fresh
  fetchAndUpdateHeader();
  _headerTimer = setInterval(fetchAndUpdateHeader, POLL_MS);

  let loaded = false;
  tabBtn.addEventListener('click', () => {
    if (!loaded) {
      loaded = true;
      loadStats();
      _pollTimer = setInterval(loadStats, POLL_MS);
    }
  });

  if (tabBtn.classList.contains('active')) {
    loaded = true;
    loadStats();
    _pollTimer = setInterval(loadStats, POLL_MS);
  }

  onLangChange(() => {
    const tab = document.getElementById('tabStats');
    if (tab && tab.classList.contains('active')) loadStats();
  });
}

// ---------------------------------------------------------------------------
// Header price chip updater (always runs in background)
// ---------------------------------------------------------------------------

async function fetchAndUpdateHeader() {
  try {
    const resp = await fetch('/api/stats');
    if (!resp.ok) return;
    const data = await resp.json();
    updateHeaderChip('headerOil',    data.prices?.oil,    '🛢 WTI');
    updateHeaderChip('headerGold',   data.prices?.gold,   '🥇 Gold');
    updateHeaderChip('headerBrent',  data.prices?.brent,  '⛽ Brent');
    updateHeaderChip('headerNatgas', data.prices?.natgas, '🔥 NatGas');
  } catch { /* silent */ }
}

function updateHeaderChip(id, priceData, label) {
  const el = document.getElementById(id);
  if (!el) return;
  const priceEl  = el.querySelector('.hpc-price');
  const changeEl = el.querySelector('.hpc-change');
  if (!priceData) {
    if (priceEl)  priceEl.textContent  = '—';
    if (changeEl) changeEl.textContent = '';
    return;
  }
  const dir    = priceData.changePct >= 0 ? 'up' : 'down';
  const arrow  = dir === 'up' ? '▲' : '▼';
  const sign   = dir === 'up' ? '+' : '';
  if (priceEl)  priceEl.textContent  = priceData.price.toLocaleString();
  if (changeEl) {
    changeEl.textContent = `${arrow}${sign}${priceData.changePct.toFixed(2)}%`;
    changeEl.className   = `hpc-change ${dir}`;
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
  const { prices, alerts, conflicts } = data;

  container.innerHTML = `
    <!-- Global Tension Score -->
    ${renderTensionCard(alerts)}

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

    <!-- Active Conflicts -->
    <div class="stats-section">
      <div class="stats-section-title">${t('statsConflicts')}</div>
      <div class="stats-cards-row">
        ${heroCard('statsEvents',     conflicts?.events     ?? '—', conflicts?.available)}
        ${heroCard('statsFatalities', conflicts?.fatalities ?? '—', conflicts?.available)}
      </div>
      ${!conflicts?.available ? `<p class="stats-acled-note">${t('statsAcledNote')}</p>` : ''}
    </div>

    <!-- GDACS Disaster Alerts -->
    <div class="stats-section">
      <div class="stats-section-title">${t('statsAlerts')}</div>
      <div id="statsAlertList">
        ${renderAlerts(alerts)}
      </div>
    </div>
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

function renderAlerts(alerts) {
  if (!alerts || alerts.length === 0) {
    return `<div class="stats-empty">${t('statsNoData')}</div>`;
  }
  return alerts.map((a) => {
    const levelLabel = a.level === 'red' ? t('statsAlertRed') : a.level === 'orange' ? t('statsAlertOrange') : t('statsAlertGreen');
    const dateStr = a.pubDate ? new Date(a.pubDate).toLocaleDateString(lang() === 'ar' ? 'ar-SA' : 'en-GB', { day: 'numeric', month: 'short' }) : '';
    return `
      <div class="alert-item">
        <span class="alert-badge alert-badge-${a.level}">${a.eventType || levelLabel}</span>
        <span class="alert-text">${a.title}</span>
        <span class="alert-date">${dateStr}</span>
      </div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Leaflet map (conflict / disaster markers)
// ---------------------------------------------------------------------------

function initMap(alerts) {
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
      zoomControl: true,
    });
    window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
    }).addTo(_map);
  } else {
    // Just re-use existing map instance
    setTimeout(() => _map.invalidateSize(), 100);
  }

  if (!alerts) return;

  // GDACS events come with bounding boxes but no lat/lon directly in RSS.
  // Use approximate centre coords extracted from GDACS event links.
  // e.g. https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1400614 — no coords in RSS by default.
  // We render red circles for "red", orange for "orange", green for "green" using a lookup approach.
  // Since GDACS RSS doesn't always include lat/lon, we skip mapping for events without data.
  // Future: use full GeoJSON endpoint from GDACS.
}

// ---------------------------------------------------------------------------
// i18n label refresh
// ---------------------------------------------------------------------------

// (handled inline via onLangChange in initStatsPanel)
