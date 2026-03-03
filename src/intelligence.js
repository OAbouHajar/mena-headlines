/**
 * Intelligence Panel — Live situational analysis via Azure OpenAI.
 * Bloomberg-terminal style. Fully bilingual EN/AR.
 */

import { t, lang, onLangChange } from './i18n.js';

const CACHE_TTL   = 5 * 60_000;    // 5 min client cache for latest report
const AUTO_REFRESH = 3 * 60 * 60_000; // 3 hours — matches server cache TTL

let _historyCaches = {};  // keyed "lang:index" → { data, timestamp }
let _historyIndex  = 0;   // currently viewing (0 = latest)
let _historyTotal  = 1;   // total reports available
let _refreshTimer  = null;
let _fetchDebounce = null;
let _isFetching    = false;
let _panelOpen     = false;
let _secondsTimer  = null;
let _lastFetchTime = null;

// ─── Collect visible headlines from ticker + updates feed ─────────────────────
function collectHeadlines() {
  const headlines = new Set();

  // From the news ticker items
  document.querySelectorAll('.ticker-item .ticker-text').forEach(el => {
    const text = el.textContent.trim();
    if (text.length > 20) headlines.add(text);
  });

  // From the updates feed
  document.querySelectorAll('.update-headline').forEach(el => {
    const text = el.textContent.trim();
    if (text.length > 20) headlines.add(text);
  });

  return [...headlines];
}

// ─── History navigation helpers ──────────────────────────────────────────────
function historyLabel(index) {
  if (index === 0) return t('intelNow');
  return t('intelHoursAgo', index * 3);
}

function updateHistoryNav() {
  const nav      = document.getElementById('intelHistoryNav');
  const label    = document.getElementById('intelHistoryLabel');
  const olderBtn = document.getElementById('intelOlderBtn');
  const newerBtn = document.getElementById('intelNewerBtn');
  if (!nav) return;

  // Always show nav so users see the time context
  nav.style.display = 'flex';
  if (label)    label.textContent = historyLabel(_historyIndex);
  if (olderBtn) olderBtn.disabled = _historyIndex >= _historyTotal - 1;
  if (newerBtn) newerBtn.disabled = _historyIndex <= 0;
  if (olderBtn) olderBtn.title    = t('intelOlderTitle');
  if (newerBtn) newerBtn.title    = t('intelNewerTitle');
}

// ─── Fetch from /api/intelligence ─────────────────────────────────────────────
async function fetchIntelligence(histIdx) {
  if (histIdx === undefined) histIdx = _historyIndex;

  // For historical reports: cache forever (they're immutable)
  // For latest (index 0): cache 5 minutes
  const cacheKey = `${lang()}:${histIdx}`;
  const cached   = _historyCaches[cacheKey];
  const ttl      = histIdx > 0 ? Infinity : CACHE_TTL;
  if (cached && Date.now() - cached.timestamp < ttl) {
    renderData(cached.data);
    updateHistoryNav();
    return;
  }

  _isFetching = true;
  renderSkeleton();
  document.getElementById('intelRefreshBtn')?.classList.add('spinning');
  document.getElementById('intelPanel')?.classList.add('fetching');

  try {
    const res = await fetch('/api/intelligence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: lang(), historyIndex: histIdx }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    // Update history state from server response
    if (typeof data._historyIndex === 'number') _historyIndex = data._historyIndex;
    if (typeof data._historyTotal === 'number') _historyTotal = data._historyTotal;

    _historyCaches[`${lang()}:${histIdx}`] = { data, timestamp: Date.now() };
    _lastFetchTime = data._generatedAt || Date.now();
    renderData(data);
    updateHistoryNav();
  } catch (err) {
    console.error('[Intelligence]', err);
    renderError(t('intelErrorMsg'));
  } finally {
    _isFetching = false;
    document.getElementById('intelRefreshBtn')?.classList.remove('spinning');
    document.getElementById('intelPanel')?.classList.remove('fetching');
  }
}

// ─── Debounced trigger ────────────────────────────────────────────────────────
function triggerFetch(histIdx) {
  clearTimeout(_fetchDebounce);
  _fetchDebounce = setTimeout(() => fetchIntelligence(histIdx ?? _historyIndex), 300);
}

// ─── Risk badge config ────────────────────────────────────────────────────────
function riskConfig(level = '') {
  const map = {
    low:      { cls: 'risk-low',      labelKey: 'intelRiskLow' },
    moderate: { cls: 'risk-moderate', labelKey: 'intelRiskModerate' },
    elevated: { cls: 'risk-elevated', labelKey: 'intelRiskElevated' },
    high:     { cls: 'risk-high',     labelKey: 'intelRiskHigh' },
  };
  const entry = map[(level || '').toLowerCase()] || map.moderate;
  return { cls: entry.cls, label: t(entry.labelKey) };
}

function confidenceLabel(level = '') {
  const map = {
    low:      'intelConfLow',
    moderate: 'intelConfModerate',
    high:     'intelConfHigh',
  };
  const key = map[(level || '').toLowerCase()];
  return key ? t(key) : (level || '—');
}

// ─── Seconds-ago label ────────────────────────────────────────────────────────
function startSecondsTimer() {
  clearInterval(_secondsTimer);
  const el = document.getElementById('intelTimestamp');
  if (!el) return;
  _secondsTimer = setInterval(() => {
    if (!_lastFetchTime) return;
    const secs = Math.round((Date.now() - _lastFetchTime) / 1000);
    if (el) el.textContent = secs < 60 ? t('intelUpdatedSecs', secs) : t('intelUpdatedMins', Math.round(secs / 60));
  }, 5000);
}

// ─── Header summary bar ───────────────────────────────────────────────────────
function updateHeaderBar(d) {
  const bar  = document.getElementById('headerIntelBar');
  const dot  = document.getElementById('headerIntelDot');
  const text = document.getElementById('headerIntelText');
  const riskEl = document.getElementById('headerIntelRisk');
  if (!bar || !dot || !text || !riskEl) return;

  bar.classList.remove('loading');

  const overview  = d.situation_overview || '';
  const separator = '\u2003•\u2003'; // em-space • em-space
  // Duplicate text for seamless marquee loop
  text.textContent = overview + separator + overview;
  text.classList.remove('marquee');
  void text.offsetWidth; // force reflow
  text.classList.add('marquee');

  const { cls, label } = riskConfig(d.risk_level);
  dot.className   = `header-intel-dot ${cls}`;
  riskEl.textContent = label;
  riskEl.className   = `header-intel-risk ${cls} visible`;
}

function headerBarLoading() {
  const bar  = document.getElementById('headerIntelBar');
  const text = document.getElementById('headerIntelText');
  const dot  = document.getElementById('headerIntelDot');
  const riskEl = document.getElementById('headerIntelRisk');
  if (!bar) return;
  bar.classList.add('loading');
  text.classList.remove('marquee');
  text.textContent = t('intelHeaderLoading');
  if (dot) dot.className = 'header-intel-dot';
  if (riskEl) { riskEl.className = 'header-intel-risk'; riskEl.textContent = ''; }
}

function renderSkeleton() {
  headerBarLoading();
  const body = document.getElementById('intelBody');
  const tsEl = document.getElementById('intelTimestamp');
  if (!body) return;
  if (tsEl) {
    tsEl.textContent = t('intelAnalyzing');
    tsEl.classList.add('loading-pulse');
  }
  body.innerHTML = `
    <div class="intel-skeleton">
      <div class="skel skel-title"></div>
      <div class="skel skel-line"></div>
      <div class="skel skel-line skel-short"></div>
      <div class="skel skel-line"></div>
    </div>
    <div class="intel-skeleton" style="margin-top:18px">
      <div class="skel skel-title skel-sm"></div>
      <div class="skel skel-line skel-short"></div>
    </div>
    <div class="intel-skeleton" style="margin-top:18px">
      <div class="skel skel-title skel-sm"></div>
      <div class="skel skel-tags">
        <div class="skel skel-tag"></div>
        <div class="skel skel-tag"></div>
        <div class="skel skel-tag"></div>
      </div>
    </div>`;
}

function renderError(msg) {
  const body = document.getElementById('intelBody');
  const tsEl = document.getElementById('intelTimestamp');
  if (!body) return;
  if (tsEl) {
    tsEl.textContent = '';
    tsEl.classList.remove('loading-pulse');
  }
  body.innerHTML = `
    <div class="intel-error">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <p>${msg}</p>
    </div>`;
}

function renderData(d) {
  updateHeaderBar(d);
  const body = document.getElementById('intelBody');
  const tsEl = document.getElementById('intelTimestamp');
  if (!body) return;

  if (tsEl) tsEl.classList.remove('loading-pulse');
  if (tsEl && _lastFetchTime) {
    tsEl.textContent = t('intelUpdatedNow');
    startSecondsTimer();
  }

  const risk = riskConfig(d.risk_level);
  const tags = Array.isArray(d.key_dynamics)
    ? d.key_dynamics.map(tag => `<span class="intel-tag">${esc(tag)}</span>`).join('')
    : '';

  body.innerHTML = `
    <section class="intel-section">
      <h4 class="intel-section-label">${t('intelSituationOverview')}</h4>
      <p class="intel-text">${esc(d.situation_overview || '—')}</p>
    </section>

    <section class="intel-section">
      <h4 class="intel-section-label">${t('intelWhyItMatters')}</h4>
      <p class="intel-text intel-text-muted">${esc(d.why_it_matters || '—')}</p>
    </section>

    <section class="intel-section">
      <h4 class="intel-section-label">${t('intelKeyDynamics')}</h4>
      <div class="intel-tags">${tags || '<span class="intel-no-data">—</span>'}</div>
    </section>

    <section class="intel-section intel-section-row">
      <div>
        <h4 class="intel-section-label">${t('intelRiskLevel')}</h4>
        <span class="intel-risk-badge ${risk.cls}">${risk.label}</span>
      </div>
      <div>
        <h4 class="intel-section-label">${t('intelConfidence')}</h4>
        <span class="intel-confidence">${esc(confidenceLabel(d.confidence_level))}</span>
      </div>
    </section>

    <section class="intel-section">
      <h4 class="intel-section-label">${t('intelOutlook')}</h4>
      <p class="intel-text">${esc(d.short_term_outlook || '—')}</p>
    </section>`;
}

function esc(str) {
  const el = document.createElement('span');
  el.textContent = String(str);
  return el.innerHTML;
}

// ─── Panel open / close ───────────────────────────────────────────────────────
export function openIntelPanel() {
  const panel = document.getElementById('intelPanel');
  const backdrop = document.getElementById('intelBackdrop');
  if (!panel || !backdrop) return;

  _panelOpen = true;
  backdrop.classList.add('visible');
  panel.classList.add('open');
  document.body.classList.add('intel-open');

  translatePanelUI();
  triggerFetch(0);

  // Auto-refresh latest every 3 hours while panel is open
  clearInterval(_refreshTimer);
  _refreshTimer = setInterval(() => {
    if (_panelOpen && _historyIndex === 0) {
      delete _historyCaches[`${lang()}:0`];
      triggerFetch(0);
    }
  }, AUTO_REFRESH);
}

export function closeIntelPanel() {
  const panel = document.getElementById('intelPanel');
  const backdrop = document.getElementById('intelBackdrop');
  if (!panel || !backdrop) return;

  _panelOpen = false;
  panel.classList.remove('open');
  backdrop.classList.remove('visible');
  document.body.classList.remove('intel-open');

  clearInterval(_refreshTimer);
  clearInterval(_secondsTimer);
}

// ─── Translate all static panel UI strings ────────────────────────────────────
function translatePanelUI() {
  const title = document.querySelector('.intel-panel-title');
  const ts    = document.getElementById('intelTimestamp');
  const intelBtn = document.getElementById('intelBtn');
  const refreshBtn = document.getElementById('intelRefreshBtn');
  const closeBtn   = document.getElementById('intelCloseBtn');

  if (title) {
    // Keep the SVG icon, replace the text node
    const svg = title.querySelector('svg');
    title.textContent = t('intelPanelTitle');
    if (svg) title.prepend(svg);
  }
  if (intelBtn) {
    const svg = intelBtn.querySelector('svg');
    const span = intelBtn.querySelector('span');
    if (span) span.textContent = t('intelBtn');
    intelBtn.setAttribute('aria-label', t('intelBtn'));
  }
  if (refreshBtn) refreshBtn.title = t('intelRefreshTitle');
  if (closeBtn)   closeBtn.title   = t('intelCloseTitle');

  // Update history nav labels
  updateHistoryNav();

  // Re-render cached data in new language if available
  const cached = _historyCaches[`${lang()}:${_historyIndex}`];
  if (cached) renderData(cached.data);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
export function initIntelPanel() {
  const backdrop   = document.getElementById('intelBackdrop');
  const closeBtn   = document.getElementById('intelCloseBtn');
  const refreshBtn = document.getElementById('intelRefreshBtn');

  closeBtn?.addEventListener('click', closeIntelPanel);
  backdrop?.addEventListener('click', closeIntelPanel);

  refreshBtn?.addEventListener('click', () => {
    _historyIndex = 0;
    delete _historyCaches[`${lang()}:0`];
    triggerFetch(0);
  });

  // History nav
  document.getElementById('intelOlderBtn')?.addEventListener('click', () => {
    if (_historyIndex < _historyTotal - 1) {
      _historyIndex++;
      triggerFetch(_historyIndex);
    }
  });
  document.getElementById('intelNewerBtn')?.addEventListener('click', () => {
    if (_historyIndex > 0) {
      _historyIndex--;
      triggerFetch(_historyIndex);
    }
  });

  // Keyboard: Escape closes
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _panelOpen) closeIntelPanel();
  });

  // Re-translate UI and re-fetch in new language on lang toggle
  onLangChange(() => {
    _historyIndex  = 0;
    _historyTotal  = 1;
    _historyCaches = {};
    translatePanelUI();
    headerBarLoading();
    if (_panelOpen) {
      triggerFetch(0);
    }
  });

  // Set initial translated strings
  translatePanelUI();

  // Wire header bar click → open panel
  document.getElementById('headerIntelBar')?.addEventListener('click', openIntelPanel);

  // Show loading state immediately so the bar is never empty
  headerBarLoading();

  // Fetch immediately — server cache is likely warm, so this is fast
  fetchIntelligence();
}
