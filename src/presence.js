/**
 * Presence tracking — counts how many browser sessions are active right now.
 * Uses Firestore: each session writes a heartbeat doc every 30 s.
 * Sessions inactive for > 90 s are excluded from the count automatically.
 *
 * Firestore rules required (Firebase console → Firestore → Rules):
 *   match /presence/{sid} {
 *     allow read, write: if true;
 *   }
 */
import { db, isConfigured } from './firebase.js';

const HEARTBEAT_MS   = 30_000;   // write interval
const STALE_MS       = 90_000;   // exclude sessions older than this

let _sessionId       = null;
let _heartbeatTimer  = null;
let _unsubSnapshot   = null;

// Firestore lazy refs
let _colRef, _docRef, _setDoc, _deleteDoc, _onSnapshot, _serverTimestamp;

async function ensureRefs() {
  if (_setDoc) return;
  const mod = await import('firebase/firestore');
  _setDoc          = mod.setDoc;
  _deleteDoc       = mod.deleteDoc;
  _onSnapshot      = mod.onSnapshot;
  _serverTimestamp = mod.serverTimestamp;

  const { collection, doc } = mod;
  _colRef = collection(db, 'presence');
  _docRef = (sid) => doc(db, 'presence', sid);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

async function writeHeartbeat() {
  if (!_sessionId) return;
  try {
    await ensureRefs();
    await _setDoc(_docRef(_sessionId), { lastSeen: _serverTimestamp() });
  } catch (e) {
    console.warn('[presence] heartbeat failed:', e.message);
  }
}

async function removeSession() {
  if (!_sessionId) return;
  try {
    await ensureRefs();
    await _deleteDoc(_docRef(_sessionId));
  } catch (e) {
    console.warn('[presence] remove failed:', e.message);
  }
}

/**
 * Start presence tracking.
 * @param {(count: number) => void} onCountChange  Called whenever count changes.
 * @returns {() => void}  Cleanup function.
 */
export async function initPresence(onCountChange) {
  if (!isConfigured || !db) return () => {};

  // Show at least 1 (current user) immediately — don't wait for Firestore
  if (typeof onCountChange === 'function') onCountChange(1);

  try {
    await ensureRefs();

    _sessionId = generateId();

    // Best-effort cleanup when tab closes
    window.addEventListener('beforeunload', removeSession);

    // Also refresh when the tab becomes visible again
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') writeHeartbeat();
    });

    // Set up real-time listener FIRST (read), then write heartbeat
    _unsubSnapshot = _onSnapshot(
      _colRef,
      (snapshot) => {
        const now = Date.now();
        let count = 0;
        snapshot.forEach((d) => {
          const ts = d.data().lastSeen?.toMillis?.();
          if (ts && now - ts < STALE_MS) count++;
        });
        if (typeof onCountChange === 'function') onCountChange(Math.max(1, count));
      },
      (err) => {
        console.warn('[presence] snapshot error:', err.message);
        // Keep badge showing at least 1
      }
    );

    // Write heartbeat after listener is live
    await writeHeartbeat();
    _heartbeatTimer = setInterval(writeHeartbeat, HEARTBEAT_MS);

    return () => {
      clearInterval(_heartbeatTimer);
      _unsubSnapshot?.();
      removeSession();
    };
  } catch (e) {
    console.warn('[presence] init failed:', e.message);
    return () => {};
  }
}
