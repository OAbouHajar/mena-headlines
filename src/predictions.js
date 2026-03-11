/**
 * AI Challenge — daily predictive poll with AI pick.
 * Shows a compact trigger button above chat input → opens popup.
 * Full slide-over panel available via the header #predBtn.
 */
import { t, lang, onLangChange } from './i18n.js';

const $ = (id) => document.getElementById(id);

// ─── State ─────────────────────────────────────────────────────────────────────
let _pollData  = null;
let _popupOpen = false;
let _panelOpen = false;
let _fetchTimer = null;

const _anonId = (() => {
  const stored = localStorage.getItem('pred-anon-id');
  if (stored) return stored;
  const id = Math.random().toString(36).slice(2, 10);
  localStorage.setItem('pred-anon-id', id);
  return id;
})();

function _todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

function _getVote() {
  return localStorage.getItem(`pred-vote-${_todayKey()}`);
}

// ─── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchPrediction() {
  try {
    const res = await fetch(`/api/predictions?lang=${lang()}&anonId=${encodeURIComponent(_anonId)}`);
    if (!res.ok) return;
    const data = await res.json();
    _pollData = data;
    renderAll();
  } catch { /* silent */ }
}

// ─── Vote ──────────────────────────────────────────────────────────────────────
async function castVote(vote) {
  if (_getVote()) return;
  localStorage.setItem(`pred-vote-${_todayKey()}`, vote);
  renderAll();
  try {
    const res = await fetch('/api/predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anonId: _anonId, vote, lang: lang() }),
    });
    if (res.ok) {
      const data = await res.json();
      _pollData = { ..._pollData, ...data };
      renderAll();
    }
  } catch { /* silent */ }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function expiryHtml(expiresAt) {
  if (!expiresAt) return '';
  const h = Math.round((new Date(expiresAt) - Date.now()) / 3_600_000);
  if (h <= 0) return `<span class="pred-expiry expired">${t('predExpired')}</span>`;
  return h < 24
    ? `<span class="pred-expiry">${t('predExpiresHours', h)}</span>`
    : `<span class="pred-expiry">${t('predExpiresDays', Math.round(h / 24))}</span>`;
}

function voteBlockHtml(yesCount, noCount, compact = false) {
  const userVote = _getVote();
  const total    = yesCount + noCount;
  const yesPct   = total ? Math.round((yesCount / total) * 100) : 50;
  const noPct    = 100 - yesPct;
  const voted    = !!userVote;

  return `
    <div class="pred-votes${voted ? ' voted' : ''}">
      <button class="pred-vote-btn yes${userVote === 'yes' ? ' chosen' : ''}" data-vote="yes">
        ${t('predYes')}${voted ? `<span class="pred-vote-pct">${yesPct}%</span>` : ''}
      </button>
      <button class="pred-vote-btn no${userVote === 'no' ? ' chosen' : ''}" data-vote="no">
        ${t('predNo')}${voted ? `<span class="pred-vote-pct">${noPct}%</span>` : ''}
      </button>
    </div>
    ${voted ? `<div class="pred-bar"><div class="pred-bar-fill yes" style="width:${yesPct}%"></div></div>` : ''}
    ${voted && !compact ? `<p class="pred-total-votes">${total.toLocaleString()} ${t('predVotesTotal')}</p>` : ''}
  `;
}

// ─── Render ────────────────────────────────────────────────────────────────────
function renderAll() {
  renderTrigger();
  renderPopup();
  renderPanel();
}

function renderTrigger() {
  const btn = $('chatPollTriggerBtn');
  if (!btn) return;
  if (!_pollData?.question) { btn.hidden = true; return; }
  btn.hidden = false;
  const aiSpan = btn.querySelector('.chat-poll-ai-badge');
  if (aiSpan) aiSpan.textContent = _pollData.aiPick;
}

function renderPopup() {
  const body = $('chatPollBody');
  if (!body) return;

  if (!_pollData?.question) {
    body.innerHTML = `<p class="pred-no-active">${t('predNoActive')}</p>`;
    return;
  }

  const { question, aiPick, aiReason, yesCount = 0, noCount = 0, expiresAt } = _pollData;

  body.innerHTML = `
    <div class="pred-question">${escHtml(question)}</div>
    ${expiryHtml(expiresAt)}
    <div class="pred-ai-pick">
      <span class="pred-ai-badge">${t('predAiPicked')}</span>
      <strong class="pred-ai-answer">${escHtml(aiPick)}</strong>
    </div>
    ${aiReason ? `<p class="pred-ai-reason">${escHtml(aiReason)}</p>` : ''}
    ${voteBlockHtml(yesCount, noCount, true)}
    <div class="pred-actions">
      <button class="pred-expand-btn" id="predExpandBtn">${t('predSeeAnalysis')}</button>
      <button class="pred-share-btn" id="predShareBtn">${t('predShare')}</button>
    </div>
  `;

  body.querySelectorAll('.pred-vote-btn').forEach(b => {
    b.addEventListener('click', () => { if (!_getVote()) castVote(b.dataset.vote); });
  });
  $('predExpandBtn')?.addEventListener('click', () => { closeChatPoll(); openPredPanel(); });
  $('predShareBtn')?.addEventListener('click',  shareChallenge);
}

function renderPanel() {
  const body = $('predBody');
  if (!body) return;

  if (!_pollData?.question) {
    body.innerHTML = `<p class="pred-no-active" style="padding:2rem">${t('predNoActive')}</p>`;
    return;
  }

  const { question, aiPick, aiReason, yesCount = 0, noCount = 0, expiresAt } = _pollData;

  body.innerHTML = `
    <div class="pred-panel-card">
      <div class="pred-panel-badge">${t('predBadge')}</div>
      ${expiryHtml(expiresAt)}
      <div class="pred-panel-question">${escHtml(question)}</div>
      <div class="pred-panel-ai-wrap">
        <span class="pred-panel-ai-label">${t('predAiPicked')}</span>
        <strong class="pred-panel-ai-answer">${escHtml(aiPick)}</strong>
      </div>
      ${aiReason ? `<p class="pred-panel-reason">${escHtml(aiReason)}</p>` : ''}
      ${voteBlockHtml(yesCount, noCount, false)}
      <div class="pred-actions" style="margin-top:12px">
        <button class="pred-share-btn" id="predPanelShareBtn">${t('predShare')}</button>
      </div>
    </div>
  `;

  body.querySelectorAll('.pred-vote-btn').forEach(b => {
    b.addEventListener('click', () => { if (!_getVote()) castVote(b.dataset.vote); });
  });
  $('predPanelShareBtn')?.addEventListener('click', shareChallenge);
}

// ─── Share ─────────────────────────────────────────────────────────────────────
async function shareChallenge() {
  const { question, aiPick } = _pollData || {};
  if (!question) return;
  const text = t('predShareText', question, aiPick);
  let copied = false;
  if (navigator.share) {
    try { await navigator.share({ title: t('predShareTitle'), text }); return; } catch { /* fallback */ }
  }
  try { await navigator.clipboard.writeText(text); copied = true; } catch { /* silent */ }
  const shareBtn = document.getElementById('predShareBtn') || document.getElementById('predPanelShareBtn');
  if (shareBtn && copied) {
    const orig = shareBtn.textContent;
    shareBtn.textContent = t('predShareCopied');
    setTimeout(() => { shareBtn.textContent = orig; }, 2000);
  }
}

// ─── Panel open/close ─────────────────────────────────────────────────────────
export function openPredPanel() {
  const panel    = $('predPanel');
  const backdrop = $('predBackdrop');
  if (!panel || !backdrop) return;
  _panelOpen = true;
  panel.classList.add('open');
  backdrop.classList.add('visible');
  document.body.classList.add('pred-open');
  renderPanel();
}

export function closePredPanel() {
  const panel    = $('predPanel');
  const backdrop = $('predBackdrop');
  if (!panel || !backdrop) return;
  _panelOpen = false;
  panel.classList.remove('open');
  backdrop.classList.remove('visible');
  document.body.classList.remove('pred-open');
}

export function togglePredPanel() {
  _panelOpen ? closePredPanel() : openPredPanel();
}

// ─── Popup open/close ─────────────────────────────────────────────────────────
export function openChatPoll() {
  const popup   = $('chatPollPopup');
  const trigger = $('chatPollTriggerBtn');
  if (!popup) return;
  _popupOpen = true;
  popup.hidden = false;
  // Let the browser render display:flex before adding .open so the transition fires
  requestAnimationFrame(() => popup.classList.add('open'));
  trigger?.classList.add('active');
  renderPopup();
}

export function closeChatPoll() {
  const popup   = $('chatPollPopup');
  const trigger = $('chatPollTriggerBtn');
  if (!popup) return;
  _popupOpen = false;
  popup.classList.remove('open');
  trigger?.classList.remove('active');
  // Wait for transition to finish before hiding
  popup.addEventListener('transitionend', () => { popup.hidden = true; }, { once: true });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
export function initPredictions() {
  const triggerBtn = $('chatPollTriggerBtn');
  const closePopup = $('chatPollCloseBtn');
  const closePanel = $('predCloseBtn');
  const backdrop   = $('predBackdrop');

  triggerBtn?.addEventListener('click', () => {
    _popupOpen ? closeChatPoll() : openChatPoll();
  });
  closePopup?.addEventListener('click', closeChatPoll);
  closePanel?.addEventListener('click', closePredPanel);
  backdrop?.addEventListener('click', closePredPanel);

  // Close popup when clicking outside
  document.addEventListener('click', (e) => {
    if (!_popupOpen) return;
    const popup   = $('chatPollPopup');
    const trigger = $('chatPollTriggerBtn');
    if (popup && !popup.contains(e.target) && trigger && !trigger.contains(e.target)) {
      closeChatPoll();
    }
  });

  // Re-render on language change
  onLangChange(() => renderAll());

  // Initial fetch + 60s polling
  fetchPrediction();
  _fetchTimer = setInterval(fetchPrediction, 60_000);
}
