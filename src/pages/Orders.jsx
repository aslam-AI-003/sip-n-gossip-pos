import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where, orderBy, Timestamp } from 'firebase/firestore';
import { FiSearch } from 'react-icons/fi';
import { db } from '../firebase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { ORDER_TYPES } from '../lib/calc.js';
import { inr, fmtDateTime, fmtTime, isoDate, parseIsoDate, startOfDay, endOfDay, addDays, errorMessage, toDate } from '../lib/format.js';
import OrderDetail, { StatusBadges } from '../components/OrderDetail.jsx';

const TABS = [
  { id: 'active', label: 'Active' },
  { id: 'pending', label: 'Pending payment' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

export default function Orders() {
  const { isAdmin } = useAuth();
  const { settings } = useData();
  const [tab, setTab] = useState('active');
  const [from, setFrom] = useState(isoDate());
  const [to, setTo] = useState(isoDate());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);

  // Cashiers see a limited history window (UI restriction; admins unrestricted).
  const minDate = isAdmin ? undefined : isoDate(addDays(new Date(), -Math.max(0, Number(settings.cashierHistoryDays) || 0)));

  useEffect(() => {
    setLoading(true);
    setErr('');
    let qry;
    const col = collection(db, 'orders');
    if (tab === 'active') qry = query(col, where('status', '==', 'active'));
    else if (tab === 'pending') qry = query(col, where('paymentStatus', 'in', ['pending', 'partial']));
    else {
      const f = startOfDay(parseIsoDate(minDate && from < minDate ? minDate : from));
      const t = endOfDay(parseIsoDate(to));
      qry = query(col, where('closedAt', '>=', Timestamp.fromDate(f)), where('closedAt', '<=', Timestamp.fromDate(t)), orderBy('closedAt', 'desc'));
    }
    return onSnapshot(qry, (qs) => {
      let list = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (tab === 'pending') list = list.filter((o) => o.status === 'completed');
      if (tab === 'completed') list = list.filter((o) => o.status === 'completed');
      if (tab === 'cancelled') list = list.filter((o) => o.status === 'cancelled');
      if (tab === 'active' || tab === 'pending') list.sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
      setRows(list);
      setLoading(false);
    }, (e) => { setErr(errorMessage(e)); setLoading(false); });
  }, [tab, from, to, minDate]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((o) => [o.billNo, `#${o.orderNo}`, String(o.orderNo), o.customer?.name, o.customer?.phone, o.tableName]
      .some((v) => v && String(v).toLowerCase().includes(s)));
  }, [rows, q]);

  const total = filtered.reduce((s, o) => s + (o.grandTotal || 0), 0);
  const due = filtered.reduce((s, o) => s + Math.max(0, (o.grandTotal || 0) - (o.amountPaid || 0)), 0);

  return (
    <div className="page">
      <div className="page-head">
        <div className="seg">
          {TABS.map((t) => <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
        </div>
        <div className="search" style={{ flex: 1, maxWidth: 360 }}>
          <FiSearch />
          <input placeholder="Bill no, order no, customer, phone, table" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {tab === 'completed' || tab === 'cancelled' ? (
        <div className="row wrap" style={{ marginBottom: 12 }}>
          <div><label>From</label><input type="date" value={from} min={minDate} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label>To</label><input type="date" value={to} min={from} max={isoDate()} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      ) : null}

      {err ? <div className="alert error">{err}</div> : null}
      <div className="row wrap" style={{ marginBottom: 10, gap: 16 }}>
        <span className="muted">{filtered.length} orders</span>
        {tab !== 'cancelled' ? <span>Total <strong>{inr(total)}</strong></span> : null}
        {tab === 'pending' || tab === 'active' ? <span>Unpaid <strong style={{ color: '#ffd27a' }}>{inr(due)}</strong></span> : null}
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? <div className="empty"><span className="spinner" /></div> : null}
        {!loading && filtered.length === 0 ? <div className="empty">No orders.</div> : null}
        {!loading && filtered.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Bill / Order</th><th className="hide-sm">Type</th><th className="hide-sm">Time</th><th>Status</th><th className="num">Total</th></tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => setOpen(o)}>
                    <td>
                      <strong>{o.billNo || `#${o.orderNo}`}</strong>
                      {o.billNo ? <small> · #{o.orderNo}</small> : null}
                      <div><small>{o.tableName || o.customer?.name || ''}</small></div>
                    </td>
                    <td className="hide-sm">{ORDER_TYPES[o.type]}</td>
                    <td className="hide-sm" title={fmtDateTime(o.closedAt || o.createdAt)}>{fmtTime(o.closedAt || o.createdAt)}</td>
                    <td><StatusBadges order={o} /></td>
                    <td className="num"><strong>{inr(o.grandTotal)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {open ? <OrderDetail orderId={open.id} initial={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
