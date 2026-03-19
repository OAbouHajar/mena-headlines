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
    _briefLoaded = false;
    _mbHistoryCaches = {};
    _mbHistoryIndex = 0;
  });
}

export function toggleStatsPanel() {
  const panel = document.getElementById('statsPanel');
  const btn = document.getElementById('statsBtn');
  const btnMobile = document.getElementById('statsBtnMobile');
  if (!panel) return;
  const opening = panel.classList.contains('closed');
  panel.classList.toggle('closed');
  panel.classList.toggle('mobile-open', opening);
  btn?.classList.toggle('active', opening);
  btnMobile?.classList.toggle('active', opening);
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

  function buildCountryTable() {
    const maxVal = Math.max(...data.countries.map(c => Math.max(c.n, c.todayTotal || 0)), 1);

    const header = `
      <div class="flt-table-head">
        <span></span>
        <span></span>
        <span></span>
        <span class="flt-th flt-th-total">${t('flightToday')}</span>
      </div>`;

    const rows = [...data.countries].sort((a, b) => {
      const aN = Math.max(a.n, a.todayTotal || 0);
      const bN = Math.max(b.n, b.todayTotal || 0);
      return bN - aN;
    }).map(c => {
      const todayN   = Math.max(c.n, c.todayTotal || 0);
      const barW     = todayN > 0 ? Math.max(4, Math.round(todayN / maxVal * 100)) : 0;
      const isZero   = todayN === 0;
      const totalCell = todayN > 0 ? todayN : '—';
      return `
        <div class="flt-table-row${isZero ? ' flt-zero' : ''}">
          <span class="flight-country-flag">${c.flag}</span>
          <span class="flight-country-name">${isAr ? c.ar : (c.en || c.ar)}</span>
          <span class="flight-country-bar-wrap">
            <span class="flight-country-bar" style="width:${barW}%"></span>
          </span>
          <span class="flt-col-total">${totalCell}</span>
        </div>`;
    }).join('');

    return header + rows;
  }

  body.innerHTML = `
    <div class="stats-section">
      <p class="flight-hero-desc">${t('flightHeroDesc')}</p>
      <div class="stats-cards-row">
        <div class="stat-card flight-today-card">
          <div class="stat-hero-value">${totalToday.toLocaleString()}</div>
          <div class="stat-card-label">✈️ ${t('flightToday')}</div>
        </div>
      </div>
    </div>
    <div class="stats-section">
      <div class="flight-section-header">
        <span class="stats-section-title" style="margin:0">${t('flightByCountry')}</span>
      </div>
      <div class="flight-countries" id="flightCountriesBody">
        ${buildCountryTable()}
      </div>
    </div>
    <div class="flight-update-time">${t('flightLastUpdate')}: ${new Date().toLocaleTimeString(isAr ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</div>
  `;
}

export function toggleFlightPanel() {
  const panel = document.getElementById('flightPanel');
  const btn   = document.getElementById('flightBtn');
  const btnMobile = document.getElementById('flightBtnMobile');
  if (!panel) return;
  const opening = panel.classList.contains('closed');
  panel.classList.toggle('closed');
  panel.classList.toggle('mobile-open', opening);
  btn?.classList.toggle('active', opening);
  btnMobile?.classList.toggle('active', opening);
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
  const body = document.getElementById('statsContent');
  if (!body) return;
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

// ---------------------------------------------------------------------------
// AI Market Analyst — with versioned history + news-driven analysis
// ---------------------------------------------------------------------------

let _briefLoaded = false;
let _mbHistoryIndex = 0;
let _mbHistoryTotal = 1;
let _mbHistoryCaches = {};   // keyed "lang:index" → data
let _mbPrices = null;        // fallback prices for client-side brief

function _briefCacheKey() {
  const now = Date.now();
  const boundary = (() => {
    const d = new Date();
    const b = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 21, 30, 0);
    return now >= b ? b : b - 86400000;
  })();
  return `market-brief:${lang()}:${boundary}`;
}

async function loadMarketBrief(prices, historyIndex = 0) {
  const el = document.getElementById('priceCommentaryEl');
  if (!el) return;
  _mbPrices = prices || _mbPrices;

  // Show skeleton
  el.innerHTML = `<div class="mb-loading"><span class="stats-skeleton" style="width:60%;height:11px;display:block;margin-bottom:6px"></span><span class="stats-skeleton" style="width:85%;height:11px;display:block"></span></div>`;

  // Check client-side cache (for historical: forever; for latest: daily boundary)
  const cacheKey = `${lang()}:${historyIndex}`;
  const cached = _mbHistoryCaches[cacheKey];
  if (cached) {
    _mbHistoryIndex = historyIndex;
    renderMarketBrief(cached);
    return;
  }

  // Also check localStorage for latest
  if (historyIndex === 0) {
    const lsKey = _briefCacheKey();
    try {
      const lsCached = JSON.parse(localStorage.getItem(lsKey) || 'null');
      if (lsCached) {
        _mbHistoryCaches[cacheKey] = lsCached;
        if (typeof lsCached._historyTotal === 'number') _mbHistoryTotal = lsCached._historyTotal;
        _mbHistoryIndex = 0;
        renderMarketBrief(lsCached);
        return;
      }
    } catch { /* corrupt */ }
  }

  try {
    let resp;
    if (historyIndex > 0) {
      resp = await fetch('/api/market-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: lang(), historyIndex }),
      });
    } else {
      resp = await fetch(`/api/market-brief?lang=${lang()}`);
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    // Update history state
    if (typeof data._historyTotal === 'number') _mbHistoryTotal = data._historyTotal;
    _mbHistoryIndex = historyIndex;

    // Cache
    _mbHistoryCaches[cacheKey] = data;
    if (historyIndex === 0) {
      try { localStorage.setItem(_briefCacheKey(), JSON.stringify(data)); } catch { /* full */ }
    }

    renderMarketBrief(data);
  } catch (err) {
    console.warn('[market-brief] API unavailable, using client fallback:', err.message);
    if (historyIndex === 0) {
      try {
        const hResp = await fetch('/api/commodity-history');
        const history = hResp.ok ? await hResp.json() : null;
        renderMarketBriefFallback(_mbPrices, history);
      } catch {
        renderMarketBriefFallback(_mbPrices, null);
      }
    } else {
      el.innerHTML = `<div class="mb-error">${t('marketBriefError')}</div>`;
    }
  }
}

function renderMarketBriefFallback(prices, history) {
  const el = document.getElementById('priceCommentaryEl');
  if (!el) return;
  if (!prices) { el.innerHTML = ''; return; }

  const isAr = lang() === 'ar';
  const { oil, brent, gold, natgas } = prices;

  const pageHls = [];
  document.querySelectorAll('.ticker-item .ticker-text, .update-headline').forEach(n => {
    const tx = n.textContent.trim();
    if (tx.length > 25 && tx.length < 180) pageHls.push(tx);
  });
  const hlStr = pageHls.join(' ');

  const geo = {
    midEast:  /iran|israel|gaza|lebanon|houthi|yemen|syria|iraq|saudi|hormuz/i.test(hlStr),
    conflict: /war|attack|strike|bomb|missile|military|conflict|ceasefire|offensive/i.test(hlStr),
    macro:    /fed|rate|inflation|dollar|reserve|interest|hike|cut|tariff/i.test(hlStr),
    opec:     /opec|quota|production.?cut|barrel/i.test(hlStr),
  };
  const oilHl  = pageHls.find(h => /iran|opec|saudi|oil|pipeline|hormuz|houthi|energy/i.test(h));
  const goldHl = pageHls.find(h => /war|fed|rate|inflation|dollar|attack|conflict|sanction|gold/i.test(h));

  function trend(series) {
    if (!series || series.length < 4) return null;
    const v = series.map(p => p.close).filter(Boolean);
    if (v.length < 4) return null;
    const n  = Math.max(2, Math.floor(v.length / 5));
    const a0 = v.slice(0, n).reduce((a, b) => a + b) / n;
    const aN = v.slice(-n).reduce((a, b) => a + b) / n;
    const pct = ((aN - a0) / a0) * 100;
    const max = Math.max(...v), min = Math.min(...v), cur = v[v.length - 1];
    return {
      pct: +pct.toFixed(1), max: +max.toFixed(2), min: +min.toFixed(2),
      nearHigh: cur >= max * 0.975,
      nearLow:  cur <= min * 1.025,
      dir: pct > 2 ? 'up' : pct < -2 ? 'down' : 'flat',
    };
  }

  const oT = trend(history?.oil);
  const gT = trend(history?.gold);
  const nT = trend(history?.natgas);

  function outlook(price, t) {
    const dir = price && t ? (t.dir === 'up' && price.changePct > 0 ? 'up' : t.dir === 'down' && price.changePct < 0 ? 'down' : 'sideways') : (price?.changePct > 0 ? 'up' : price?.changePct < 0 ? 'down' : 'sideways');
    const conviction = (t?.nearHigh || t?.nearLow || Math.abs(price?.changePct || 0) > 2) ? 'moderate' : 'low';
    return { dir, conviction };
  }

  const ctx = { oil, brent, gold, natgas, oT, gT, nT, geo, oilHl, goldHl,
    oOut: outlook(oil, oT), gOut: outlook(gold, gT), nOut: outlook(natgas, nT) };

  el.innerHTML = isAr ? buildBriefAr(ctx) : buildBriefEn(ctx);
}

function buildBriefEn({ oil, brent, gold, natgas, oT, gT, nT, geo, oilHl, goldHl, oOut, gOut, nOut }) {
  const paras = [];

  if (oil) {
    const dir = oil.changePct >= 0 ? 'up' : 'down';
    const pct = Math.abs(oil.changePct).toFixed(2);
    let s = `Oil prices went ${dir} ${pct}% today — now at $${oil.price} a barrel.`;
    if (brent) {
      const sp = (brent.price - oil.price).toFixed(2);
      s += ` European oil (Brent) is at $${brent.price}, so the gap between the two is $${sp}.`;
    }
    paras.push(s);
    if (oT) {
      const tr = oT.dir === 'up' ? `been going up ${oT.pct}%` : oT.dir === 'down' ? `been going down ${Math.abs(oT.pct)}%` : `stayed pretty flat`;
      let s2 = `Over the past month, oil has ${tr}, bouncing between $${oT.min} and $${oT.max}.`;
      if (oT.nearHigh) s2 += ' Right now it is near its highest point this month — prices are being pushed up.';
      else if (oT.nearLow) s2 += ' Right now it is near its lowest point this month — a critical moment.';
      paras.push(s2);
    }
    if (oilHl) {
      paras.push(`News like "${oilHl.slice(0, 90)}${oilHl.length > 90 ? '…' : ''}" is one of the main reasons oil prices move.`);
    } else if (geo.midEast || geo.opec) {
      paras.push(geo.opec
        ? `OPEC countries (the big oil producers) are controlling how much oil they sell — this keeps prices from falling too much.`
        : `Tensions in the Middle East are making oil more expensive because people worry about supply being disrupted. When there is conflict near oil-producing regions, prices go up.`);
    }
  }

  if (gold) {
    const gdir = gold.changePct >= 0 ? 'up' : 'down';
    let s = `Gold went ${gdir} ${Math.abs(gold.changePct).toFixed(2)}% today, now at $${gold.price.toLocaleString()} per ounce.`;
    if (gold.price >= 5000) s += ' This is exceptionally high — gold at $5,000+ means a lot of people around the world are nervous and buying gold to protect their money. When people are scared about the economy or wars, they rush to gold.';
    else if (gold.price >= 3000) s += ' Gold above $3,000 is historically very high — it usually means people are worried about something big: wars, economic problems, or political uncertainty.';
    paras.push(s);
    if (gT) {
      const gr = gT.dir === 'up' ? `been rising ${gT.pct}%` : gT.dir === 'down' ? `dropped ${Math.abs(gT.pct)}%` : `stayed in the same range`;
      let s2 = `Over the past month, gold has ${gr}, moving between $${gT.min.toLocaleString()} and $${gT.max.toLocaleString()}.`;
      if (gT.nearHigh) s2 += ' It is currently near its highest point this month — the trend is still going up.';
      paras.push(s2);
    }
    if (goldHl) {
      paras.push(`Events like "${goldHl.slice(0, 90)}${goldHl.length > 90 ? '…' : ''}" are exactly why people buy gold right now — it is their way of keeping their money safe.`);
    } else if (geo.conflict || geo.macro) {
      paras.push(geo.conflict
        ? `The ongoing conflict in the region is the main reason gold is high. In times of war or instability, people worldwide move their savings into gold — it is the oldest "safe" investment.`
        : `When central banks like the US Federal Reserve change interest rates, gold reacts strongly. Right now, nobody is sure what they will do next — so gold goes up.`);
    }
  }

  if (natgas && Math.abs(natgas.changePct) > 1.5) {
    paras.push(`Natural gas (used for heating and electricity) went ${natgas.changePct > 0 ? 'up' : 'down'} ${Math.abs(natgas.changePct).toFixed(2)}% today to $${natgas.price}${Math.abs(natgas.changePct) > 3 ? ' — a big move. Worth keeping an eye on.' : '.'}`);
  }

  const rows = [];
  if (oil) {
    const r = oT?.nearHigh ? 'Oil is near its monthly peak. It could keep going up, but a pullback is also possible.' : oT?.nearLow ? 'Oil is near its monthly low. It could bounce back, or drop further if bad news comes.' : 'No strong monthly trend yet — today was positive but wait and see what happens next.';
    rows.push({ asset: 'WTI Oil', dir: oOut.dir, conv: oOut.conviction, reason: r });
  }
  if (gold) {
    const r = gold.price >= 5000 ? 'Very high by any standard. If peace breaks out or things calm down politically, gold could drop fast. But if tensions stay, it could go even higher.' : gT?.dir === 'up' ? 'The trend has been going up. As long as there is uncertainty in the world, gold tends to stay strong.' : 'High but not moving much — could go either way depending on what happens next politically.';
    rows.push({ asset: 'Gold', dir: gOut.dir, conv: gOut.conviction, reason: r });
  }
  if (natgas) {
    rows.push({ asset: 'Natural Gas', dir: nOut.dir, conv: 'low', reason: 'Gas prices depend a lot on the weather and the season. Hard to predict. Do not read too much into short-term moves.' });
  }

  const watch = geo.midEast && geo.conflict
    ? 'If the conflict spreads near major oil shipping routes (like the Strait of Hormuz), both oil and gold prices could spike sharply overnight.'
    : geo.opec ? 'If OPEC decides to cut oil production, prices will go up quickly. If they increase supply, prices may drop.'
    : geo.macro ? 'The next US interest rate decision is the key event to watch — it will move gold, the dollar, and stock markets at the same time.'
    : 'A surprise conflict or political crisis in the Middle East is always a risk that markets are not fully pricing in.';

  const dirL = d => d === 'up' ? '↑ Going up' : d === 'down' ? '↓ Going down' : '→ Holding steady';
  const convL = c => c === 'high' ? 'Pretty confident' : c === 'moderate' ? 'Somewhat confident' : 'Hard to say';
  const rowsHtml = rows.map(r => `
    <div class="mb-row">
      <span class="mb-asset">${r.asset}</span>
      <span class="mb-dir mb-${r.dir}">${dirL(r.dir)}</span>
      <span class="mb-conviction">${convL(r.conv)}</span>
      <span class="mb-reason">${r.reason}</span>
    </div>`).join('');

  return `<div class="market-brief">
    <div class="mb-header"><span class="mb-title">Today's Market Breakdown</span><span class="mb-disclaimer">Analyst view only — not financial advice.</span></div>
    <p class="mb-commentary">${paras.join(' ')}</p>
    ${rowsHtml ? `<div class="mb-outlook">${rowsHtml}</div>` : ''}
    <p class="mb-watch"><strong>👁 Thing to watch:</strong> ${watch}</p>
  </div>`;
}

function buildBriefAr({ oil, brent, gold, natgas, oT, gT, nT, geo, oilHl, goldHl, oOut, gOut, nOut }) {
  const paras = [];

  if (oil) {
    const dir = oil.changePct >= 0 ? 'ارتفع' : 'انخفض';
    const pct = Math.abs(oil.changePct).toFixed(2);
    let s = `أسعار النفط ${dir} ${pct}% اليوم — السعر الآن $${oil.price} للبرميل.`;
    if (brent) {
      const sp = (brent.price - oil.price).toFixed(2);
      s += ` النفط الأوروبي (برنت) عند $${brent.price}، والفرق بين النوعين $${sp}.`;
    }
    paras.push(s);
    if (oT) {
      const tr = oT.dir === 'up' ? `ارتفع ${oT.pct}%` : oT.dir === 'down' ? `انخفض ${Math.abs(oT.pct)}%` : `بقي في نطاق ضيق`;
      let s2 = `خلال الشهر الماضي، النفط ${tr} بين $${oT.min} و$${oT.max}.`;
      if (oT.nearHigh) s2 += ' حالياً هو قريب من أعلى نقطة في الشهر — الضغط على الارتفاع واضح.';
      else if (oT.nearLow) s2 += ' حالياً قريب من أدنى نقطة في الشهر — لحظة حاسمة.';
      paras.push(s2);
    }
    if (oilHl) {
      paras.push(`أخبار مثل "${oilHl.slice(0, 90)}${oilHl.length > 90 ? '…' : ''}" هي أحد الأسباب الرئيسية التي تحرك أسعار النفط.`);
    } else if (geo.midEast || geo.opec) {
      paras.push(geo.opec
        ? `دول أوبك (كبار منتجي النفط) تتحكم في كمية النفط المعروضة في السوق — هذا يمنع الأسعار من الانخفاض الكبير.`
        : `التوترات في الشرق الأوسط ترفع أسعار النفط لأن الناس يخشون انقطاع الإمدادات. كلما اشتد التوتر بالقرب من مناطق الإنتاج، ارتفعت الأسعار.`);
    }
  }

  if (gold) {
    const dir = gold.changePct >= 0 ? 'ارتفع' : 'انخفض';
    let s = `الذهب ${dir} ${Math.abs(gold.changePct).toFixed(2)}% اليوم، والسعر الآن $${gold.price.toLocaleString()} للأونصة.`;
    if (gold.price >= 5000) s += ' هذا مستوى استثنائي جداً. الذهب فوق $5000 يعني أن كثيراً من الناس حول العالم قلقون ويشترون الذهب لحماية أموالهم. في أوقات الحروب والأزمات، يهرب الناس للذهب.';
    else if (gold.price >= 3000) s += ' الذهب فوق $3000 تاريخياً مرتفع جداً — عادةً يعني أن الناس قلقون من شيء كبير: حروب، أزمات اقتصادية، أو عدم استقرار سياسي.';
    paras.push(s);
    if (gT) {
      const gr = gT.dir === 'up' ? `كان يرتفع ${gT.pct}%` : gT.dir === 'down' ? `انخفض ${Math.abs(gT.pct)}%` : `بقي في نفس النطاق`;
      let s2 = `خلال الشهر الماضي، الذهب ${gr} بين $${gT.min.toLocaleString()} و$${gT.max.toLocaleString()}.`;
      if (gT.nearHigh) s2 += ' حالياً قريب من أعلى نقطة هذا الشهر — الاتجاه لا يزال صاعداً.';
      paras.push(s2);
    }
    if (goldHl) {
      paras.push(`أحداث مثل "${goldHl.slice(0, 90)}${goldHl.length > 90 ? '…' : ''}" هي بالضبط السبب الذي يجعل الناس يشترون الذهب الآن — طريقتهم لحماية مدخراتهم.`);
    } else if (geo.conflict || geo.macro) {
      paras.push(geo.conflict
        ? `النزاع الجاري في المنطقة هو السبب الرئيسي لارتفاع الذهب. في أوقات عدم الاستقرار، يضع الناس مدخراتهم في الذهب — أقدم استثمار آمن في التاريخ.`
        : `قرارات البنك المركزي الأمريكي بشأن أسعار الفائدة تؤثر مباشرة على الذهب. حين لا يعرف أحد ماذا سيقرر، يرتفع الذهب.`);
    }
  }

  if (natgas && Math.abs(natgas.changePct) > 1.5) {
    paras.push(`الغاز الطبيعي (المستخدم في التدفئة والكهرباء) ${natgas.changePct > 0 ? 'ارتفع' : 'انخفض'} ${Math.abs(natgas.changePct).toFixed(2)}% اليوم إلى $${natgas.price}${Math.abs(natgas.changePct) > 3 ? ' — تحرك كبير. يستحق المتابعة.' : '.'}`);
  }

  const rows = [];
  if (oil) {
    const r = oT?.nearHigh ? 'النفط قريب من أعلى نقطة شهرية. قد يستمر في الارتفاع، لكن تراجع مؤقت ممكن أيضاً.' : oT?.nearLow ? 'النفط قريب من أدنى نقطة شهرية. قد يرتد للأعلى، أو يواصل الانخفاض إذا جاءت أخبار سيئة.' : 'لم يتضح اتجاه واضح هذا الشهر — اليوم كان إيجابياً، لكن انتظر لترى ما يأتي غداً.';
    rows.push({ asset: 'نفط WTI', dir: oOut.dir, conv: oOut.conviction, reason: r });
  }
  if (gold) {
    const r = gold.price >= 5000 ? 'مرتفع جداً تاريخياً. إذا تحسن الوضع سياسياً أو انخفضت الفائدة، قد ينخفض الذهب بسرعة. لكن طالما التوترات مستمرة، قد يواصل الارتفاع.' : gT?.dir === 'up' ? 'الاتجاه صاعد. طالما العالم غير مستقر، الذهب يميل للارتفاع.' : 'مرتفع لكن لا يتحرك كثيراً — الاتجاه التالي يعتمد على المستجدات السياسية.';
    rows.push({ asset: 'الذهب', dir: gOut.dir, conv: gOut.conviction, reason: r });
  }
  if (natgas) {
    rows.push({ asset: 'الغاز الطبيعي', dir: nOut.dir, conv: 'low', reason: 'أسعار الغاز تتأثر كثيراً بالطقس والموسم. صعب التنبؤ به. لا تتخذ قرارات كبيرة بناءً على تحركاته.' });
  }

  const watch = geo.midEast && geo.conflict
    ? 'إذا امتد النزاع نحو مناطق شحن النفط الكبرى (كمضيق هرمز)، سترتفع أسعار النفط والذهب بشكل حاد بين ليلة وضحاها.'
    : geo.opec ? 'إذا قررت أوبك خفض إنتاج النفط، سترتفع الأسعار بسرعة. وإذا زادت الإنتاج، قد تنخفض.'
    : geo.macro ? 'القرار القادم بشأن أسعار الفائدة الأمريكية هو الحدث الأهم — سيحرك الذهب والدولار والأسواق في وقت واحد.'
    : 'أزمة سياسية أو صراع مفاجئ في الشرق الأوسط هو الخطر الأكبر الذي لا تأخذه الأسواق بجدية كافية حالياً.';

  const dirL  = d => d === 'up' ? '↑ صاعد' : d === 'down' ? '↓ هابط' : '→ مستقر';
  const convL = c => c === 'high' ? 'ثقة عالية' : c === 'moderate' ? 'ثقة متوسطة' : 'صعب التوقع';
  const rowsHtml = rows.map(r => `
    <div class="mb-row">
      <span class="mb-asset">${r.asset}</span>
      <span class="mb-dir mb-${r.dir}">${dirL(r.dir)}</span>
      <span class="mb-conviction">${convL(r.conv)}</span>
      <span class="mb-reason">${r.reason}</span>
    </div>`).join('');

  return `<div class="market-brief">
    <div class="mb-header"><span class="mb-title">تحليل السوق اليومي</span><span class="mb-disclaimer">رأي تحليلي — ليس نصيحة مالية</span></div>
    <p class="mb-commentary">${paras.join(' ')}</p>
    ${rowsHtml ? `<div class="mb-outlook">${rowsHtml}</div>` : ''}
    <p class="mb-watch"><strong>👁 الشيء المهم لمتابعته:</strong> ${watch}</p>
  </div>`;
}

function _mbHistoryLabel(index) {
  if (index === 0) return t('marketBriefNow');
  return t('marketBriefDaysAgo', index);
}

function _renderMbHistoryNav(el) {
  if (_mbHistoryTotal <= 1) return '';
  const dots = Array.from({ length: _mbHistoryTotal }, (_, i) => {
    const active = i === _mbHistoryIndex;
    const label  = _mbHistoryLabel(i);
    return `<button class="tl-dot${active ? ' tl-dot--active' : ''}" data-mb-hist="${i}" title="${label}">
      <span class="tl-pip"></span>
      <span class="tl-label">${label}</span>
    </button>`;
  });
  return `<div class="mb-history-nav"><div class="tl-track">${dots.join('')}</div></div>`;
}

function _bindMbHistoryNav(el) {
  el.querySelectorAll('[data-mb-hist]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.mbHist, 10);
      if (isNaN(idx) || idx === _mbHistoryIndex) return;
      loadMarketBrief(null, idx);
    });
  });
}

function renderMarketBrief(data) {
  const el = document.getElementById('priceCommentaryEl');
  if (!el || !data) return;

  const dirIcon = (d) => d === 'up' ? t('marketBriefUp') : d === 'down' ? t('marketBriefDown') : t('marketBriefSideways');
  const dirClass = (d) => d === 'up' ? 'mb-up' : d === 'down' ? 'mb-down' : 'mb-sideways';
  const convLabel = (c) => c === 'high' ? t('marketBriefHigh') : c === 'low' ? t('marketBriefLow') : t('marketBriefModerate');

  const outlook = Array.isArray(data.outlook) ? data.outlook.map(o => `
    <div class="mb-row">
      <span class="mb-asset">${o.asset}</span>
      <span class="mb-dir ${dirClass(o.direction)}">${dirIcon(o.direction)}</span>
      <span class="mb-conviction">${convLabel(o.conviction)}</span>
      <span class="mb-reason">${o.reason || ''}</span>
    </div>`).join('') : '';

  // Prediction review (self-evaluation of yesterday's call)
  const predReview = data.prediction_review
    ? `<div class="mb-pred-review">
        <div class="mb-pred-review-label">${t('marketBriefPredReview')}</div>
        <p class="mb-pred-review-text">${data.prediction_review}</p>
      </div>`
    : '';

  // News drivers (what moved markets)
  const drivers = Array.isArray(data.news_drivers) && data.news_drivers.length > 0
    ? `<div class="mb-news-drivers">
        <div class="mb-drivers-label">${t('marketBriefNewsDrivers')}</div>
        ${data.news_drivers.map(d => `
          <div class="mb-driver-row">
            <span class="mb-driver-event">📰 ${d.event}</span>
            <span class="mb-driver-impact">${d.impact}</span>
            ${Array.isArray(d.assets_affected) ? `<span class="mb-driver-assets">${d.assets_affected.join(', ')}</span>` : ''}
          </div>`).join('')}
      </div>`
    : '';

  // Pattern (multi-day trend)
  const pattern = data.pattern
    ? `<div class="mb-pattern">
        <span class="mb-pattern-label">${t('marketBriefPattern')}:</span> ${data.pattern}
      </div>`
    : '';

  // History navigation
  const histNav = _renderMbHistoryNav(el);

  el.innerHTML = `
    <div class="market-brief">
      <div class="mb-header">
        <span class="mb-title">${t('marketBriefTitle')}</span>
        <span class="mb-disclaimer">${t('marketBriefDisclaimer')}</span>
      </div>
      ${predReview}
      ${data.headline ? `<p class="mb-headline">${data.headline}</p>` : ''}
      ${drivers}
      ${data.commentary ? `<p class="mb-commentary">${data.commentary}</p>` : ''}
      ${outlook ? `<div class="mb-outlook">${outlook}</div>` : ''}
      ${pattern}
      ${data.watch ? `<p class="mb-watch"><strong>${t('marketBriefWatch')}:</strong> ${data.watch}</p>` : ''}
      ${histNav}
    </div>`;

  _bindMbHistoryNav(el);
}



function renderStats(container, data) {
  const { prices, stocks } = data;

  // Load AI brief once per day
  if (!_briefLoaded) {
    _briefLoaded = true;
    loadMarketBrief(prices);
  }

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
    const area = document.querySelector('.price-chart-inner');
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
      maintainAspectRatio: false,
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
