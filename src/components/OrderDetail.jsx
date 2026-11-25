import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { FiEdit, FiCreditCard, FiXCircle, FiRotateCcw, FiPrinter } from 'react-icons/fi';
import { db } from '../firebase.js';
import Modal from './Modal.jsx';
import PaymentModal from './PaymentModal.jsx';
import ReceiptModal from './ReceiptModal.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { useConnection } from '../context/ConnectionContext.jsx';
import { ORDER_TYPES, PAYMENT_METHODS, PAYMENT_STATUS_LABEL, lineTotal, round2, sumAmounts } from '../lib/calc.js';
import { inr, fmtDateTime, errorMessage } from '../lib/format.js';
import { addPayments, cancelOrder, recordRefund, newId } from '../lib/orders.js';

export function StatusBadges({ order }) {
  const st = { active: 'gold', completed: 'green', cancelled: 'red' }[order.status] || '';
  const ps = { paid: 'green', partial: 'warn', pending: 'warn', refunded: 'red' }[order.paymentStatus] || '';
  return (
    <span className="row" style={{ gap: 4, display: 'inline-flex' }}>
      <span className={`badge ${st}`} style={{ textTransform: 'capitalize' }}>{order.status}</span>
      {order.status !== 'cancelled' ? <span className={`badge ${ps}`}>{PAYMENT_STATUS_LABEL[order.paymentStatus]}</span> : null}
    </span>
  );
}

export default function OrderDetail({ orderId, initial, onClose }) {
  const { user, isAdmin } = useAuth();
  const { settings } = useData();
  const { online, verify } = useConnection();
  const navigate = useNavigate();
  const [order, setOrder] = useState(initial || null);
  const [mode, setMode] = useState(null); // 'pay' | 'refund' | 'cancel' | 'receipt'
  const [err, setErr] = useState('');

  useEffect(() => onSnapshot(doc(db, 'orders', orderId), (s) => s.exists() && setOrder({ id: s.id, ...s.data() }), (e) => setErr(errorMessage(e))), [orderId]);

  if (!order) return <Modal title="Order" onClose={onClose}><span className="spinner" /></Modal>;

  const t = order.totals || {};
  const balance = round2(order.grandTotal - order.amountPaid);
  const canCancel = order.status === 'active' && (isAdmin || settings.cashierCanCancel) && !(order.amountPaid > 0);
  const refundable = round2(sumAmounts(order.payments) - sumAmounts(order.refunds));

  if (mode === 'receipt') return <ReceiptModal order={order} settings={settings} onClose={() => setMode(null)} />;
  if (mode === 'pay') {
    return (
      <PaymentModal
        title={`Collect balance · ${order.billNo}`}
        grandTotal={order.grandTotal}
        alreadyPaid={order.amountPaid}
        methods={settings.paymentMethods}
        allowPending={false}
        allowPartial
        onClose={() => setMode(null)}
        onConfirm={async (payments) => {
          if (!(await verify())) throw new Error('No connection. Payment was not recorded.');
          try {
            await addPayments(order.id, payments, user);
            setMode(null);
          } catch (e) { throw new Error(errorMessage(e)); }
        }}
      />
    );
  }
  if (mode === 'refund') return <RefundModal order={order} max={refundable} user={user} onClose={() => setMode(null)} />;
  if (mode === 'cancel') return <CancelModal order={order} user={user} onClose={() => setMode(null)} />;

  return (
    <Modal
      wide
      title={<>{order.billNo ? `Bill ${order.billNo}` : `Order #${order.orderNo}`}</>}
      onClose={onClose}
      footer={(
        <>
          {order.status === 'active' ? (
            <>
              {canCancel ? <button type="button" className="btn danger" disabled={!online} onClick={() => setMode('cancel')}><FiXCircle />Cancel order</button> : null}
              <button type="button" className="btn" onClick={() => navigate(`/pos?order=${order.id}`)}><FiEdit />Add / edit items</button>
              <button type="button" className="btn emerald" onClick={() => navigate(`/pos?order=${order.id}&pay=1`)}><FiCreditCard />Bill &amp; pay</button>
            </>
          ) : null}
          {order.status === 'completed' && balance > 0 ? (
            <button type="button" className="btn emerald" disabled={!online} onClick={() => setMode('pay')}><FiCreditCard />Collect {inr(balance)}</button>
          ) : null}
          {order.status === 'completed' && isAdmin && refundable > 0 ? (
            <button type="button" className="btn danger" disabled={!online} onClick={() => setMode('refund')}><FiRotateCcw />Refund</button>
          ) : null}
          <button type="button" className="btn gold" onClick={() => setMode('receipt')}><FiPrinter />Receipt</button>
        </>
      )}
    >
      {err ? <div className="alert error">{err}</div> : null}
      <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <StatusBadges order={order} />
        <small>Order #{order.orderNo} · {ORDER_TYPES[order.type]}{order.tableName ? ` · ${order.tableName}` : ''}</small>
      </div>
      <div className="grid-2" style={{ marginBottom: 12 }}>
        <div>
          <small>Created</small>
          <div>{fmtDateTime(order.createdAt)} by {order.createdByName || '-'}</div>
          {order.billedAt ? <><small>Billed</small><div>{fmtDateTime(order.billedAt)} by {order.billedByName || '-'}</div></> : null}
          {order.cancelledAt ? <><small>Cancelled</small><div>{fmtDateTime(order.cancelledAt)} by {order.cancelledByName}{order.cancelReason ? ` – ${order.cancelReason}` : ''}</div></> : null}
        </div>
        <div>
          {order.customer?.name || order.customer?.phone ? <><small>Customer</small><div>{order.customer.name} {order.customer.phone}</div></> : null}
          {order.notes ? <><small>Instructions</small><div>{order.notes}</div></> : null}
        </div>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {order.items.map((l) => (
              <tr key={l.lineId}>
                <td>{l.name}{l.note ? <div><small>* {l.note}</small></div> : null}</td>
                <td className="num">{l.qty}</td>
                <td className="num">{inr(l.price)}</td>
                <td className="num">{inr(lineTotal(l))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid-2" style={{ marginTop: 12 }}>
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>Payments</h3>
          {order.payments.length === 0 ? <small>No payments recorded.</small> : null}
          {order.payments.map((p) => (
            <div key={p.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>{PAYMENT_METHODS[p.method]}{p.ref ? <small> · {p.ref}</small> : null}<br /><small>{fmtDateTime(p.at)} · {p.byName}</small></span>
              <strong>{inr(p.amount)}</strong>
            </div>
          ))}
          {order.refunds?.length ? <hr /> : null}
          {order.refunds?.map((r) => (
            <div key={r.id} className="row" style={{ justifyContent: 'space-between', color: '#ff9b94' }}>
              <span>Refund · {PAYMENT_METHODS[r.method]}<br /><small>{fmtDateTime(r.at)} · {r.reason}</small></span>
              <strong>-{inr(r.amount)}</strong>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="totals" style={{ margin: 0 }}>
            <div><span>Subtotal</span><span>{inr(t.subtotal)}</span></div>
            {t.discount > 0 ? <div><span>Discount</span><span>-{inr(t.discount)}</span></div> : null}
            {t.parcelCharge > 0 ? <div><span>Parcel charges</span><span>{inr(t.parcelCharge)}</span></div> : null}
            {t.gst > 0 ? <div><span>GST {t.gstPercent}%</span><span>{inr(t.gst)}</span></div> : null}
            {t.roundOff ? <div><span>Round off</span><span>{inr(t.roundOff)}</span></div> : null}
            <div className="grand" style={{ color: 'var(--gold)', fontWeight: 800, fontSize: 18 }}><span>Grand total</span><span>{inr(t.grandTotal)}</span></div>
            <div><span>Paid</span><span>{inr(order.amountPaid)}</span></div>
            {order.amountRefunded > 0 ? <div><span>Refunded</span><span>-{inr(order.amountRefunded)}</span></div> : null}
            {order.status !== 'cancelled' && balance > 0 ? <div style={{ color: '#ffd27a', fontWeight: 700 }}><span>Balance due</span><span>{inr(balance)}</span></div> : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function RefundModal({ order, max, user, onClose }) {
  const { verify, online } = useConnection();
  const [id] = useState(() => newId('payments'));
  const [amount, setAmount] = useState(String(max));
  const [method, setMethod] = useState(order.payments[0]?.method || 'cash');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    if (!reason.trim()) { setErr('Enter a reason for the refund.'); return; }
    setBusy(true);
    try {
      if (!(await verify())) throw new Error('No connection. Refund was not recorded.');
      await recordRefund(order.id, { id, amount: Number(amount), method, reason }, user);
      onClose();
    } catch (e) { setErr(errorMessage(e)); setBusy(false); }
  };
  return (
    <Modal title={`Refund · ${order.billNo}`} onClose={onClose} busy={busy} footer={(
      <button type="button" className="btn danger" disabled={busy || !online} onClick={submit}>{busy ? <span className="spinner sm" /> : null}Record refund</button>
    )}>
      {err ? <div className="alert error">{err}</div> : null}
      <p className="muted" style={{ marginTop: 0 }}>Refundable: {inr(max)}. This records the refund; return the money to the customer separately.</p>
      <div className="grid-2">
        <div className="field"><label>Amount</label><input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="field"><label>Refund method</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </div>
      </div>
      <div className="field"><label>Reason</label><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></div>
    </Modal>
  );
}

function CancelModal({ order, user, onClose }) {
  const { verify, online } = useConnection();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    if (!reason.trim()) { setErr('Enter a reason for cancelling.'); return; }
    setBusy(true);
    try {
      if (!(await verify())) throw new Error('No connection. Order was not cancelled.');
      await cancelOrder(order.id, order.version, reason, user);
      onClose();
    } catch (e) { setErr(errorMessage(e)); setBusy(false); }
  };
  return (
    <Modal title={`Cancel order #${order.orderNo}`} onClose={onClose} busy={busy} footer={(
      <button type="button" className="btn danger" disabled={busy || !online} onClick={submit}>{busy ? <span className="spinner sm" /> : null}Cancel order</button>
    )}>
      {err ? <div className="alert error">{err}</div> : null}
      <p className="muted" style={{ marginTop: 0 }}>The order is kept in history as cancelled{order.tableName ? ` and ${order.tableName} is freed` : ''}.</p>
      <div className="field"><label>Reason</label><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus /></div>
    </Modal>
  );
}
