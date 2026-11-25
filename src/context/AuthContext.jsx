import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, onSnapshot, getDocFromServer, writeBatch, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { DEFAULT_SETTINGS } from '../lib/defaults.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [fbUser, setFbUser] = useState(undefined); // undefined = loading
  const [profile, setProfile] = useState(undefined);
  const [setupDone, setSetupDone] = useState(null);
  const [setupError, setSetupError] = useState(null);
  const [profileNonce, setProfileNonce] = useState(0);

  const checkSetup = useCallback(async () => {
    try {
      const s = await getDocFromServer(doc(db, 'meta', 'setup'));
      setSetupDone(s.exists());
      setSetupError(null);
    } catch (e) {
      setSetupError(e);
    }
  }, []);

  useEffect(() => { checkSetup(); }, [checkSetup]);

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setFbUser(u);
    if (!u) setProfile(null);
  }), []);

  useEffect(() => {
    if (!fbUser) return undefined;
    let retry = null;
    const unsub = onSnapshot(
      doc(db, 'users', fbUser.uid),
      (s) => setProfile(s.exists() ? { uid: fbUser.uid, ...s.data() } : null),
      () => {
        // A rejected listener stops for good; resubscribe shortly (e.g. the
        // auth token was not ready yet, or the profile was just created).
        setProfile(null);
        retry = setTimeout(() => setProfileNonce((n) => n + 1), 2000);
      },
    );
    return () => { unsub(); clearTimeout(retry); };
  }, [fbUser, profileNonce]);

  const login = (email, password) => signInWithEmailAndPassword(auth, email.trim(), password);
  const logout = () => signOut(auth);
  const resetPassword = (email) => sendPasswordResetEmail(auth, email.trim());

  /** First run: create the owner account as admin. */
  const bootstrapAdmin = async ({ name, email, password, tableCount }) => {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const uid = cred.user.uid;
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', uid), {
      name: name.trim(), email: email.trim().toLowerCase(), role: 'admin', active: true, createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'meta', 'setup'), { createdAt: serverTimestamp(), by: uid });
    await batch.commit();
    setProfileNonce((n) => n + 1);
    await setDoc(doc(db, 'settings', 'app'), { ...DEFAULT_SETTINGS, updatedAt: serverTimestamp() });
    const n = Math.max(0, Math.min(100, Number(tableCount) || 0));
    if (n > 0) {
      const tb = writeBatch(db);
      for (let i = 1; i <= n; i += 1) {
        tb.set(doc(db, 'tables', `T${String(i).padStart(2, '0')}`), {
          name: `Table ${i}`, seats: 4, sortOrder: i, activeOrderId: null, updatedAt: serverTimestamp(),
        });
      }
      await tb.commit();
    }
    setSetupDone(true);
  };

  const user = useMemo(() => (profile ? {
    uid: profile.uid, name: profile.name || profile.email, email: profile.email, role: profile.role, active: profile.active,
  } : null), [profile]);

  const value = {
    loading: fbUser === undefined || (fbUser && profile === undefined),
    fbUser,
    user,
    isAdmin: user?.role === 'admin' && user?.active,
    isStaff: !!user?.active,
    setupDone,
    setupError,
    checkSetup,
    login,
    logout,
    resetPassword,
    bootstrapAdmin,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
