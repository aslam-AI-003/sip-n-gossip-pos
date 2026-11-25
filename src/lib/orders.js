import {
  doc, collection, runTransaction, serverTimestamp, updateDoc, increment, getDocFromServer,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import {
  computeTotals, billConfigFromSettings, paymentSummary, validatePayments, sumAmounts, round2, PAYMENT_METHODS,
} from './calc.js';

export const newId = (col) => doc(collection(db, col)).id;

/** Read the order back from the server so the caller only ever sees confirmed data. */
export async function fetchOrder(orderId) {
  const s = await getDocFromServer(doc(db, 'orders', orderId));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

async function confirmed(promise, orderId) {
  const res = await promise;
  try {
    const order = await fetchOrder(orderId);
    if (order) return { ...res, order };
  } catch { /* transaction already committed; fall back to local copy */ }
  // Local copy: replace serverTimestamp() placeholders with the device time.
  const order = { ...res.order };
  for (const k of ['createdAt', 'updatedAt', 'billedAt', 'closedAt', 'cancelledAt']) {
    if (order[k] && typeof order[k].toDate !== 'function' && !(order[k] instanceof Date)) order[k] = new Date();
  }
  return { ...res, order };
}

export class ConflictError extends Error {
  constructor(msg) { super(msg); this.code = 'conflict'; }
}

export function formatBillNo(prefix, n) {
  return `${prefix || ''}${String(n).padStart(5, '0')}`;
}

async function readCounter(tx, name) {
  const ref = doc(db, 'counters', name);
  const snap = await tx.get(ref);
  const current = snap.exists() ? Number(snap.data().value) || 0 : 0;
  return { ref, exists: snap.exists(), next: current + 1 };
}

function writeCounter(tx, c) {
  if (c.exists) tx.update(c.ref, { value: c.next });
  else tx.set(c.ref, { value: c.next });
}

function cleanItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Add at least one item to the order.');
  return items.map((l) => {
    const qty = Math.floor(Number(l.qty));
    const price = Number(l.price);
    if (!l.name || !Number.isFinite(qty) || qty <= 0) throw new Error(`Invalid quantity for ${l.name || 'item'}.`);
    if (!Number.isFinite(price) || price < 0) throw new Error(`Invalid price for ${l.name}.`);
    return {
      lineId: String(l.lineId),
      productId: l.productId || null,
      name: String(l.name),
      category: l.category || '',
      price: round2(price),
      qty,
      note: (l.note || '').slice(0, 200),
      isAddon: !!l.isAddon,
    };
  });
}

function cleanCustomer(c = {}) {
  return {
    name: String(c.name || '').trim().slice(0, 80),
    phone: String(c.phone || '').replace(/[^\d+]/g, '').slice(0, 15),
  };
}

function cleanDiscount(d) {
  if (!d || !(Number(d.value) > 0)) return null;
  return { type: d.type === 'percent' ? 'percent' : 'flat', value: round2(Number(d.value)), reason: (d.reason || '').slice(0, 100) };
}

function buildPaymentEntries(payments, user) {
  return (payments || []).map((p) => ({
    id: String(p.id),
    method: p.method,
    amount: round2(Number(p.amount)),
    ref: String(p.ref || '').trim().slice(0, 60),
    tendered: p.method === 'cash' && Number(p.tendered) > 0 ? round2(Number(p.tendered)) : null,
    change: p.method === 'cash' && Number(p.change) > 0 ? round2(Number(p.change)) : null,
    at: Date.now(),
    by: user.uid,
    byName: user.name || '',
  }));
}

function writeLedger(tx, entry, order, kind, extra = {}) {
  tx.set(doc(db, 'payments', entry.id), {
    kind,
    orderId: order.id,
    orderNo: order.orderNo,
    billNo: order.billNo || null,
    orderType: order.type,
    method: entry.method,
    amount: entry.amount,
    ref: entry.ref || '',
    at: serverTimestamp(),
    by: entry.by,
    byName: entry.byName,
    ...extra,
  });
}

/**
 * Create or update an order, optionally finalising it (bill + payments) in
 * the same atomic transaction.
 *
 * input: {
 *   orderId, expectedVersion (null for new), type, table: {id,name}|null,
 *   customer, items, discount, notes, payments: [], finalize: bool
 * }
 */
export function saveOrder(input, settings, user) {
  return confirmed(saveOrderTx(input, settings, user), input.orderId);
}

async function saveOrderTx(input, settings, user) {
  const items = cleanItems(input.items);
  const customer = cleanCustomer(input.customer);
  const discount = cleanDiscount(input.discount);
  const type = ['dine_in', 'takeaway', 'parcel'].includes(input.type) ? input.type : 'takeaway';
  const table = type === 'dine_in' ? input.table : null;
  if (type === 'dine_in' && !table?.id) throw new Error('Select a table for dine-in orders.');
  for (const p of input.payments || []) {
    if (!PAYMENT_METHODS[p.method]) throw new Error('Invalid payment method.');
  }

  const orderRef = doc(db, 'orders', input.orderId);

  return runTransaction(db, async (tx) => {
    // ---- reads ----
    const snap = await tx.get(orderRef);
    const existing = snap.exists() ? { id: snap.id, ...snap.data() } : null;

    if (existing) {
      if (input.expectedVersion == null) {
        // Same order id already saved (e.g. a retried click). Do not create a duplicate.
        return { order: existing, duplicate: true };
      }
      if (input.finalize && existing.status === 'completed'
        && (input.payments || []).every((p) => (existing.payments || []).some((x) => x.id === String(p.id)))) {
        // Retried "Confirm payment" after the first attempt committed.
        return { order: existing, duplicate: true };
      }
      if (existing.status !== 'active') {
        throw new ConflictError(`This order is already ${existing.status}. Reload it before making changes.`);
      }
      if (existing.version !== input.expectedVersion) {
        throw new ConflictError('This order was changed on another device. Reload the order and try again.');
      }
    }

    const newTableRef = table ? doc(db, 'tables', table.id) : null;
    const oldTableId = existing?.tableId || null;
    const oldTableRef = oldTableId && oldTableId !== table?.id ? doc(db, 'tables', oldTableId) : null;
    const newTableSnap = newTableRef ? await tx.get(newTableRef) : null;
    const oldTableSnap = oldTableRef ? await tx.get(oldTableRef) : null;

    if (newTableRef) {
      if (!newTableSnap.exists()) throw new Error('Selected table no longer exists.');
      const occupant = newTableSnap.data().activeOrderId;
      if (occupant && occupant !== input.orderId) {
        throw new ConflictError(`${newTableSnap.data().name || 'This table'} already has an active order.`);
      }
    }

    const orderCounter = existing ? null : await readCounter(tx, 'orders');
    const invoiceCounter = input.finalize ? await readCounter(tx, 'invoice') : null;

    const paymentInputs = input.payments || [];
    const paymentSnaps = await Promise.all(paymentInputs.map((p) => tx.get(doc(db, 'payments', String(p.id)))));
    const freshPayments = paymentInputs.filter((_, i) => !paymentSnaps[i].exists());

    // ---- compute ----
    const config = existing?.config || billConfigFromSettings(settings);
    const totals = computeTotals(items, discount, type, config);
    const prevPayments = existing?.payments || [];
    const err = validatePayments(totals.grandTotal, prevPayments, freshPayments);
    if (err) throw new Error(err);
    const newEntries = buildPaymentEntries(freshPayments, user);
    const payments = [...prevPayments, ...newEntries];
    const summary = paymentSummary(totals.grandTotal, payments, []);

    const now = serverTimestamp();
    const orderNo = existing ? existing.orderNo : orderCounter.next;
    const billNo = input.finalize ? formatBillNo(settings?.invoicePrefix, invoiceCounter.next) : null;
    const status = input.finalize ? 'completed' : 'active';

    const data = {
      type,
      tableId: table?.id || null,
      tableName: table?.name || null,
      customer,
      items,
      notes: (input.notes || '').slice(0, 300),
      discount,
      config,
      totals,
      grandTotal: totals.grandTotal,
      payments,
      amountPaid: summary.paid,
      paymentStatus: summary.status,
      status,
      updatedAt: now,
      updatedBy: user.uid,
      version: existing ? existing.version + 1 : 1,
    };
    if (input.finalize) {
      data.billNo = billNo;
      data.billedAt = now;
      data.closedAt = now;
      data.billedBy = user.uid;
      data.billedByName = user.name || '';
    }

    // ---- writes ----
    if (existing) {
      tx.update(orderRef, data);
    } else {
      writeCounter(tx, orderCounter);
      tx.set(orderRef, {
        ...data,
        orderNo,
        billNo: data.billNo || null,
        refunds: [],
        amountRefunded: 0,
        printCount: 0,
        createdAt: now,
        createdBy: user.uid,
        createdByName: user.name || '',
      });
    }
    if (invoiceCounter) writeCounter(tx, invoiceCounter);

    const orderForLedger = { id: input.orderId, orderNo, billNo: billNo || existing?.billNo, type };
    newEntries.forEach((e) => writeLedger(tx, e, orderForLedger, 'payment'));

    // Table occupancy
    if (oldTableRef && oldTableSnap?.exists() && oldTableSnap.data().activeOrderId === input.orderId) {
      tx.update(oldTableRef, { activeOrderId: null, updatedAt: now });
    }
    if (newTableRef) {
      const target = input.finalize ? null : input.orderId;
      if (newTableSnap.data().activeOrderId !== target) {
        tx.update(newTableRef, { activeOrderId: target, updatedAt: now });
      }
    }

    return {
      order: { id: input.orderId, ...data, orderNo, billNo: data.billNo || existing?.billNo || null, refunds: existing?.refunds || [], amountRefunded: existing?.amountRefunded || 0, createdByName: existing?.createdByName || user.name },
      duplicate: false,
    };
  });
}

/** Collect a balance on a completed bill with pending / partial payment. */
export function addPayments(orderId, payments, user) {
  return confirmed(addPaymentsTx(orderId, payments, user), orderId);
}

async function addPaymentsTx(orderId, payments, user) {
  const orderRef = doc(db, 'orders', orderId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error('Order not found.');
    const order = { id: snap.id, ...snap.data() };
    if (order.status !== 'completed') throw new Error('Only completed bills can receive balance payments here.');
    const snaps = await Promise.all(payments.map((p) => tx.get(doc(db, 'payments', String(p.id)))));
    const fresh = payments.filter((_, i) => !snaps[i].exists());
    if (fresh.length === 0) return { order, duplicate: true };
    const err = validatePayments(order.grandTotal, order.payments, fresh);
    if (err) throw new Error(err);
    const entries = buildPaymentEntries(fresh, user);
    const all = [...order.payments, ...entries];
    const summary = paymentSummary(order.grandTotal, all, order.refunds);
    const update = {
      payments: all,
      amountPaid: summary.paid,
      paymentStatus: summary.status,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
      version: (order.version || 1) + 1,
    };
    tx.update(orderRef, update);
    entries.forEach((e) => writeLedger(tx, e, order, 'payment'));
    return { order: { ...order, ...update }, duplicate: false };
  });
}

export async function cancelOrder(orderId, expectedVersion, reason, user) {
  const orderRef = doc(db, 'orders', orderId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error('Order not found.');
    const order = snap.data();
    if (order.status !== 'active') throw new Error(`Order is already ${order.status}.`);
    if (expectedVersion != null && order.version !== expectedVersion) {
      throw new ConflictError('This order was changed on another device. Reload and try again.');
    }
    if ((order.amountPaid || 0) > 0) throw new Error('This order has payments recorded. Complete the bill and record a refund instead.');
    const tableRef = order.tableId ? doc(db, 'tables', order.tableId) : null;
    const tableSnap = tableRef ? await tx.get(tableRef) : null;
    const now = serverTimestamp();
    tx.update(orderRef, {
      status: 'cancelled',
      cancelReason: String(reason || '').slice(0, 200),
      cancelledAt: now,
      cancelledBy: user.uid,
      cancelledByName: user.name || '',
      closedAt: now,
      updatedAt: now,
      updatedBy: user.uid,
      version: order.version + 1,
    });
    if (tableSnap?.exists() && tableSnap.data().activeOrderId === orderId) {
      tx.update(tableRef, { activeOrderId: null, updatedAt: now });
    }
  });
}

/** Admin only (enforced by security rules). */
export function recordRefund(orderId, refund, user) {
  return confirmed(recordRefundTx(orderId, refund, user), orderId);
}

async function recordRefundTx(orderId, refund, user) {
  const orderRef = doc(db, 'orders', orderId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error('Order not found.');
    const order = { id: snap.id, ...snap.data() };
    const ledgerSnap = await tx.get(doc(db, 'payments', String(refund.id)));
    if (ledgerSnap.exists()) return { order, duplicate: true };
    const amount = round2(Number(refund.amount));
    if (!(amount > 0)) throw new Error('Refund amount must be greater than zero.');
    if (!PAYMENT_METHODS[refund.method]) throw new Error('Invalid refund method.');
    const refundable = round2(sumAmounts(order.payments) - sumAmounts(order.refunds));
    if (amount > refundable) throw new Error(`Refund cannot exceed amount paid (₹${refundable}).`);
    const entry = {
      id: String(refund.id), method: refund.method, amount,
      reason: String(refund.reason || '').slice(0, 200), at: Date.now(), by: user.uid, byName: user.name || '',
    };
    const refunds = [...(order.refunds || []), entry];
    const summary = paymentSummary(order.grandTotal, order.payments, refunds);
    const update = {
      refunds,
      amountRefunded: summary.refunded,
      paymentStatus: summary.status,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
      version: (order.version || 1) + 1,
    };
    tx.update(orderRef, update);
    writeLedger(tx, { ...entry, ref: '' }, order, 'refund', { reason: entry.reason });
    return { order: { ...order, ...update }, duplicate: false };
  });
}

/** Non-critical bookkeeping; failures are ignored. */
export function markPrinted(orderId) {
  updateDoc(doc(db, 'orders', orderId), { printCount: increment(1), lastPrintedAt: serverTimestamp() }).catch(() => {});
}
