export function inr(value, { decimals = 2, symbol = '₹' } = {}) {
  const n = Number(value) || 0;
  const s = Math.abs(n).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${n < 0 ? '-' : ''}${symbol}${s}`;
}

/** Price shown on menu cards: no decimals when whole rupees. */
export function price(value, symbol = '₹') {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? `${symbol}${n.toLocaleString('en-IN')}` : inr(n, { symbol });
}

export function toDate(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts === 'number') return new Date(ts);
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  return new Date(ts);
}

export function fmtDateTime(ts) {
  const d = toDate(ts);
  if (!d) return '-';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

export function fmtDate(ts) {
  const d = toDate(ts);
  if (!d) return '-';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtTime(ts) {
  const d = toDate(ts);
  if (!d) return '-';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/** yyyy-mm-dd in local time (for <input type="date">). */
export function isoDate(d = new Date()) {
  const x = toDate(d);
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${x.getFullYear()}-${m}-${day}`;
}

export function parseIsoDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function startOfDay(d = new Date()) {
  const x = new Date(toDate(d));
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d = new Date()) {
  const x = new Date(toDate(d));
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d, n) {
  const x = new Date(toDate(d));
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday-based week start. */
export function startOfWeek(d = new Date()) {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7;
  return addDays(x, -day);
}

export function startOfMonth(d = new Date()) {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u2018\u2019']/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function errorMessage(err) {
  if (!err) return 'Unknown error';
  const code = err.code || '';
  if (code === 'permission-denied') return 'You do not have permission for this action.';
  if (code === 'unavailable' || /offline/i.test(err.message || '')) {
    return 'Could not reach the server. Check the internet connection and try again. Nothing was saved.';
  }
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Incorrect email or password.';
  }
  if (code === 'auth/too-many-requests') return 'Too many attempts. Please wait and try again.';
  if (code === 'auth/email-already-in-use') return 'That email already has an account.';
  if (code === 'auth/weak-password') return 'Password must be at least 6 characters.';
  return err.message || String(err);
}
