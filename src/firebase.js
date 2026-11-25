import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache, connectFirestoreEmulator } from 'firebase/firestore';

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

const useEmulator = env.VITE_USE_EMULATOR === 'true';

export const isConfigured = useEmulator || Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

let app = null;
let auth = null;
let db = null;

if (isConfigured) {
  const cfg = useEmulator && !firebaseConfig.projectId
    ? { apiKey: 'demo-key', projectId: 'demo-sng', appId: 'demo-app', authDomain: 'localhost' }
    : firebaseConfig;
  app = getApps()[0] || initializeApp(cfg);
  auth = getAuth(app);
  // Online-only: memory cache, no IndexedDB persistence, no offline write queue
  // that survives reloads. All billing writes use transactions, which require
  // a round trip to the server and fail while offline.
  db = initializeFirestore(app, { localCache: memoryLocalCache() });
  if (useEmulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', Number(env.VITE_EMULATOR_FIRESTORE_PORT) || 8080);
  }
}

export { app, auth, db, useEmulator };
