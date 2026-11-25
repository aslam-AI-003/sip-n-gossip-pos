import { collection, getDocs, onSnapshot, query, where, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '../firebase.js';

const ts = (d) => Timestamp.fromDate(d);
const rows = (qs) => qs.docs.map((d) => ({ id: d.id, ...d.data() }));

export function rangeQueries(from, to, { withExpenses = true, withPayments = true } = {}) {
  const q = {
    orders: query(collection(db, 'orders'), where('closedAt', '>=', ts(from)), where('closedAt', '<=', ts(to)), orderBy('closedAt', 'asc')),
  };
  if (withPayments) {
    q.payments = query(collection(db, 'payments'), where('at', '>=', ts(from)), where('at', '<=', ts(to)), orderBy('at', 'asc'));
  }
  if (withExpenses) {
    q.expenses = query(collection(db, 'expenses'), where('date', '>=', ts(from)), where('date', '<=', ts(to)), orderBy('date', 'asc'));
  }
  return q;
}

/** One-off fetch (always from the server; Firestore has no persistent cache here). */
export async function fetchRange(from, to, opts) {
  const q = rangeQueries(from, to, opts);
  const entries = await Promise.all(Object.entries(q).map(async ([k, v]) => [k, rows(await getDocs(v))]));
  return Object.fromEntries(entries);
}

/** Realtime listener over a range; calls cb({orders,payments,expenses}). */
export function watchRange(from, to, cb, onError, opts) {
  const q = rangeQueries(from, to, opts);
  const state = {};
  const keys = Object.keys(q);
  const unsubs = keys.map((k) => onSnapshot(q[k], (qs) => {
    state[k] = rows(qs);
    if (keys.every((x) => state[x])) cb({ ...state });
  }, onError));
  return () => unsubs.forEach((u) => u());
}
