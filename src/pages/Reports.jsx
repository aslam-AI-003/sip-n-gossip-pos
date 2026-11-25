import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiDownload, FiRefreshCw } from 'react-icons/fi';
import { fetchRange } from '../lib/queries.js';
import { summarize, series } from '../lib/stats.js';
import { exportCsv, exportXlsx, exportPdf } from '../lib/exporters.js';
import { ORDER_TYPES, PAYMENT_METHODS } from '../lib/calc.js';
import {
  inr, fmtDate, fmtDateTime, isoDate, parseIsoDate, startOfDay, endOfDay, startOfWeek, startOfMonth, addDays, errorMessage,
} from '../lib/format.js';
import { useData } from '../context/DataContext.jsx';

function preset(id) {
  const today = startOfDay();
  switch (id) {
    case 'yesterday': return [addDays(today, -1), addDays(today, -1)];
    case 'week': return [startOfWeek(), today];
    case 'lastweek': return [addDays(startOfWeek(), -7), addDays(startOfWeek(), -1)];
    case 'month': return [startOfMonth(), today];
    case 'lastmonth': { const s = startOfMonth(); s.setMonth(s.getMonth() - 1); return [s, addDays(startOfMonth(), -1)]; }
    default: return [today, today];
  }
}

const PRESETS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['lastmonth', 'Last month'], ['custom', 'Custom']];

export default function Reports() {
  const { settings } = useData();
  const [p, setP] = useState('today');
  const [from, setFrom] = useState(isoDate());
  const [to, setTo] = useState(isoDate());
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const choose = (id) => {
    setP(id);
    if (id !== 'custom') { const [a, b] = preset(id); setFrom(isoDate(a)); setTo(isoDate(b)); }
  };

  const load = useCallback(async () => {
    setBusy(true); setErr('');
    try {
      const f = startOfDay(parseIsoDate(from));
      const t = endOfDay(parseIsoDate(to));
      const r = await fetchRange(f, t);
      setData({ ...r, from: f, to: t });
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }, [from, to]);

  useEffect(() => { if (p !== 'custom') load(); }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = useMemo(() => (data ? summarize(data) : null), [data]);
  const daily = useMemo(() => (data ? series(data.orders, 'day', data.from, data.to) : []), [data]);

  const sheets = useMemo(() => {
    if (!s) return [];
    const m = (label, key) => ({ label, key, money: true });
    return [
      { name: 'Summary', columns: [{ label: 'Metric', key: 'k' }, m('Amount', 'v')], rows: [
        { k: 'Gross sales (menu value)', v: s.grossSales },
        { k: 'Discounts', v: -s.discounts },
        { k: 'Parcel charges', v: s.parcelCharges },
        { k: 'GST collected', v: s.gst },
        { k: 'Round off', v: s.roundOff },
        { k: 'Total revenue (bills)', v: s.revenue },
        { k: 'Refunds', v: -s.refunded },
        { k: 'Net revenue excl. GST', v: s.netRevenueExTax },
        { k: 'Expenses', v: -s.expenses },
        { k: 'Estimated profit', v: s.estimatedProfit },
        { k: 'Pending dues on these bills', v: s.pendingDue },
        { k: `Bills: ${s.billCount}  ·  Avg bill`, v: s.avgBill },
        { k: `Cancelled orders: ${s.cancelledCount}`, v: s.cancelledAmount },
      ] },
      { name: 'Payments', columns: [{ label: 'Method', key: 'k' }, m('Received', 'in'), m('Refunded', 'out'), m('Net', 'net')],
        rows: [...Object.keys(PAYMENT_METHODS).map((k) => ({ k: PAYMENT_METHODS[k], in: s.collections[k] || 0, out: s.refundsByMethod[k] || 0, net: (s.collections[k] || 0) - (s.refundsByMethod[k] || 0) })),
          { k: 'Total', in: s.collected, out: s.refunded, net: s.netCollected }] },
      { name: 'Order types', columns: [{ label: 'Type', key: 'k' }, { label: 'Bills', key: 'c' }, m('Sales', 'a')],
        rows: Object.entries(s.orderTypes).map(([k, v]) => ({ k: ORDER_TYPES[k] || k, c: v.count, a: v.amount })) },
      { name: 'Daily sales', columns: [{ label: 'Date', key: 'label' }, { label: 'Bills', key: 'orders' }, m('Sales', 'sales')], rows: daily },
      { name: 'Products', columns: [{ label: 'Item', key: 'name' }, { label: 'Category', key: 'category' }, { label: 'Qty', key: 'qty' }, m('Sales (before discount)', 'amount')], rows: s.products },
      { name: 'Categories', columns: [{ label: 'Category', key: 'name' }, { label: 'Qty', key: 'qty' }, m('Sales (before discount)', 'amount')], rows: s.categories },
      { name: 'Expenses by category', columns: [{ label: 'Category', key: 'name' }, m('Amount', 'amount')], rows: s.expenseByCategory },
      { name: 'Expenses', columns: [{ label: 'Date', key: 'd' }, { label: 'Expense', key: 'name' }, { label: 'Category', key: 'category' }, { label: 'Paid by', key: 'pm' }, m('Amount', 'amount')],
        rows: data.expenses.map((e) => ({ d: fmtDate(e.date), name: e.name, category: e.category, pm: PAYMENT_METHODS[e.paymentMethod] || e.paymentMethod || '', amount: e.amount })) },
      { name: 'Discounts', columns: [{ label: 'Bill', key: 'b' }, { label: 'Date', key: 'd' }, { label: 'Discount', key: 'x' }, m('Subtotal', 's'), m('Discount amount', 'a')],
        rows: s.discountBills.map((o) => ({ b: o.billNo, d: fmtDateTime(o.billedAt), x: o.discount?.type === 'percent' ? `${o.discount.value}%` : 'Flat', s: o.totals.subtotal, a: o.totals.discount })) },
      { name: 'Refunds', columns: [{ label: 'Bill', key: 'b' }, { label: 'Date', key: 'd' }, { label: 'Method', key: 'm' }, { label: 'Reason', key: 'r' }, { label: 'By', key: 'by' }, m('Amount', 'a')],
        rows: s.refundEntries.map((r) => ({ b: r.billNo, d: fmtDateTime(r.at), m: PAYMENT_METHODS[r.method], r: r.reason || '', by: r.byName, a: r.amount })) },
      { name: 'Bills', columns: [{ label: 'Bill', key: 'b' }, { label: 'Order', key: 'o' }, { label: 'Date', key: 'd' }, { label: 'Type', key: 't' }, { label: 'Status', key: 'st' }, { label: 'Payment', key: 'ps' }, m('Total', 'g'), m('Paid', 'p')],
        rows: data.orders.map((o) => ({ b: o.billNo || '', o: o.orderNo, d: fmtDateTime(o.closedAt), t: ORDER_TYPES[o.type], st: o.status, ps: o.status === 'cancelled' ? '' : o.paymentStatus, g: o.grandTotal, p: o.amountPaid })) },
    ];
  }, [s, daily, data]);

  const fname = `sng-report-${from}_to_${to}`;
  const range = from === to ? fmtDate(parseIsoDate(from)) : `${fmtDate(parseIsoDate(from))} – ${fmtDate(parseIsoDate(to))}`;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Reports</h1>
        <div className="row wrap">
          <button type="button" className="btn" disabled={!s} onClick={() => exportCsv(sheets, fname)}><FiDownload />CSV</button>
          <button type="button" className="btn" disabled={!s} onClick={() => exportXlsx(sheets, fname).catch((e) => setErr(errorMessage(e)))}><FiDownload />Excel</button>
          <button type="button" className="btn gold" disabled={!s} onClick={() => exportPdf(sheets, fname, { title: `${settings.restaurantName} – Sales report`, subtitle: range }).catch((e) => setErr(errorMessage(e)))}><FiDownload />PDF</button>
        </div>
      </div>
      <div className="card">
        <div className="seg" style={{ marginBottom: 10 }}>
          {PRESETS.map(([id, label]) => <button key={id} type="button" className={p === id ? 'on' : ''} onClick={() => choose(id)}>{label}</button>)}
        </div>
        <div className="row wrap">
          <div><label>From</label><input type="date" value={from} max={to} onChange={(e) => { setP('custom'); setFrom(e.target.value); }} /></div>
          <div><label>To</label><input type="date" value={to} min={from} onChange={(e) => { setP('custom'); setTo(e.target.value); }} /></div>
          <div style={{ alignSelf: 'flex-end' }}><button type="button" className="btn emerald" onClick={load} disabled={busy}>{busy ? <span className="spinner sm" /> : <FiRefreshCw />}Run report</button></div>
        </div>
      </div>
      {err ? <div className="alert error" style={{ marginTop: 12 }}>{err}</div> : null}
      {busy && !s ? <div className="empty"><span className="spinner" /></div> : null}
      {s ? (
        <>
          <div className="kpis" style={{ marginTop: 14 }}>
            <K k="Total revenue" v={inr(s.revenue)} c="gold" />
            <K k="Discounts" v={inr(s.discounts)} />
            <K k="GST" v={inr(s.gst)} />
            <K k="Refunds" v={inr(s.refunded)} />
            <K k="Expenses" v={inr(s.expenses)} c="red" />
            <K k="Estimated profit" v={inr(s.estimatedProfit)} c={s.estimatedProfit >= 0 ? 'green' : 'red'} />
            <K k="Bills" v={s.billCount} />
            <K k="Collected (net)" v={inr(s.netCollected)} />
          </div>
          {sheets.map((sh) => (
            <div className="card" key={sh.name}>
              <div className="card-title"><h2>{sh.name}</h2><small>{sh.rows.length} rows</small></div>
              {sh.rows.length === 0 ? <div className="muted">No data.</div> : (
                <div className="table-wrap" style={{ maxHeight: sh.name === 'Bills' || sh.name === 'Products' ? 420 : undefined, overflowY: 'auto' }}>
                  <table className="data">
                    <thead><tr>{sh.columns.map((c) => <th key={c.key} className={c.money || typeof sh.rows[0]?.[c.key] === 'number' ? 'num' : ''}>{c.label}</th>)}</tr></thead>
                    <tbody>
                      {sh.rows.map((r, i) => (
                        <tr key={i}>{sh.columns.map((c) => <td key={c.key} className={typeof r[c.key] === 'number' ? 'num' : ''} style={{ textTransform: c.key === 'st' || c.key === 'ps' ? 'capitalize' : undefined }}>{c.money ? inr(r[c.key]) : r[c.key]}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

function K({ k, v, c = '' }) {
  return <div className={`kpi ${c}`}><div className="k">{k}</div><div className="v">{v}</div></div>;
}
