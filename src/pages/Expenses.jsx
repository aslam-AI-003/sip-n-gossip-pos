import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  collection, onSnapshot, query, where, orderBy, Timestamp, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { FiPlus, FiEdit, FiTrash2, FiDownload } from 'react-icons/fi';
import { db } from '../firebase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { useConnection } from '../context/ConnectionContext.jsx';
import Modal from '../components/Modal.jsx';
import { inr, fmtDate, isoDate, parseIsoDate, startOfDay, endOfDay, startOfMonth, errorMessage } from '../lib/format.js';
import { exportCsv, exportXlsx, exportPdf } from '../lib/exporters.js';
import { round2 } from '../lib/calc.js';

export const EXPENSE_METHODS = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank transfer', online: 'Online' };

export default function Expenses() {
  const { settings } = useData();
  const [from, setFrom] = useState(isoDate(startOfMonth()));
  const [to, setTo] = useState(isoDate());
  const [cat, setCat] = useState('');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);

  useEffect(() => {
    setRows(null);
    const q = query(collection(db, 'expenses'),
      where('date', '>=', Timestamp.fromDate(startOfDay(parseIsoDate(from)))),
      where('date', '<=', Timestamp.fromDate(endOfDay(parseIsoDate(to)))),
      orderBy('date', 'desc'));
    return onSnapshot(q, (qs) => setRows(qs.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => setErr(errorMessage(e)));
  }, [from, to]);

  const list = useMemo(() => (rows || []).filter((r) => !cat || r.category === cat), [rows, cat]);
  const total = round2(list.reduce((s, r) => s + r.amount, 0));
  const byCat = useMemo(() => {
    const m = new Map();
    list.forEach((r) => m.set(r.category, round2((m.get(r.category) || 0) + r.amount)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [list]);

  const sheets = [
    { name: 'Expenses by category', columns: [{ label: 'Category', key: 'c' }, { label: 'Amount', key: 'a', money: true }], rows: byCat.map(([c, a]) => ({ c, a })) },
    { name: 'Expenses', columns: [{ label: 'Date', key: 'd' }, { label: 'Expense', key: 'n' }, { label: 'Category', key: 'c' }, { label: 'Paid by', key: 'm' }, { label: 'Description', key: 'x' }, { label: 'Amount', key: 'a', money: true }],
      rows: list.map((r) => ({ d: fmtDate(r.date), n: r.name, c: r.category, m: EXPENSE_METHODS[r.paymentMethod] || '', x: r.description || '', a: r.amount })) },
  ];
  const fname = `sng-expenses-${from}_to_${to}`;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Expenses</h1>
        <div className="row wrap">
          <button type="button" className="btn" onClick={() => exportCsv(sheets, fname)} disabled={!list.length}><FiDownload />CSV</button>
          <button type="button" className="btn" onClick={() => exportXlsx(sheets, fname)} disabled={!list.length}><FiDownload />Excel</button>
          <button type="button" className="btn" onClick={() => exportPdf(sheets, fname, { title: `${settings.restaurantName} – Expenses`, subtitle: `${from} to ${to}` })} disabled={!list.length}><FiDownload />PDF</button>
          <button type="button" className="btn gold" onClick={() => setEdit({})}><FiPlus />Add expense</button>
        </div>
      </div>
      <div className="card">
        <div className="row wrap">
          <div><label>From</label><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label>To</label><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
          <div style={{ minWidth: 180 }}><label>Category</label>
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">All categories</option>
              {settings.expenseCategories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ alignSelf: 'flex-end' }}><Link to="/settings#expenses" className="btn ghost sm">Manage categories</Link></div>
        </div>
      </div>
      {err ? <div className="alert error" style={{ marginTop: 12 }}>{err}</div> : null}

      <div className="kpis" style={{ marginTop: 14 }}>
        <div className="kpi red"><div className="k">Total expenses</div><div className="v">{inr(total)}</div></div>
        {byCat.slice(0, 5).map(([c, a]) => <div key={c} className="kpi"><div className="k">{c}</div><div className="v">{inr(a)}</div></div>)}
      </div>

      <div className="card" style={{ padding: 0 }}>
        {rows === null ? <div className="empty"><span className="spinner" /></div> : null}
        {rows && list.length === 0 ? <div className="empty">No expenses in this period.</div> : null}
        {list.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Date</th><th>Expense</th><th className="hide-sm">Category</th><th className="hide-sm">Paid by</th><th className="num">Amount</th><th /></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDate(r.date)}</td>
                    <td>{r.name}{r.description ? <div><small>{r.description}</small></div> : null}</td>
                    <td className="hide-sm">{r.category}</td>
                    <td className="hide-sm">{EXPENSE_METHODS[r.paymentMethod] || ''}</td>
                    <td className="num"><strong>{inr(r.amount)}</strong></td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn ghost icon-btn" onClick={() => setEdit(r)} aria-label="Edit"><FiEdit /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
      {edit ? <ExpenseForm initial={edit} categories={settings.expenseCategories} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}

function ExpenseForm({ initial, categories, onClose }) {
  const { user } = useAuth();
  const { online } = useConnection();
  const [f, setF] = useState({
    name: initial.name || '',
    category: initial.category || categories[0],
    amount: initial.amount != null ? String(initial.amount) : '',
    date: initial.date ? isoDate(initial.date) : isoDate(),
    paymentMethod: initial.paymentMethod || 'cash',
    description: initial.description || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setErr('');
    const amount = round2(Number(f.amount));
    if (!f.name.trim()) return setErr('Enter the expense name.');
    if (!(amount > 0)) return setErr('Enter an amount greater than zero.');
    setBusy(true);
    const data = {
      name: f.name.trim(), category: f.category, amount,
      date: Timestamp.fromDate(startOfDay(parseIsoDate(f.date))),
      paymentMethod: f.paymentMethod, description: f.description.trim(),
      updatedAt: serverTimestamp(), updatedBy: user.uid,
    };
    try {
      if (initial.id) await updateDoc(doc(db, 'expenses', initial.id), data);
      else await addDoc(collection(db, 'expenses'), { ...data, createdAt: serverTimestamp(), createdBy: user.uid, createdByName: user.name });
      onClose();
    } catch (e) { setErr(errorMessage(e)); setBusy(false); }
    return null;
  };

  const remove = async () => {
    if (!window.confirm('Delete this expense?')) return;
    setBusy(true);
    try { await deleteDoc(doc(db, 'expenses', initial.id)); onClose(); } catch (e) { setErr(errorMessage(e)); setBusy(false); }
  };

  return (
    <Modal title={initial.id ? 'Edit expense' : 'Add expense'} onClose={onClose} busy={busy} footer={(
      <>
        {initial.id ? <button type="button" className="btn danger" onClick={remove} disabled={busy || !online}><FiTrash2 />Delete</button> : null}
        <button type="button" className="btn gold" onClick={save} disabled={busy || !online}>{busy ? <span className="spinner sm" /> : null}Save</button>
      </>
    )}>
      {!online ? <div className="alert error">Offline. Expenses cannot be saved.</div> : null}
      {err ? <div className="alert error">{err}</div> : null}
      <div className="field"><label>Expense name</label><input value={f.name} onChange={set('name')} autoFocus maxLength={100} /></div>
      <div className="grid-2">
        <div className="field"><label>Category</label><select value={f.category} onChange={set('category')}>{categories.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div className="field"><label>Amount (₹)</label><input type="number" inputMode="decimal" min="0" step="0.01" value={f.amount} onChange={set('amount')} /></div>
        <div className="field"><label>Date</label><input type="date" value={f.date} max={isoDate()} onChange={set('date')} /></div>
        <div className="field"><label>Payment method</label><select value={f.paymentMethod} onChange={set('paymentMethod')}>{Object.entries(EXPENSE_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      </div>
      <div className="field"><label>Description</label><textarea value={f.description} onChange={set('description')} maxLength={300} /></div>
    </Modal>
  );
}
