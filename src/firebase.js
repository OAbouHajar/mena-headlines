/**
 * Firebase initialisation — Auth + Firestore.
 * If env vars are missing the app still works (localStorage-only).
 */
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged as _onAuthStateChanged,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const isConfigured = !!firebaseConfig.apiKey && !!firebaseConfig.projectId;

let app, auth, db;
if (isConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

const googleProvider = new GoogleAuthProvider();

/** Sign in with Google popup. Returns the user or throws. */
export async function signInWithGoogle() {
  if (!isConfigured) throw new Error('Firebase not configured');
  return (await signInWithPopup(auth, googleProvider)).user;
}

/** Sign current user out. */
export async function signOutUser() {
  if (!auth) return;
  return signOut(auth);
}

/** Subscribe to auth state. Callback receives user | null. */
export function onAuthStateChanged(cb) {
  if (!auth) {
    // No Firebase configured — fire once with null and return no-op
    queueMicrotask(() => cb(null));
    return () => {};
  }
  return _onAuthStateChanged(auth, cb);
}

export { db, isConfigured };
