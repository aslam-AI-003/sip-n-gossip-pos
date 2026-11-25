import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { doc, getDocFromServer } from 'firebase/firestore';
import { db } from '../firebase.js';

// Online-only operation: billing actions are enabled only after a real
// round trip to Firestore succeeds. navigator.onLine alone is not trusted.
const ConnCtx = createContext({ status: 'checking', online: false, verify: async () => false });

const HEARTBEAT_MS = 20000;
const TIMEOUT_MS = 8000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

export function ConnectionProvider({ children }) {
  const [status, setStatus] = useState(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'checking');
  const [lastOk, setLastOk] = useState(null);
  const inflight = useRef(null);

  const verify = useCallback(async () => {
    if (!navigator.onLine) {
      setStatus('offline');
      return false;
    }
    if (inflight.current) return inflight.current;
    inflight.current = (async () => {
      try {
        await withTimeout(getDocFromServer(doc(db, 'meta', 'setup')), TIMEOUT_MS);
        setStatus('online');
        setLastOk(new Date());
        return true;
      } catch {
        setStatus('offline');
        return false;
      } finally {
        inflight.current = null;
      }
    })();
    return inflight.current;
  }, []);

  useEffect(() => {
    verify();
    const onOnline = () => { setStatus('checking'); verify(); };
    const onOffline = () => setStatus('offline');
    const onVisible = () => { if (document.visibilityState === 'visible') verify(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    const t = setInterval(verify, HEARTBEAT_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(t);
    };
  }, [verify]);

  return (
    <ConnCtx.Provider value={{ status, online: status === 'online', verify, lastOk }}>
      {children}
    </ConnCtx.Provider>
  );
}

export const useConnection = () => useContext(ConnCtx);
