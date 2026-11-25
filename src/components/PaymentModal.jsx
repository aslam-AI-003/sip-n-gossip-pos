import { useMemo, useState } from 'react';
import { FiPlus, FiTrash2 } from 'react-icons/fi';
import Modal from './Modal.jsx';
import { PAYMENT_METHODS, sumAmounts, cashChange, round2 } from '../lib/calc.js';
import { inr } from '../lib/format.js';
import { newId } from '../lib/orders.js';
import { useConnection } from '../context/ConnectionContext.jsx';

/**
 * Collect one or more payments against a balance.
 * onConfirm(payments) must return a promise; the modal stays open and shows
 * the error if it rejects, so nothing is reported as saved unless Firestore
 * confirmed it.
 */
export default function PaymentModal({
  title = 'Payment', grandTotal, alreadyPaid = 0, methods, onConfirm, onClose, allowPending = true, allowPartial = allowPending, summary,
}) {
  const { online } = useConnection();
  const enabled = Object.keys(PAYMENT_METHODS).filter((m) => !methods || methods[m] !== false);
  const balance = round2(grandTotal - alreadyPaid);
  const [rows, setRows] = useState(() => [{ id: newId('payments'), method: enabled[0] || 'cash', amount: String(balance), ref: '' }]);
  const [tendered, setTendered] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const entered = useMemo(() => sumAmounts(rows.map((r) => ({ amount: Number(r.amount) || 0 }))), [rows]);
  const remaining = round2(balance - entered);
  const cashRow = rows.find((r) => r.method === 'cash');
  const cashAmt = cashRow ? Number(cashRow.amount) || 0 : 0;
  const change = cashRow ? cashChange(tendered, cashAmt) : 0;
  const tenderShort = cashRow && tendered !== '' && Number(tendered) < cashAmt;

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const full = (method) => setRows([{ id: rows[0]?.id || newId('payments'), method, amount: String(balance), ref: '' }]);
  const addRow = () => {
    const used = new Set(rows.map((r) => r.method));
    const method = enabled.find((m) => !used.has(m)) || enabled[0];
    setRows((rs) => [...rs, { id: newId('payments'), method, amount: String(Math.max(remaining, 0)), ref: '' }]);
  };

  const submit = async (mode) => {
    setErr('');
    let payments = [];
    if (mode !== 'none') {
      payments = rows
        .filter((r) => Number(r.amount) > 0)
        .map((r) => ({
          id: r.id,
          method: r.method,
          amount: round2(Number(r.amount)),
          ref: r.ref,
          tendered: r.method === 'cash' && Number(tendered) > 0 ? Number(tendered) : null,
          change: r.method === 'cash' ? change : null,
        }));
      if (payments.length === 0) { setErr('Enter a payment amount.'); return; }
      if (remaining < 0) { setErr(`Payments exceed the balance by ${inr(-remaining)}.`); return; }
      if (mode === 'full' && remaining !== 0) { setErr(`Still ${inr(remaining)} to collect.`); return; }
      if (tenderShort) { setErr('Cash received is less than the cash amount.'); return; }
    }
    setBusy(true);
    try {
      await onConfirm(payments);
    } catch (e) {
      setErr(e.userMessage || e.message || 'Payment was not saved.');
      setBusy(false);
    }
  };

  const fully = remaining === 0 && entered > 0;

  return (
    <Modal
      title={title}
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          {allowPending ? (
            <button type="button" className="btn" disabled={busy || !online} onClick={() => submit('none')}>
              Bill as pending (no payment)
            </button>
          ) : null}
          {allowPartial && entered > 0 && remaining > 0 ? (
            <button type="button" className="btn" disabled={busy || !online} onClick={() => submit('partial')}>
              Save partial ({inr(remaining)} due)
            </button>
          ) : null}
          <button type="button" className="btn emerald lg" disabled={busy || !online || !fully} onClick={() => submit('full')}>
            {busy ? <span className="spinner sm" /> : null}
            {busy ? 'Saving…' : `Confirm ${inr(entered)}`}
          </button>
        </>
      )}
    >
      {!online ? <div className="alert error">Offline. Payments cannot be recorded until the connection is restored.</div> : null}
      {err ? <div className="alert error">{err}</div> : null}
      {summary}
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <small>Amount due</small>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--gold)' }}>{inr(balance)}</div>
          {alreadyPaid > 0 ? <small>Already paid {inr(alreadyPaid)} of {inr(grandTotal)}</small> : null}
        </div>
        <div style={{ textAlign: 'right' }}>
          <small>Remaining</small>
          <div style={{ fontSize: 20, fontWeight: 700, color: remaining === 0 ? 'var(--emerald-2)' : remaining < 0 ? 'var(--danger)' : 'var(--text)' }}>{inr(remaining)}</div>
        </div>
      </div>

      <label>Quick full payment</label>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        {enabled.map((m) => (
          <button key={m} type="button" className="btn" onClick={() => full(m)} disabled={busy}>{PAYMENT_METHODS[m]}</button>
        ))}
      </div>

      <label>Payment split</label>
      {rows.map((r, i) => (
        <div key={r.id} className="card" style={{ padding: 10, marginBottom: 8 }}>
          <div className="row">
            <select value={r.method} onChange={(e) => setRow(i, { method: e.target.value })} style={{ maxWidth: 130 }} disabled={busy}>
              {enabled.map((m) => <option key={m} value={m}>{PAYMENT_METHODS[m]}</option>)}
            </select>
            <input
              className="grow" type="number" inputMode="decimal" min="0" step="0.01" placeholder="Amount"
              value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} disabled={busy}
            />
            {rows.length > 1 ? (
              <button type="button" className="btn ghost icon-btn" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Remove payment" disabled={busy}><FiTrash2 /></button>
            ) : null}
          </div>
          {r.method !== 'cash' ? (
            <input style={{ marginTop: 8 }} placeholder="Reference / UTR / last 4 digits (optional)" value={r.ref} onChange={(e) => setRow(i, { ref: e.target.value })} disabled={busy} />
          ) : null}
        </div>
      ))}
      {rows.length < 4 ? (
        <button type="button" className="btn sm" onClick={addRow} disabled={busy}><FiPlus />Split payment</button>
      ) : null}

      {cashRow ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="grid-2">
            <div>
              <label htmlFor="tendered">Cash received from customer</label>
              <input id="tendered" type="number" inputMode="decimal" min="0" step="1" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={String(cashAmt)} disabled={busy} />
            </div>
            <div>
              <label>Change to return</label>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--emerald-2)', minHeight: 44, display: 'flex', alignItems: 'center' }}>{inr(change)}</div>
            </div>
          </div>
          {tenderShort ? <small style={{ color: 'var(--danger)' }}>Cash received is less than the cash amount.</small> : null}
        </div>
      ) : null}
    </Modal>
  );
}
