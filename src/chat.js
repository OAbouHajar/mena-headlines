/**
 * Chat module — side panel with polling from /api/chat (Azure Blob Storage).
 * Anonymous users pick a display name stored in localStorage.
 * Supports replies and emoji reactions.
 */

import { t, onLangChange } from './i18n.js';

// ─── Constants ───────────────────────────────────────────────────────────────
const POLL_INTERVAL = 5_000;       // 5 seconds
const STORAGE_KEY   = 'ytmv_chat_username';
const REACTIONS     = ['👍', '❤️', '😂', '😮', '👎'];

// ─── DOM refs ────────────────────────────────────────────────────────────────
let fab, badge, panel, closeBtn, usernameBtn;
let usernameBar, usernameInput, usernameSetBtn;
let messagesEl, emptyEl;
let replyBar, replyText, replyCancel;
let chatInput, sendBtn;

// ─── State ───────────────────────────────────────────────────────────────────
let messages     = [];
let lastTimestamp = 0;
let pollTimer    = null;
let isOpen       = false;
let replyTo      = null;    // { id, username, message }
let username     = localStorage.getItem(STORAGE_KEY) || '';
let unreadCount  = 0;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function esc(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return t('chatJustNow');
  if (diff < 3_600_000) return t('chatMinutesAgo', Math.floor(diff / 60_000));
  if (diff < 86_400_000) return t('chatHoursAgo', Math.floor(diff / 3_600_000));
  return t('chatDaysAgo', Math.floor(diff / 86_400_000));
}

function colorForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 60%)`;
}

// ─── API ─────────────────────────────────────────────────────────────────────
async function fetchMessages(since = 0) {
  try {
    const res = await fetch(`/api/chat?since=${since}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.messages || [];
  } catch { return []; }
}

async function postMessage(text, replyToId) {
  const body = { username, message: text };
  if (replyToId) body.replyTo = replyToId;
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.message;
  } catch { return null; }
}

async function postReaction(messageId, reaction) {
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, reaction, username }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.message;
  } catch { return null; }
}

// ─── Render ──────────────────────────────────────────────────────────────────
function renderMessages() {
  if (messages.length === 0) {
    emptyEl.classList.remove('hidden');
    emptyEl.textContent = t('chatEmpty');
    messagesEl.querySelectorAll('.chat-msg').forEach(el => el.remove());
    return;
  }
  emptyEl.classList.add('hidden');

  // Build message HTML
  const html = messages.map(msg => {
    const nameColor = colorForName(msg.username);
    let replyHtml = '';
    if (msg.replyTo) {
      replyHtml = `<div class="chat-msg-reply-quote"><strong>${esc(msg.replyTo.username)}</strong>: ${esc(msg.replyTo.message)}</div>`;
    }

    // Reactions
    let reactionsHtml = '';
    if (msg.reactions && Object.keys(msg.reactions).length > 0) {
      const chips = Object.entries(msg.reactions).map(([emoji, users]) => {
        const isActive = users.includes(username) ? ' active' : '';
        return `<button class="chat-reaction-chip${isActive}" data-msg-id="${msg.id}" data-emoji="${esc(emoji)}">${emoji}<span class="reaction-count">${users.length}</span></button>`;
      }).join('');
      reactionsHtml = `<div class="chat-msg-reactions">${chips}</div>`;
    }

    // Hover action buttons (reply + emoji shortcuts)
    const replyIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>`;
    const reactionBtns = REACTIONS.map(e =>
      `<button class="chat-msg-action-btn" data-action="react" data-msg-id="${msg.id}" data-emoji="${e}" title="${e}">${e}</button>`
    ).join('');

    return `<div class="chat-msg" data-id="${msg.id}">
      ${replyHtml}
      <div class="chat-msg-header">
        <span class="chat-msg-username" style="color:${nameColor}">${esc(msg.username)}</span>
        <span class="chat-msg-time">${relativeTime(msg.timestamp)}</span>
      </div>
      <div class="chat-msg-text">${esc(msg.message)}</div>
      ${reactionsHtml}
      <div class="chat-msg-actions">
        <button class="chat-msg-action-btn" data-action="reply" data-msg-id="${msg.id}" title="${t('chatReply')}">${replyIcon}</button>
        ${reactionBtns}
      </div>
    </div>`;
  }).join('');

  messagesEl.innerHTML = `<div class="chat-empty hidden" id="chatEmpty"></div>${html}`;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function updateBadge() {
  if (unreadCount > 0 && !isOpen) {
    badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
    badge.textContent = '';
  }
}

// ─── Poll ────────────────────────────────────────────────────────────────────
async function poll() {
  const newMsgs = await fetchMessages(lastTimestamp);
  if (newMsgs.length > 0) {
    // Merge, avoiding duplicates
    const existingIds = new Set(messages.map(m => m.id));
    const fresh = newMsgs.filter(m => !existingIds.has(m.id));
    messages.push(...fresh);

    // Also update reactions on existing messages
    for (const nm of newMsgs) {
      const idx = messages.findIndex(m => m.id === nm.id);
      if (idx >= 0) messages[idx].reactions = nm.reactions;
    }

    lastTimestamp = Math.max(...messages.map(m => m.timestamp));

    if (!isOpen && fresh.length > 0) {
      unreadCount += fresh.length;
      updateBadge();
    }

    const wasAtBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 60;
    renderMessages();
    if (wasAtBottom || !isOpen) scrollToBottom();
  }
}

async function fullRefresh() {
  messages = await fetchMessages(0);
  if (messages.length > 0) {
    lastTimestamp = Math.max(...messages.map(m => m.timestamp));
  }
  renderMessages();
  scrollToBottom();
}

// ─── Actions ─────────────────────────────────────────────────────────────────
function openChat() {
  isOpen = true;
  panel.classList.remove('closed');
  fab.classList.add('hidden');
  unreadCount = 0;
  updateBadge();
  chatInput.focus();
  scrollToBottom();
}

function closeChat() {
  isOpen = false;
  panel.classList.add('closed');
  fab.classList.remove('hidden');
}

function setReply(msgId) {
  const msg = messages.find(m => m.id === msgId);
  if (!msg) return;
  replyTo = { id: msg.id, username: msg.username, message: msg.message };
  replyText.innerHTML = `<strong>${esc(msg.username)}</strong>: ${esc(msg.message.slice(0, 60))}`;
  replyBar.style.display = 'flex';
  chatInput.focus();
}

function clearReply() {
  replyTo = null;
  replyBar.style.display = 'none';
  replyText.textContent = '';
}

function setUsername(name) {
  username = name.trim().slice(0, 30);
  localStorage.setItem(STORAGE_KEY, username);
  if (username) {
    usernameBar.classList.add('hidden');
  }
}

function promptUsername() {
  usernameBar.classList.remove('hidden');
  usernameInput.value = username;
  usernameInput.focus();
}

async function handleSend() {
  const text = chatInput.value.trim();
  if (!text) return;
  // If no username set, default to anonymous
  if (!username) {
    username = t('chatAnonymous');
    localStorage.setItem(STORAGE_KEY, username);
    usernameBar.classList.add('hidden');
  }
  if (text.length > 500) return;

  chatInput.value = '';
  const replyToId = replyTo?.id || null;
  clearReply();

  // Optimistic append
  const optimistic = {
    id: '_pending_' + Date.now(),
    username,
    message: text,
    timestamp: Date.now(),
    reactions: {},
    replyTo: replyTo ? { id: replyTo.id, username: replyTo.username, message: replyTo.message.slice(0, 80) } : undefined,
  };
  messages.push(optimistic);
  renderMessages();
  scrollToBottom();

  const sent = await postMessage(text, replyToId);
  if (sent) {
    // Replace optimistic with server response
    const idx = messages.findIndex(m => m.id === optimistic.id);
    if (idx >= 0) messages[idx] = sent;
    lastTimestamp = Math.max(lastTimestamp, sent.timestamp);
    renderMessages();
    scrollToBottom();
  }
}

async function handleReaction(msgId, emoji) {
  // Optimistic toggle
  const msg = messages.find(m => m.id === msgId);
  if (!msg || !username) return;
  if (!msg.reactions) msg.reactions = {};
  if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
  const idx = msg.reactions[emoji].indexOf(username);
  if (idx >= 0) {
    msg.reactions[emoji].splice(idx, 1);
    if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
  } else {
    msg.reactions[emoji].push(username);
  }
  renderMessages();

  const updated = await postReaction(msgId, emoji);
  if (updated) {
    const mi = messages.findIndex(m => m.id === msgId);
    if (mi >= 0) messages[mi].reactions = updated.reactions;
    renderMessages();
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────
export function initChat() {
  fab            = document.getElementById('chatFab');
  badge          = document.getElementById('chatFabBadge');
  panel          = document.getElementById('chatPanel');
  closeBtn       = document.getElementById('chatCloseBtn');
  usernameBtn    = document.getElementById('chatUsernameBtn');
  usernameBar    = document.getElementById('chatUsernameBar');
  usernameInput  = document.getElementById('chatUsernameInput');
  usernameSetBtn = document.getElementById('chatUsernameSetBtn');
  messagesEl     = document.getElementById('chatMessages');
  emptyEl        = document.getElementById('chatEmpty');
  replyBar       = document.getElementById('chatReplyBar');
  replyText      = document.getElementById('chatReplyText');
  replyCancel    = document.getElementById('chatReplyCancel');
  chatInput      = document.getElementById('chatInput');
  sendBtn        = document.getElementById('chatSendBtn');

  if (!fab || !panel) return;

  // If username already set, hide the prompt
  if (username) {
    usernameBar.classList.add('hidden');
  }

  // Open by default
  isOpen = true;
  fab.classList.add('hidden');

  // Events
  fab.addEventListener('click', openChat);
  closeBtn.addEventListener('click', closeChat);
  usernameBtn.addEventListener('click', promptUsername);

  usernameSetBtn.addEventListener('click', () => {
    setUsername(usernameInput.value);
  });
  usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setUsername(usernameInput.value);
    }
  });

  sendBtn.addEventListener('click', handleSend);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    // Stop global keyboard shortcuts from firing while typing in chat
    e.stopPropagation();
  });

  replyCancel.addEventListener('click', clearReply);

  // Delegate clicks on message actions + reactions
  messagesEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) {
      // Check if it's a reaction chip
      const chip = e.target.closest('.chat-reaction-chip');
      if (chip) {
        handleReaction(chip.dataset.msgId, chip.dataset.emoji);
      }
      return;
    }
    const action = btn.dataset.action;
    if (action === 'reply') {
      setReply(btn.dataset.msgId);
    } else if (action === 'react') {
      if (!username) { promptUsername(); return; }
      handleReaction(btn.dataset.msgId, btn.dataset.emoji);
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) {
      closeChat();
    }
  });

  // i18n refresh
  onLangChange(() => {
    renderMessages();
  });

  // Initial load + start polling
  fullRefresh();
  pollTimer = setInterval(poll, POLL_INTERVAL);

  // Pause polling when tab hidden, resume when visible
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInterval(pollTimer);
      pollTimer = null;
    } else {
      poll(); // immediate refresh
      pollTimer = setInterval(poll, POLL_INTERVAL);
    }
  });
}
