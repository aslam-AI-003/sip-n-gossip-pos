import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area,
} from 'recharts';
import { db } from '../firebase.js';
import { watchRange, fetchRange } from '../lib/queries.js';
import { summarize, series } from '../lib/stats.js';
import {
  inr, fmtTime, startOfDay, endOfDay, startOfWeek, startOfMonth, addDays, errorMessage,
} from '../lib/format.js';
import { ORDER_TYPES } from '../lib/calc.js';
import OrderDetail, { StatusBadges } from '../components/OrderDetail.jsx';

const PERIODS = {
  today: { label: 'Today', from: () => startOfDay() },
  week: { label: 'This week', from: () => startOfWeek() },
  month: { label: 'This month', from: () => startOfMonth() },
};

const TRENDS = {
  day: { label: 'Daily (30 days)', from: () => addDays(startOfDay(), -29) },
  week: { label: 'Weekly (12 weeks)', from: () => addDays(startOfWeek(), -7 * 11) },
  month: { label: 'Monthly (12 months)', from: () => { const d = startOfMonth(); d.setMonth(d.getMonth() - 11); return d; } },
};

const tip = { contentStyle: { background: '#171717', border: '1px solid #2b2b2b', borderRadius: 8 }, labelStyle: { color: '#d4af37' } };

export default function Dashboard() {
  const [period, setPeriod] = useState('today');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [pendingAll, setPendingAll] = useState([]);
  const [activeCount, setActiveCount] = useState(0);
  const [trend, setTrend] = useState('day');
  const [trendData, setTrendData] = useState(null);
  const [trendBusy, setTrendBusy] = useState(false);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    setData(null);
    return watchRange(PERIODS[period].from(), endOfDay(), setData, (e) => setErr(errorMessage(e)));
  }, [period]);

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'orders'), where('paymentStatus', 'in', ['pending', 'partial'])),
      (qs) => setPendingAll(qs.docs.map((d) => d.data()).filter((o) => o.status === 'completed')), () => {});
    const u2 = onSnapshot(query(collection(db, 'orders'), where('status', '==', 'active')), (qs) => setActiveCount(qs.size), () => {});
    return () => { u1(); u2(); };
  }, []);

  useEffect(() => {
    let cancel = false;
    setTrendBusy(true);
    const from = TRENDS[trend].from();
    const to = endOfDay();
    fetchRange(from, to, { withExpenses: false, withPayments: false })
      .then((r) => { if (!cancel) setTrendData(series(r.orders, trend, from, to)); })
      .catch((e) => !cancel && setErr(errorMessage(e)))
      .finally(() => !cancel && setTrendBusy(false));
    return () => { cancel = true; };
  }, [trend]);

  const s = useMemo(() => (data ? summarize(data) : null), [data]);
  const hourly = useMemo(() => (data && period === 'today' ? series(data.orders, 'hour', startOfDay(), endOfDay()) : null), [data, period]);
  const recent = useMemo(() => (data ? [...data.orders].reverse().slice(0, 8) : []), [data]);
  const pendingTotal = pendingAll.reduce((a, o) => a + Math.max(0, o.grandTotal - o.amountPaid), 0);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Dashboard</h1>
        <div className="seg">
          {Object.entries(PERIODS).map(([k, v]) => <button key={k} type="button" className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{v.label}</button>)}
        </div>
      </div>
      {err ? <div className="alert error">{err}</div> : null}
      {!s ? <div className="empty"><span className="spinner" /></div> : (
        <>
          <div className="kpis">
            <Kpi k={`${PERIODS[period].label} sales`} v={inr(s.revenue)} cls="gold" />
            <Kpi k="Bills" v={s.billCount} />
            <Kpi k="Active orders" v={activeCount} />
            <Kpi k="Cash" v={inr(s.collections.cash)} />
            <Kpi k="UPI" v={inr(s.collections.upi)} />
            <Kpi k="Card" v={inr(s.collections.card)} />
            <Kpi k="Online" v={inr(s.collections.online)} />
            <Kpi k="Pending payments (all)" v={inr(pendingTotal)} cls={pendingTotal > 0 ? 'red' : ''} />
            <Kpi k="Expenses" v={inr(s.expenses)} cls="red" />
            <Kpi k="Estimated profit" v={inr(s.estimatedProfit)} cls={s.estimatedProfit >= 0 ? 'green' : 'red'} />
          </div>
          <p className="muted" style={{ marginTop: -6, fontSize: 12 }}>
            Sales = completed bills (grand total). Collections = payments received in the period. Estimated profit = sales − GST − refunds − expenses.
          </p>

          {hourly ? (
            <div className="card">
              <div className="card-title"><h2>Hourly sales (today)</h2></div>
              <div style={{ height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={hourly.filter((h) => h.key >= 6 || h.sales > 0)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2b2b2b" />
                    <XAxis dataKey="label" stroke="#a49f93" fontSize={11} />
                    <YAxis stroke="#a49f93" fontSize={11} width={50} />
                    <Tooltip {...tip} formatter={(v, n) => (n === 'sales' ? inr(v) : v)} />
                    <Bar dataKey="sales" fill="#d4af37" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : null}

          <div className="card">
            <div className="card-title">
              <h2>Sales trend</h2>
              <div className="seg">
                {Object.entries(TRENDS).map(([k, v]) => <button key={k} type="button" className={trend === k ? 'on' : ''} onClick={() => setTrend(k)}>{v.label}</button>)}
              </div>
            </div>
            <div style={{ height: 260, position: 'relative' }}>
              {trendBusy ? <div className="empty"><span className="spinner" /></div> : null}
              {!trendBusy && trendData ? (
                <ResponsiveContainer>
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10a36f" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#10a36f" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2b2b2b" />
                    <XAxis dataKey="label" stroke="#a49f93" fontSize={11} />
                    <YAxis stroke="#a49f93" fontSize={11} width={56} />
                    <Tooltip {...tip} formatter={(v, n) => (n === 'sales' ? inr(v) : v)} />
                    <Area type="monotone" dataKey="sales" stroke="#16c487" fill="url(#g1)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          </div>

          <div className="grid-2" style={{ marginTop: 14 }}>
            <div className="card" style={{ marginTop: 0 }}>
              <div className="card-title"><h2>Best sellers</h2></div>
              {s.products.length === 0 ? <div className="empty">No sales yet.</div> : (
                <table className="data">
                  <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Sales</th></tr></thead>
                  <tbody>{s.products.slice(0, 10).map((p) => <tr key={p.name}><td>{p.name}</td><td className="num">{p.qty}</td><td className="num">{inr(p.amount)}</td></tr>)}</tbody>
                </table>
              )}
            </div>
            <div className="card" style={{ marginTop: 0 }}>
              <div className="card-title"><h2>Category sales</h2></div>
              {s.categories.length === 0 ? <div className="empty">No sales yet.</div> : (
                <div style={{ height: Math.max(200, s.categories.slice(0, 12).length * 30) }}>
                  <ResponsiveContainer>
                    <BarChart data={s.categories.slice(0, 12)} layout="vertical" margin={{ left: 10 }}>
                      <XAxis type="number" stroke="#a49f93" fontSize={11} />
                      <YAxis type="category" dataKey="name" stroke="#a49f93" fontSize={11} width={120} />
                      <Tooltip {...tip} formatter={(v) => inr(v)} />
                      <Bar dataKey="amount" fill="#10a36f" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-title"><h2>Recent orders</h2></div>
            {recent.length === 0 ? <div className="empty">No closed orders in this period.</div> : (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Bill</th><th className="hide-sm">Type</th><th className="hide-sm">Time</th><th>Status</th><th className="num">Total</th></tr></thead>
                  <tbody>
                    {recent.map((o) => (
                      <tr key={o.id} className="clickable" onClick={() => setOpen(o)}>
                        <td><strong>{o.billNo || `#${o.orderNo}`}</strong></td>
                        <td className="hide-sm">{ORDER_TYPES[o.type]}</td>
                        <td className="hide-sm">{fmtTime(o.closedAt)}</td>
                        <td><StatusBadges order={o} /></td>
                        <td className="num">{inr(o.grandTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
      {open ? <OrderDetail orderId={open.id} initial={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function Kpi({ k, v, cls = '' }) {
  return <div className={`kpi ${cls}`}><div className="k">{k}</div><div className="v">{v}</div></div>;
}
