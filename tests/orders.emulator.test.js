// A TCP proxy between the app's Firestore client and the emulator, so the
// tests can cut the network the way a real connection loss would.
const PROXY_PORT = 8085;
const proxy = { server: null, sockets: new Set(), up: true };
function startProxy() {
  proxy.server = net.createServer((client) => {
    if (!proxy.up) { client.destroy(); return; }
    const upstream = net.connect(8080, '127.0.0.1');
    proxy.sockets.add(client); proxy.sockets.add(upstream);
    client.pipe(upstream); upstream.pipe(client);
    const done = () => { client.destroy(); upstream.destroy(); proxy.sockets.delete(client); proxy.sockets.delete(upstream); };
    client.on('error', done); upstream.on('error', done); client.on('close', done); upstream.on('close', done);
  });
  return new Promise((r) => proxy.server.listen(PROXY_PORT, '127.0.0.1', r));
}
function cutNetwork() { proxy.up = false; proxy.sockets.forEach((s) => s.destroy()); }
function restoreNetwork() { proxy.up = true; }

// Runs the real app data layer (src/lib/orders.js) against the Firestore +
// Auth emulators with the production security rules enforced.
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import net from 'node:net';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, db } from '../src/firebase.js';
import { saveOrder, addPayments, cancelOrder, recordRefund, newId } from '../src/lib/orders.js';
import { withDefaults } from '../src/lib/defaults.js';

const PID = 'demo-sng';
let env;
const uids = {};
const settings = withDefaults({ invoicePrefix: 'SNG-', gstEnabled: true, gstPercent: 5, parcelCharge: 5, parcelMode: 'per_item', roundOff: true });
const admin = () => ({ uid: uids.admin, name: 'Owner' });
const cashier = () => ({ uid: uids.cashier, name: 'Cashier' });

async function login(who) {
  await signOut(auth);
  await signInWithEmailAndPassword(auth, `${who}@sng.test`, 'password123');
}

const tea = { lineId: 'l1', productId: 'tea', name: 'Tea', category: 'Hot Beverages', price: 20, qty: 2 };
const burger = { lineId: 'l2', productId: 'burger', name: 'Burger', category: 'Burger', price: 120, qty: 1 };

beforeAll(async () => {
  await startProxy();
  env = await initializeTestEnvironment({
    projectId: PID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  await env.clearFirestore();
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PID}/accounts`, { method: 'DELETE' });
  for (const who of ['admin', 'cashier']) {
    const c = await createUserWithEmailAndPassword(auth, `${who}@sng.test`, 'password123'); // eslint-disable-line no-await-in-loop
    uids[who] = c.user.uid;
  }
  await env.withSecurityRulesDisabled(async (ctx) => {
    const x = ctx.firestore();
    await setDoc(doc(x, 'meta/setup'), { by: uids.admin });
    await setDoc(doc(x, `users/${uids.admin}`), { role: 'admin', active: true, name: 'Owner' });
    await setDoc(doc(x, `users/${uids.cashier}`), { role: 'cashier', active: true, name: 'Cashier' });
    await setDoc(doc(x, 'settings/app'), { ...settings, cashierCanDiscount: false, cashierCanCancel: true });
    await setDoc(doc(x, 'tables/T01'), { name: 'Table 1', activeOrderId: null });
    await setDoc(doc(x, 'tables/T02'), { name: 'Table 2', activeOrderId: null });
  });
  await login('cashier');
}, 30000);

afterAll(async () => { await signOut(auth); await env?.cleanup(); proxy.server?.close(); });

const tableState = async (id) => (await getDoc(doc(db, 'tables', id))).data().activeOrderId;

describe('dine-in lifecycle', () => {
  const orderId = newId('orders');
  let version;

  it('saves an active dine-in order and occupies the table', async () => {
    const { order, duplicate } = await saveOrder({ orderId, expectedVersion: null, type: 'dine_in', table: { id: 'T01', name: 'Table 1' }, items: [tea] }, settings, cashier());
    expect(duplicate).toBe(false);
    expect(order.status).toBe('active');
    expect(order.orderNo).toBe(1);
    expect(order.billNo).toBeNull();
    expect(order.grandTotal).toBe(42); // 40 + 5% GST = 42
    expect(await tableState('T01')).toBe(orderId);
    version = order.version;
  });

  it('does not create a duplicate when the same save is retried', async () => {
    const { duplicate } = await saveOrder({ orderId, expectedVersion: null, type: 'dine_in', table: { id: 'T01', name: 'Table 1' }, items: [tea] }, settings, cashier());
    expect(duplicate).toBe(true);
    const all = await getDocs(collection(db, 'orders'));
    expect(all.size).toBe(1);
  });

  it('refuses a second order on an occupied table', async () => {
    await expect(saveOrder({ orderId: newId('orders'), expectedVersion: null, type: 'dine_in', table: { id: 'T01', name: 'Table 1' }, items: [tea] }, settings, cashier()))
      .rejects.toThrow(/already has an active order/);
  });

  it('adds items to the active order', async () => {
    const { order } = await saveOrder({ orderId, expectedVersion: version, type: 'dine_in', table: { id: 'T01', name: 'Table 1' }, items: [tea, burger] }, settings, cashier());
    expect(order.version).toBe(version + 1);
    expect(order.totals.subtotal).toBe(160);
    expect(order.grandTotal).toBe(168);
    version = order.version;
  });

  it('rejects stale edits from another device', async () => {
    await expect(saveOrder({ orderId, expectedVersion: version - 1, type: 'dine_in', table: { id: 'T01', name: 'Table 1' }, items: [tea] }, settings, cashier()))
      .rejects.toThrow(/changed on another device/);
  });

  it('rejects a cashier discount when not permitted', async () => {
    await expect(saveOrder({ orderId, expectedVersion: version, type: 'dine_in', table: { id: 'T01', name: 'Table 1' }, items: [tea, burger], discount: { type: 'flat', value: 10 } }, settings, cashier()))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects overpayment', async () => {
    await expect(saveOrder({ orderId, expectedVersion: version, type: 'dine_in', table: { id: 'T01', name: 'Table 1' }, items: [tea, burger], finalize: true, payments: [{ id: newId('payments'), method: 'cash', amount: 500 }] }, settings, cashier()))
      .rejects.toThrow(/exceed/);
  });

  const pay = [{ id: newId('payments'), method: 'cash', amount: 100, tendered: 200, change: 100 }, { id: newId('payments'), method: 'upi', amount: 68, ref: 'UTR123' }];

  it('bills with a split payment, assigns an invoice number and frees the table', async () => {
    const { order } = await saveOrder({ orderId, expectedVersion: version, type: 'dine_in', table: { id: 'T01', name: 'Table 1' }, items: [tea, burger], finalize: true, payments: pay }, settings, cashier());
    expect(order.status).toBe('completed');
    expect(order.billNo).toBe('SNG-00001');
    expect(order.paymentStatus).toBe('paid');
    expect(order.amountPaid).toBe(168);
    expect(order.payments).toHaveLength(2);
    expect(order.billedAt.toDate()).toBeInstanceOf(Date);
    expect(await tableState('T01')).toBeNull();
    const ledger = await getDocs(collection(db, 'payments'));
    expect(ledger.size).toBe(2);
  });

  it('a retried payment confirmation does not duplicate the bill or payments', async () => {
    const { duplicate, order } = await saveOrder({ orderId, expectedVersion: version, type: 'dine_in', table: { id: 'T01', name: 'Table 1' }, items: [tea, burger], finalize: true, payments: pay }, settings, cashier());
    expect(duplicate).toBe(true);
    expect(order.billNo).toBe('SNG-00001');
    expect((await getDocs(collection(db, 'payments'))).size).toBe(2);
  });

  it('cashier cannot refund; admin can', async () => {
    await expect(recordRefund(orderId, { id: newId('payments'), amount: 10, method: 'cash', reason: 'x' }, cashier()))
      .rejects.toMatchObject({ code: 'permission-denied' });
    await login('admin');
    const { order } = await recordRefund(orderId, { id: newId('payments'), amount: 168, method: 'cash', reason: 'Wrong order' }, admin());
    expect(order.paymentStatus).toBe('refunded');
    expect(order.amountRefunded).toBe(168);
    await expect(recordRefund(orderId, { id: newId('payments'), amount: 1, method: 'cash', reason: 'again' }, admin())).rejects.toThrow(/cannot exceed/);
    await login('cashier');
  });
});

describe('takeaway / parcel with pending payments', () => {
  it('bills a parcel order with parcel charges and pending payment, then collects the balance', async () => {
    const orderId = newId('orders');
    const { order } = await saveOrder({ orderId, expectedVersion: null, type: 'parcel', customer: { name: 'Anu', phone: '98470 00000' }, items: [tea, burger], finalize: true, payments: [] }, settings, cashier());
    // subtotal 160 + parcel 3 units x 5 = 175; GST 5% = 8.75; total 183.75 -> rounded 184
    expect(order.totals.parcelCharge).toBe(15);
    expect(order.totals.gst).toBe(8.75);
    expect(order.grandTotal).toBe(184);
    expect(order.paymentStatus).toBe('pending');
    expect(order.billNo).toBe('SNG-00002');
    expect(order.customer.phone).toBe('9847000000');

    const p1 = await addPayments(orderId, [{ id: newId('payments'), method: 'card', amount: 100 }], cashier());
    expect(p1.order.paymentStatus).toBe('partial');
    await expect(addPayments(orderId, [{ id: newId('payments'), method: 'cash', amount: 100 }], cashier())).rejects.toThrow(/exceed/);
    const p2 = await addPayments(orderId, [{ id: newId('payments'), method: 'online', amount: 84 }], cashier());
    expect(p2.order.paymentStatus).toBe('paid');
  });

  it('takeaway orders never get parcel charges', async () => {
    const { order } = await saveOrder({ orderId: newId('orders'), expectedVersion: null, type: 'takeaway', items: [tea], finalize: true, payments: [{ id: newId('payments'), method: 'cash', amount: 42 }] }, settings, cashier());
    expect(order.totals.parcelCharge).toBe(0);
    expect(order.grandTotal).toBe(42);
  });
});

describe('cancellation', () => {
  it('cancels an active order and frees the table', async () => {
    const orderId = newId('orders');
    const { order } = await saveOrder({ orderId, expectedVersion: null, type: 'dine_in', table: { id: 'T02', name: 'Table 2' }, items: [tea] }, settings, cashier());
    expect(await tableState('T02')).toBe(orderId);
    await cancelOrder(orderId, order.version, 'Customer left', cashier());
    const snap = (await getDoc(doc(db, 'orders', orderId))).data();
    expect(snap.status).toBe('cancelled');
    expect(snap.billNo).toBeNull();
    expect(await tableState('T02')).toBeNull();
  });
});

describe('online-only', () => {
  it('fails instead of queueing when the connection drops, and nothing is written', async () => {
    const orderId = newId('orders');
    cutNetwork();
    const started = Date.now();
    await expect(saveOrder({ orderId, expectedVersion: null, type: 'takeaway', items: [tea], finalize: true, payments: [{ id: newId('payments'), method: 'cash', amount: 42 }] }, settings, cashier()))
      .rejects.toThrow();
    console.log(`offline save rejected after ${Date.now() - started} ms`);
    restoreNetwork();
    // Verify on the server (rules disabled) that no order or payment was written.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), 'orders', orderId));
      expect(snap.exists()).toBe(false);
    });
  }, 90000);

  it('works again after the connection is restored', async () => {
    const { order } = await saveOrder({ orderId: newId('orders'), expectedVersion: null, type: 'takeaway', items: [tea], finalize: true, payments: [] }, settings, cashier());
    expect(order.status).toBe('completed');
  }, 60000);
});
