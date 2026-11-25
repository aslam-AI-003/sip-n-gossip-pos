import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useAuth } from './AuthContext.jsx';
import { withDefaults } from '../lib/defaults.js';

// Live (realtime) shared data: settings, menu and tables. Changes made on any
// device are pushed to every other signed-in device by Firestore listeners.
const DataCtx = createContext(null);

export function DataProvider({ children }) {
  const { isStaff } = useAuth();
  const [settingsRaw, setSettingsRaw] = useState(null);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [tables, setTables] = useState([]);
  const [loaded, setLoaded] = useState({ settings: false, categories: false, products: false, tables: false });
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!isStaff) return undefined;
    const mark = (k) => { setError(null); setLoaded((l) => (l[k] ? l : { ...l, [k]: true })); };
    // A failed Firestore listener never restarts by itself (e.g. rejected while
    // a brand-new profile was still being committed). Resubscribe after a delay.
    let retry = null;
    const onErr = (e) => {
      setError(e);
      if (!retry) retry = setTimeout(() => setNonce((n) => n + 1), 3000);
    };
    const unsubs = [
      onSnapshot(doc(db, 'settings', 'app'), (s) => { setSettingsRaw(s.exists() ? s.data() : {}); mark('settings'); }, onErr),
      onSnapshot(collection(db, 'categories'), (qs) => {
        setCategories(qs.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.name.localeCompare(b.name)));
        mark('categories');
      }, onErr),
      onSnapshot(collection(db, 'products'), (qs) => {
        setProducts(qs.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999) || a.name.localeCompare(b.name)));
        mark('products');
      }, onErr),
      onSnapshot(collection(db, 'tables'), (qs) => {
        setTables(qs.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.name.localeCompare(b.name, undefined, { numeric: true })));
        mark('tables');
      }, onErr),
    ];
    return () => { unsubs.forEach((u) => u()); clearTimeout(retry); };
  }, [isStaff, nonce]);

  const settings = useMemo(() => withDefaults(settingsRaw || {}), [settingsRaw]);
  const categoryById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);

  const value = {
    settings,
    categories,
    categoryById,
    products,
    tables,
    ready: Object.values(loaded).every(Boolean),
    error,
  };
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export const useData = () => useContext(DataCtx);
