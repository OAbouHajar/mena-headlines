/**
 * Cloud sync — bridges Firebase Auth + Firestore with the local store.
 * If Firebase is not configured, this module is inert.
 */
import { db, isConfigured, onAuthStateChanged } from './firebase.js';
import { store } from './store.js';

let _user = null;
let _unsubStore = null;
let _saveTimer = null;
const _listeners = [];

// Firestore lazy imports — only loaded when needed
let _doc, _getDoc, _setDoc, _serverTimestamp;
async function firestoreRefs() {
  if (!_doc) {
    const mod = await import('firebase/firestore');
    _doc = mod.doc;
    _getDoc = mod.getDoc;
    _setDoc = mod.setDoc;
    _serverTimestamp = mod.serverTimestamp;
  }
}

// ============ Cloud read / write ============

async function loadFromCloud(uid) {
  if (!isConfigured || !uid) return false;
  try {
    await firestoreRefs();
    const snap = await _getDoc(_doc(db, 'users', uid));
    if (snap.exists()) {
      const data = snap.data();
      if (data.channels && data.channels.length > 0) {
        store.loadState(data.channels, data.active || []);
        return true;
      }
    }
  } catch (err) {
    console.warn('[sync] loadFromCloud failed:', err);
  }
  return false;
}

async function saveToCloud(uid) {
  if (!isConfigured || !uid) return;
  try {
    await firestoreRefs();
    await _setDoc(_doc(db, 'users', uid), {
      channels: store.channels,
      active: store.active,
      updatedAt: _serverTimestamp(),
    });
  } catch (err) {
    console.warn('[sync] saveToCloud failed:', err);
  }
}

function debouncedSave(uid) {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => saveToCloud(uid), 400);
}

// ============ Auth state listener ============

onAuthStateChanged((user) => {
  _user = user;

  // Unsubscribe any previous store listener
  if (_unsubStore) {
    _unsubStore();
    _unsubStore = null;
  }
  clearTimeout(_saveTimer);

  if (user) {
    // Load cloud state, then subscribe to future changes
    loadFromCloud(user.uid).then(() => {
      _unsubStore = store.subscribe(() => debouncedSave(user.uid));
    });
  }

  // Notify UI listeners
  _listeners.forEach((fn) => fn(user));
});

// ============ Public API ============

/** Current Firebase user or null */
export function currentUser() {
  return _user;
}

/** Subscribe to auth changes (user | null). Returns unsubscribe fn. */
export function onAuthReady(fn) {
  _listeners.push(fn);
  // Fire immediately with current state
  if (_user !== undefined) queueMicrotask(() => fn(_user));
  return () => {
    const idx = _listeners.indexOf(fn);
    if (idx >= 0) _listeners.splice(idx, 1);
  };
}
