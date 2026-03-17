import { store } from './store.js';
import { GROUP_LABELS } from './channels.js';
import { t, toggleLang, onLangChange } from './i18n.js';
import { signInWithGoogle, signOutUser } from './firebase.js';
import { onAuthReady } from './sync.js';
import { NewsTicker } from './ticker.js';
import { initIntelPanel, openIntelPanel, closeIntelPanel } from './intelligence.js';
import { initStatsPanel, toggleStatsPanel, toggleFlightPanel } from './stats.js';
import { initPresence } from './presence.js';
import { initChat } from './chat.js';
import { initPredictions } from './predictions.js';

// ============ DOM References ============
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const sidebar = $('#sidebar');
const channelList = $('#channelList');
const channelCount = $('#channelCount');
const videoGrid = $('#videoGrid');
const layoutGroup = $('#layoutGroup');
const toastContainer = $('#toastContainer');

// Auth
const authArea = $('#authArea');
const authBtn = $('#authBtn');
const authLabel = $('#authLabel');
const authDropdown = $('#authDropdown');
let _authUser = null;

// Modal
const modalOverlay = $('#channelModal');
const modalTitle = $('#modalTitle');
const modalUrl = $('#modalUrl');
const modalResolveBtn = $('#modalResolveBtn');
const modalName = $('#modalName');
const modalHandle = $('#modalHandle');
const modalChannelId = $('#modalChannelId');
const modalGroup = $('#modalGroup');
const modalCustomGroup = $('#modalCustomGroup');
const customGroupRow = $('#customGroupRow');
let modalEditId = null;

// Track collapsed groups in sidebar
const _collapsedGroups = new Set();

// ============ Dynamic Grid Helper ============
function gridCols(count) {
  if (count <= 1) return '1fr';
  if (count === 2) return '1fr 1fr';
  const cols = Math.ceil(Math.sqrt(count));
  return `repeat(${cols}, 1fr)`;
}

// ============ Category inference ============
function getCategory(ch) {
  const n = (ch.name + ' ' + (ch.handle || '')).toLowerCase();
  if (/market|financ|bloomberg|cnbc|nasdaq|dow|invest|stock/.test(n)) return 'MARKETS';
  if (/arabic|arabia|arabiya|عربي|aljaz.*ar|مباشر|sky.*ar|العرب/.test(n)) return 'MENA';
  if (/sport|football|soccer|goal|nba|nfl/.test(n)) return 'SPORTS';
  if (/tech|wired|verge|digital/.test(n)) return 'TECH';
  if (/weather|climate|accuweather/.test(n)) return 'WEATHER';
  return 'GLOBAL';
}

// ============ Card timestamp ============
function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ============ Translate static HTML (data-i18n) ============
function translateStatic() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  // Titles on buttons
  $('#toggleSidebarBtn').title = t('toggleSidebar');
  $('#theatreBtn').title = t('theatreTitle');
  $('#refreshBtn').title = t('refreshTitle');
  $('#resetBtn').title = t('resetTitle');
}

// ============ Toast ============
function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ============ Utilities ============
function initials(name) {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

// Cache of resolved live video IDs: channelId → { videoId, ts }
const _liveVideoCache = new Map();
const LIVE_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

function embedUrl(channelId, muted = true) {
  if (!channelId || !channelId.startsWith('UC')) return null;
  // Check if we have a resolved video ID for this channel
  const cached = _liveVideoCache.get(channelId);
  if (cached && cached.videoId) {
    return embedVideoUrl(cached.videoId, muted);
  }
  return `https://www.youtube.com/embed/live_stream?channel=${channelId}&autoplay=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}${muted ? '&mute=1' : ''}`;
}

function embedVideoUrl(videoId, muted = true) {
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}${muted ? '&mute=1' : ''}`;
}

/**
 * Resolve live video ID for a channel via /api/check-live.
 * Returns the video ID or empty string.
 */
async function checkLiveVideoId(handle, channelId) {
  // Check cache first
  const cached = _liveVideoCache.get(channelId);
  if (cached && Date.now() - cached.ts < LIVE_CACHE_TTL) {
    return cached.videoId;
  }
  try {
    const param = handle
      ? `handle=${encodeURIComponent(handle)}`
      : `channelId=${encodeURIComponent(channelId)}`;
    const res = await fetch(`/api/check-live?${param}`);
    if (!res.ok) return '';
    const data = await res.json();
    const videoId = data.videoId || '';
    _liveVideoCache.set(channelId, { videoId, ts: Date.now() });
    return videoId;
  } catch {
    return '';
  }
}

function channelPageUrl(handle) {
  if (!handle) return '#';
  const h = handle.startsWith('@') ? handle : '@' + handle;
  return `https://www.youtube.com/${h}/streams`;
}

function parseInput(val) {
  let handle = '';
  let channelId = '';

  if (val.startsWith('UC') && val.length >= 22 && !val.includes('/')) {
    channelId = val;
  } else if (val.includes('youtube.com/channel/')) {
    channelId = val.split('channel/').pop().split('/')[0].split('?')[0];
  }

  if (val.includes('youtube.com/@')) {
    handle = '@' + val.split('@').pop().split('/')[0];
  } else if (val.startsWith('@')) {
    handle = val.split('/')[0];
  } else if (!channelId) {
    handle = '@' + val.replace(/^@/, '');
  }

  const nameBase = handle ? handle.replace(/^@/, '') : channelId;
  const name = nameBase.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim();

  return { name, handle, channelId };
}

/**
 * Resolve a YouTube @handle or channel URL to { name, handle, channelId, logo }.
 * Uses /api/resolve-channel (Vite proxy in dev, Azure Function in prod).
 */
async function resolveYouTubeChannel(input) {
  let handle = input.trim();

  // Extract @handle from full URL
  if (handle.includes('youtube.com/@')) {
    handle = '@' + handle.split('@').pop().split('/')[0].split('?')[0];
  } else if (handle.includes('youtube.com/channel/')) {
    // For /channel/UC... URLs, pass the full URL
    handle = handle.split('channel/').pop().split('/')[0].split('?')[0];
  } else if (!handle.startsWith('@') && !handle.startsWith('UC')) {
    handle = '@' + handle;
  }

  const res = await fetch(`/api/resolve-channel?handle=${encodeURIComponent(handle)}`);
  if (!res.ok) throw new Error(`Failed to resolve channel (${res.status})`);
  const data = await res.json();

  return {
    name: data.name || '',
    handle: data.handle || handle,
    channelId: data.channelId || '',
    logo: data.logo || '',
  };
}

// ============ Render: Active Count Badge ============
function renderActiveCount() {
  const n = store.active.length;
  layoutGroup.innerHTML = n > 0
    ? `<span class="active-count-badge">${t('liveCount', n)}</span>`
    : '';
}

// ============ Render: Channel List ============
let dragStartIndex = null;

function renderChannelCard(ch, index, isActive) {
  const canDrag = !isMobile();
  const isFav = ch.fav;
  return `
    <div class="channel-card ${isActive ? 'active' : ''}" data-id="${ch.id}" data-index="${index}"${canDrag ? ' draggable="true"' : ''}>
      <div class="channel-avatar" style="background:${ch.logo ? 'transparent' : ch.color}">
        ${ch.logo ? `<img src="${ch.logo}" alt="${esc(ch.name)}" class="channel-logo">` : initials(ch.name)}
      </div>
      <div class="channel-info">
        <div class="channel-name">${esc(ch.name)}${ch.channelId ? '' : ' \u26a0\ufe0f'}</div>
        <div class="channel-status-line">${isActive ? t('liveTag') : ''}</div>
      </div>
      ${isActive ? `<span class="ch-live-chip">${t('liveTag')}</span>` : ''}
      <div class="channel-actions">
        <button class="btn-icon-sm ch-fav-btn ${isFav ? 'ch-fav-active' : ''}" data-action="fav" data-id="${ch.id}" title="${t('group_fav')}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        </button>
        <button class="btn-icon-sm ch-edit-btn" data-action="edit" data-id="${ch.id}" title="Edit">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
    </div>`;
}

function renderChannelList() {
  channelCount.textContent = store.channels.length;

  // Collect favorites
  const favChannels = store.channels.filter((ch) => ch.fav);

  // Group channels
  const groups = store.getGroups();
  const grouped = new Map();
  store.channels.forEach((ch) => {
    const g = ch.group || '';
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g).push(ch);
  });

  let html = '';

  // Render favorites group first (if any)
  if (favChannels.length > 0) {
    const isCollapsed = _collapsedGroups.has('__fav__');
    const activeInFav = favChannels.filter((ch) => store.isActive(ch.id)).length;
    const allFavActive = activeInFav === favChannels.length;
    html += `<div class="channel-group channel-group-fav">
      <div class="channel-group-header ${isCollapsed ? 'collapsed' : ''}" data-group="__fav__">
        <svg class="group-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        <span class="group-label group-label-fav">⭐ ${esc(t('group_fav'))}</span>
        <span class="group-count">${activeInFav}/${favChannels.length}</span>
        <button class="btn-icon-sm group-toggle-btn" data-group-toggle="__fav__" title="Toggle all">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="${allFavActive ? 'M18 6L6 18M6 6l12 12' : 'M20 6L9 17l-5-5'}"/></svg>
        </button>
      </div>
      <div class="channel-group-body ${isCollapsed ? 'collapsed' : ''}">`;
    favChannels.forEach((ch) => {
      const index = store.channels.indexOf(ch);
      const isActive = store.isActive(ch.id);
      html += renderChannelCard(ch, index, isActive);
    });
    html += `</div></div>`;
  }

  // Render grouped sections
  const orderedKeys = [...groups, ...(grouped.has('') ? [''] : [])];
  orderedKeys.forEach((groupKey) => {
    const channels = grouped.get(groupKey);
    if (!channels || channels.length === 0) return;

    const isCollapsed = _collapsedGroups.has(groupKey);
    const groupLabel = groupKey
      ? (t('group_' + groupKey) !== 'group_' + groupKey ? t('group_' + groupKey) : (GROUP_LABELS[groupKey] || groupKey))
      : t('ungrouped');
    const activeInGroup = channels.filter((ch) => store.isActive(ch.id)).length;
    const allActive = activeInGroup === channels.length;

    if (groupKey) {
      html += `<div class="channel-group">
        <div class="channel-group-header ${isCollapsed ? 'collapsed' : ''}" data-group="${esc(groupKey)}">
          <svg class="group-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          <span class="group-label">${esc(groupLabel)}</span>
          <span class="group-count">${activeInGroup}/${channels.length}</span>
          <button class="btn-icon-sm group-toggle-btn" data-group-toggle="${esc(groupKey)}" title="Toggle all">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="${allActive ? 'M18 6L6 18M6 6l12 12' : 'M20 6L9 17l-5-5'}"/></svg>
          </button>
        </div>
        <div class="channel-group-body ${isCollapsed ? 'collapsed' : ''}">`;
    }

    channels.forEach((ch, i) => {
      const index = store.channels.indexOf(ch);
      const isActive = store.isActive(ch.id);
      html += renderChannelCard(ch, index, isActive);
    });

    if (groupKey) {
      html += `</div></div>`;
    }
  });

  channelList.innerHTML = html;

  // Group header click: collapse/expand
  channelList.querySelectorAll('.channel-group-header').forEach((header) => {
    header.addEventListener('click', (e) => {
      // Don't toggle if clicking the toggle-all button
      if (e.target.closest('.group-toggle-btn')) return;
      const groupKey = header.dataset.group;
      if (_collapsedGroups.has(groupKey)) {
        _collapsedGroups.delete(groupKey);
      } else {
        _collapsedGroups.add(groupKey);
      }
      header.classList.toggle('collapsed');
      header.nextElementSibling?.classList.toggle('collapsed');
    });
  });

  // Group toggle-all button
  channelList.querySelectorAll('.group-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      store.toggleGroup(btn.dataset.groupToggle);
    });
  });

  // Drag and drop event listeners (desktop only)
  if (!isMobile()) {
    const cards = channelList.querySelectorAll('.channel-card');
    cards.forEach(card => {
      card.addEventListener('dragstart', (e) => {
        dragStartIndex = parseInt(card.dataset.index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragStartIndex);
        card.classList.add('dragging');
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over');
      });

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
        const dragEndIndex = parseInt(card.dataset.index);
        
        if (dragStartIndex !== null && dragStartIndex !== dragEndIndex) {
          store.reorderChannel(dragStartIndex, dragEndIndex);
        }
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        cards.forEach(c => c.classList.remove('drag-over'));
        dragStartIndex = null;
      });
    });
  }
}

function esc(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

// ============ Render: Video Grid ============
function renderGrid() {
  videoGrid.style.gridTemplateColumns = gridCols(store.active.length);

  if (store.active.length === 0) {
    videoGrid.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
        <p>${t('emptyState')}</p>
      </div>`;
    return;
  }

  // Reuse existing iframes to avoid reload
  const existing = new Map();
  videoGrid.querySelectorAll('.video-cell').forEach((cell) => {
    existing.set(cell.dataset.channelId, cell);
  });

  const fragment = document.createDocumentFragment();

  store.active.forEach((chId) => {
    const ch = store.getChannel(chId);
    if (!ch) return;

    if (existing.has(ch.id)) {
      fragment.appendChild(existing.get(ch.id));
      existing.delete(ch.id);
      return;
    }

    const cell = document.createElement('div');
    cell.className = 'video-cell';
    cell.dataset.channelId = ch.id;

    const url = embedUrl(ch.channelId);

    if (url) {
      cell.innerHTML = `
        <iframe src="${url}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>
        <button class="fullscreen-exit-btn" data-action="fullscreen" aria-label="Exit fullscreen">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="cell-overlay">
          <div class="cell-overlay-bar">
            <span class="cell-name">${esc(ch.name)}</span>
            <div class="cell-actions">
              <button class="cell-btn" data-action="newtab" data-handle="${esc(ch.handle)}" title="${t('openYT')}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </button>
              <button class="cell-btn" data-action="fullscreen" title="${t('fullscreen')}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              </button>
              <button class="cell-btn cell-btn-unmute" data-action="unmute" title="${t('unmute')}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
              </button>
              <button class="cell-btn" data-action="reload" title="${t('reload')}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
              </button>
              <button class="cell-btn danger" data-action="remove" data-id="${ch.id}" title="Remove">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>`;
    } else {
      cell.innerHTML = `
        <div class="cell-no-stream">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.25"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p>${esc(ch.name)}</p>
          <button class="cell-btn-ghost" data-action="edit-from-grid" data-id="${ch.id}">${t('setStreamId')}</button>
        </div>`;
    }

    fragment.appendChild(cell);
  });

  existing.forEach((cell) => cell.remove());
  videoGrid.innerHTML = '';
  videoGrid.appendChild(fragment);

  // Async: resolve actual live video IDs for newly added cells
  resolveGridVideoIds();
}

/**
 * For each active channel cell, resolve the actual live video ID asynchronously.
 * If the channel has multiple streams, this picks the right one and updates the iframe.
 */
async function resolveGridVideoIds() {
  const cells = videoGrid.querySelectorAll('.video-cell');
  const promises = [];

  cells.forEach((cell) => {
    if (cell.dataset.videoResolved) return; // already resolved this cell
    const chId = cell.dataset.channelId;
    const ch = store.getChannel(chId);
    if (!ch || !ch.channelId) return;

    cell.dataset.videoResolved = '1';
    promises.push(
      checkLiveVideoId(ch.handle, ch.channelId).then((videoId) => {
        if (!videoId) return;
        const iframe = cell.querySelector('iframe');
        if (!iframe) return;
        const isMuted = !cell.dataset.unmuted;
        const newUrl = embedVideoUrl(videoId, isMuted);
        // Only update if the iframe is still using the channel-based fallback
        if (iframe.src.includes('live_stream?channel=')) {
          iframe.src = newUrl;
        }
      })
    );
  });

  await Promise.allSettled(promises);
}

// ============ Render All ============
function render() {
  renderActiveCount();
  renderChannelList();
  renderGrid();
}

// ============ Modal ============
function populateGroupSelect(currentGroup = '') {
  const groups = store.getGroups();
  let options = `<option value="" ${!currentGroup ? 'selected' : ''}>${t('groupNone')}</option>`;
  groups.forEach((g) => {
    const label = t('group_' + g) !== 'group_' + g ? t('group_' + g) : (GROUP_LABELS[g] || g);
    options += `<option value="${esc(g)}" ${g === currentGroup ? 'selected' : ''}>${esc(label)}</option>`;
  });
  options += `<option value="__new__">${t('groupNew')}</option>`;
  modalGroup.innerHTML = options;
  customGroupRow.style.display = 'none';
  modalCustomGroup.value = '';
}

function openModal(editId = null) {
  modalEditId = editId;
  modalUrl.value = '';
  if (editId) {
    const ch = store.getChannel(editId);
    if (!ch) return;
    modalTitle.textContent = t('editChannel');
    modalName.value = ch.name;
    modalHandle.value = ch.handle;
    modalChannelId.value = ch.channelId || '';
    populateGroupSelect(ch.group || '');
  } else {
    modalTitle.textContent = t('addNewChannel');
    modalName.value = '';
    modalHandle.value = '';
    modalChannelId.value = '';
    populateGroupSelect('');
  }
  modalOverlay.classList.add('visible');
  setTimeout(() => modalUrl.focus(), 100);
}

function closeModal() {
  modalOverlay.classList.remove('visible');
  modalEditId = null;
}

function saveModal() {
  const name = modalName.value.trim();
  const handle = normalizeHandle(modalHandle.value.trim());
  const channelId = modalChannelId.value.trim();
  let group = modalGroup.value;
  if (group === '__new__') {
    group = modalCustomGroup.value.trim();
  }

  if (!name) {
    toast(t('toastNameRequired'), 'error');
    modalName.focus();
    return;
  }

  if (modalEditId) {
    store.updateChannel(modalEditId, { name, handle, channelId, group });
    toast(t('toastUpdated', name), 'success');
  } else {
    store.addChannel({ name, handle, channelId, group });
    toast(t('toastAdded', name), 'success');
  }
  closeModal();
}

function normalizeHandle(val) {
  if (!val) return '';
  if (val.includes('youtube.com/@')) {
    return '@' + val.split('@').pop().split('/')[0];
  }
  return val.startsWith('@') ? val : '@' + val;
}

// ============ Sidebar Tabs ============
const sidebarTabs = document.querySelectorAll('.sidebar-tab');
sidebarTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    sidebarTabs.forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1))?.classList.add('active');
  });
});

// ============ Event Handlers ============



// Sidebar channel clicks
function handleChannelCardClick(e) {
  const actionBtn = e.target.closest('[data-action]');
  if (actionBtn) {
    e.stopPropagation();
    const { action, id } = actionBtn.dataset;
    if (action === 'edit') openModal(id);
    if (action === 'remove') {
      const ch = store.removeChannel(id);
      if (ch) toast(t('toastRemoved', ch.name), 'info');
    }
    if (action === 'fav') store.toggleFav(id);
    return;
  }
  const card = e.target.closest('.channel-card');
  if (card) {
    store.toggleChannel(card.dataset.id);
    closeSidebarMobile();
  }
}
channelList.addEventListener('click', handleChannelCardClick);

// On touch devices, use touchend as primary handler to avoid drag/click suppression
let _touchMovedSidebar = false;
channelList.addEventListener('touchstart', () => { _touchMovedSidebar = false; }, { passive: true });
channelList.addEventListener('touchmove', () => { _touchMovedSidebar = true; }, { passive: true });
channelList.addEventListener('touchend', (e) => {
  if (_touchMovedSidebar) return; // was a scroll, not a tap
  const card = e.target.closest('.channel-card');
  const actionBtn = e.target.closest('[data-action]');
  if (actionBtn || !card) return; // let click handler deal with action buttons
  e.preventDefault(); // prevent ghost click
  store.toggleChannel(card.dataset.id);
  closeSidebarMobile();
});

// Video grid actions
videoGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'newtab') {
    window.open(channelPageUrl(btn.dataset.handle), '_blank');
  }
  if (action === 'fullscreen') {
    e.stopPropagation();
    const cell = btn.closest('.video-cell');
    // Debounce: prevent rapid toggle from multiple touch events
    if (cell._fsLock) return;
    cell._fsLock = true;
    setTimeout(() => { cell._fsLock = false; }, 400);
    cell.classList.toggle('fullscreen');
    // Prevent body scroll while fullscreen on mobile
    if (isMobile()) {
      document.body.style.overflow = cell.classList.contains('fullscreen') ? 'hidden' : '';
    }
  }
  if (action === 'unmute') {
    const cell = btn.closest('.video-cell');
    const iframe = cell?.querySelector('iframe');
    if (iframe) {
      const isMuted = !btn.classList.contains('cell-btn-unmuted');
      if (isMuted) {
        // Use postMessage to unmute without reloading the video
        iframe.contentWindow.postMessage('{"event":"command","func":"unMute","args":""}', '*');
        // Mark as unmuted (track state on the element, don't touch iframe.src)
        cell.dataset.unmuted = '1';
        btn.classList.add('cell-btn-unmuted');
        btn.querySelector('svg').innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>';
      } else {
        // Re-mute
        iframe.contentWindow.postMessage('{"event":"command","func":"mute","args":""}', '*');
        delete cell.dataset.unmuted;
        btn.classList.remove('cell-btn-unmuted');
        btn.querySelector('svg').innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
      }
    }
  }
  if (action === 'reload') {
    const iframe = btn.closest('.video-cell').querySelector('iframe');
    if (iframe) { const src = iframe.src; iframe.src = ''; requestAnimationFrame(() => iframe.src = src); }
  }
  if (action === 'remove') {
    const id = btn.dataset.id;
    if (id) { store.removeChannel(id); }
  }
  if (action === 'edit-from-grid') {
    openModal(btn.dataset.id);
  }
});

// Header buttons
const sidebarBackdrop = $('#sidebarBackdrop');

function isMobile() { return window.innerWidth <= 768; }

function toggleSidebar() {
  sidebar.classList.toggle('collapsed');
  if (isMobile()) {
    const isOpen = !sidebar.classList.contains('collapsed');
    sidebarBackdrop.classList.toggle('visible', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  }
}

function closeSidebarMobile() {
  if (isMobile() && !sidebar.classList.contains('collapsed')) {
    sidebar.classList.add('collapsed');
    sidebarBackdrop.classList.remove('visible');
    document.body.style.overflow = '';
  }
}

// Swipe-down-to-close sidebar on mobile (full-screen tile overlay)
(function initSwipeToClose() {
  let startY = 0;
  let tracking = false;
  sidebar.addEventListener('touchstart', (e) => {
    if (!isMobile() || sidebar.classList.contains('collapsed')) return;
    // Only track from the top area (tabs/header region)
    const rect = sidebar.getBoundingClientRect();
    if (e.touches[0].clientY - rect.top > 80) return;
    startY = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });
  sidebar.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const dy = e.changedTouches[0].clientY - startY;
    // Swipe down to close
    if (dy > 80) {
      closeSidebarMobile();
    }
  }, { passive: true });
})();

// Inject mobile close button into sidebar tabs
(function injectMobileCloseBtn() {
  if (!isMobile()) return;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-icon sidebar-close-mobile';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  closeBtn.addEventListener('click', closeSidebarMobile);
  const tabsBar = sidebar.querySelector('.sidebar-tabs');
  if (tabsBar) tabsBar.appendChild(closeBtn);
})();

$('#toggleSidebarBtn').addEventListener('click', toggleSidebar);
if (sidebarBackdrop) {
  sidebarBackdrop.addEventListener('click', closeSidebarMobile);
}
// Start sidebar collapsed on mobile
if (isMobile()) {
  sidebar.classList.add('collapsed');
}
$('#statsBtn').addEventListener('click', () => toggleStatsPanel());
$('#headerPriceTicker').addEventListener('click', () => toggleStatsPanel());
$('#flightBtn').addEventListener('click', () => toggleFlightPanel());
$('#headerFlightTicker').addEventListener('click', () => toggleFlightPanel());
$('#addChannelBtn').addEventListener('click', () => openModal());
$('#addChannelBtnBottom').addEventListener('click', () => openModal());
$('#intelBtn').addEventListener('click', () => openIntelPanel());
$('#theatreBtn').addEventListener('click', () => document.body.classList.toggle('theatre'));
$('#refreshBtn').addEventListener('click', () => {
  videoGrid.querySelectorAll('iframe').forEach((iframe) => {
    const src = iframe.src;
    iframe.src = '';
    requestAnimationFrame(() => iframe.src = src);
  });
  toast(t('toastRefreshed'), 'info');
});
$('#resetBtn').addEventListener('click', () => {
  if (!confirm(t('resetConfirm'))) return;
  store.resetToDefaults();
  toast(t('toastReset'), 'info');
});

// Modal buttons
$('#modalCloseBtn').addEventListener('click', closeModal);
$('#modalCancelBtn').addEventListener('click', closeModal);
$('#modalSaveBtn').addEventListener('click', saveModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });

// Modal resolve button
modalResolveBtn.addEventListener('click', async () => {
  const url = modalUrl.value.trim();
  if (!url) { modalUrl.focus(); return; }
  modalResolveBtn.disabled = true;
  modalResolveBtn.textContent = '…';
  try {
    const info = await resolveYouTubeChannel(url);
    if (info.name) modalName.value = info.name;
    if (info.handle) modalHandle.value = info.handle;
    if (info.channelId) modalChannelId.value = info.channelId;
    if (!info.channelId) {
      toast(t('resolveErrorId'), 'error');
    } else {
      toast(t('resolveSuccess'), 'success');
    }
  } catch (err) {
    console.error('Resolve error:', err);
    toast(t('resolveError'), 'error');
  } finally {
    modalResolveBtn.disabled = false;
    modalResolveBtn.textContent = t('resolve');
  }
});
modalUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); modalResolveBtn.click(); } });

// Modal group select: show/hide custom group input
modalGroup.addEventListener('change', () => {
  const isNew = modalGroup.value === '__new__';
  customGroupRow.style.display = isNew ? '' : 'none';
  if (isNew) modalCustomGroup.focus();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  switch (e.key.toLowerCase()) {
    case 's': sidebar.classList.toggle('collapsed'); break;
    case 'd': toggleStatsPanel(); break;
    case 'f': toggleFlightPanel(); break;
    case 't': document.body.classList.toggle('theatre'); break;
    case 'r': $('#refreshBtn').click(); break;
    case 'escape':
      document.querySelectorAll('.video-cell.fullscreen').forEach((c) => c.classList.remove('fullscreen'));
      if (isMobile()) document.body.style.overflow = '';
      if (document.body.classList.contains('theatre')) document.body.classList.remove('theatre');
      closeSidebarMobile();
      closeModal();
      closeIntelPanel();
      break;

  }
});

// Close fullscreen cells on Escape within iframe context
window.addEventListener('message', (e) => {
  if (e.data === 'yt-close-fullscreen') {
    document.querySelectorAll('.video-cell.fullscreen').forEach((c) => c.classList.remove('fullscreen'));
    if (isMobile()) document.body.style.overflow = '';
  }
});

// ============ Auth UI ============
function renderAuthUI(user) {
  _authUser = user;
  if (user) {
    // Signed-in state: show avatar + name
    const photo = user.photoURL
      ? `<img class="auth-avatar" src="${user.photoURL}" alt="" referrerpolicy="no-referrer">`
      : `<svg class="auth-avatar" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    const firstName = (user.displayName || '').split(' ')[0] || user.email || 'User';
    authBtn.innerHTML = `${photo}<span>${esc(firstName)}</span>`;
    authDropdown.innerHTML = `
      <div class="auth-dropdown-user">
        ${photo.replace('24', '32').replace('24', '32')}
        <div class="auth-dropdown-user-info">
          <div class="auth-dropdown-user-name">${esc(user.displayName || 'User')}</div>
          <div class="auth-dropdown-user-email">${esc(user.email || '')}</div>
        </div>
      </div>
      <button class="auth-dropdown-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z"/><path d="M2 12h20"/></svg>
        ${t('cloudSync')} <span class="auth-sync-badge">ON</span>
      </button>
      <button class="auth-dropdown-item danger" id="signOutBtn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        ${t('signOut')}
      </button>`;
  } else {
    // Signed-out state
    authBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      <span>${t('signIn')}</span>`;
    authDropdown.innerHTML = '';
    authDropdown.classList.remove('visible');
  }
}

function toggleAuthDropdown() {
  authDropdown.classList.toggle('visible');
}

// Close auth dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!authArea.contains(e.target)) {
    authDropdown.classList.remove('visible');
  }
});

// Auth button click
authBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (_authUser) {
    toggleAuthDropdown();
  } else {
    try {
      const user = await signInWithGoogle();
      toast(t('welcomeBack', user.displayName || 'User'), 'success');
    } catch (err) {
      if (err.message === 'Firebase not configured') {
        toast(t('firebaseNotConfigured'), 'warning');
      } else if (err.code !== 'auth/popup-closed-by-user') {
        toast(err.message, 'error');
      }
    }
  }
});

// Sign out from dropdown
authDropdown.addEventListener('click', async (e) => {
  const signOutBtn = e.target.closest('#signOutBtn');
  if (signOutBtn) {
    await signOutUser();
    authDropdown.classList.remove('visible');
    toast(t('signedOut'), 'info');
  }
});

// ============ Contributor Popup ============
(function () {
  const contributorArea = $('#contributorArea');
  const contributorBtn = $('#contributorBtn');
  const contributorDropdown = $('#contributorDropdown');
  const contributorList = $('#contributorList');
  let _contributorsLoaded = false;

  async function loadContributors() {
    if (_contributorsLoaded) return;
    contributorList.innerHTML = `<div class="contributor-loading">Loading…</div>`;
    try {
      const res = await fetch('https://api.github.com/repos/OAbouHajar/mena-headlines/contributors?per_page=30');
      if (!res.ok) throw new Error(res.statusText);
      const contributors = await res.json();
      contributorList.innerHTML = contributors.map(c => `
        <a class="contributor-item" href="${c.html_url}" target="_blank" rel="noopener">
          <img class="contributor-avatar" src="${c.avatar_url}&s=64" alt="${c.login}" loading="lazy">
          <div class="contributor-info">
            <span class="contributor-name">${c.login}</span>
            <span class="contributor-commits">${t('nContributions', c.contributions)}</span>
          </div>
        </a>
      `).join('');
      _contributorsLoaded = true;
    } catch (err) {
      contributorList.innerHTML = `<div class="contributor-error">${t('contributorLoadError')}</div>`;
    }
  }

  contributorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = contributorDropdown.classList.toggle('visible');
    if (isOpen) loadContributors();
  });

  document.addEventListener('click', (e) => {
    if (!contributorArea.contains(e.target)) {
      contributorDropdown.classList.remove('visible');
    }
  });

  // Re-render contribution counts on lang change
  onLangChange(() => {
    _contributorsLoaded = false;
    if (contributorDropdown.classList.contains('visible')) loadContributors();
  });
})();

// ============ Subscribe & Boot ============
store.subscribe(render);
onLangChange(() => {
  translateStatic();
  renderAuthUI(_authUser);
  render();
});
onAuthReady((user) => {
  renderAuthUI(user);
  render();
});
$('#langToggleBtn').addEventListener('click', toggleLang);
translateStatic();
render();
new NewsTicker();
initIntelPanel();
initStatsPanel();
initChat();

initPredictions();

// On mobile: force all panels closed so only the video grid shows
if (isMobile()) {
  document.getElementById('statsPanel')?.classList.add('closed');
  document.getElementById('statsBtn')?.classList.remove('active');
  document.getElementById('flightPanel')?.classList.add('closed');
  document.getElementById('flightBtn')?.classList.remove('active');
  document.getElementById('chatPanel')?.classList.add('closed');
  document.getElementById('chatHeaderBtn')?.classList.remove('active');
}

// ============ Live Users Counter ============
(function () {
  const countEl = $('#liveUsersCount');
  initPresence((count) => {
    if (countEl) countEl.textContent = count;
  });
})();

// ============ Global Keyboard Shortcuts ============
document.addEventListener('keydown', (e) => {
  // Ignore inputs and textareas
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
    if (e.key === 'Escape') closeModal();
    return;
  }
  
  const char = e.key.toLowerCase();
  if (char === 's') {
    e.preventDefault();
    toggleSidebar();
  } else if (char === 't') {
    e.preventDefault();
    $('#theatreBtn').click();
  } else if (char === 'r') {
    e.preventDefault();
    $('#refreshBtn').click();
  } else if (e.key === 'Escape') {
    closeModal();
  }
});
