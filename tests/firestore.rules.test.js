import { readFileSync } from 'node:fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, collection, getDocs,
} from 'firebase/firestore';

let env;
const PID = 'demo-sng-rules';

const baseOrder = (uid, extra = {}) => ({
  type: 'takeaway', status: 'active', orderNo: 1, version: 1, createdBy: uid, items: [{ name: 'X', price: 100, qty: 1 }],
  totals: { grandTotal: 100 }, grandTotal: 100, amountPaid: 0, amountRefunded: 0, refunds: [], payments: [], discount: null,
  paymentStatus: 'pending', ...extra,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await env?.cleanup(); });

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'meta/setup'), { by: 'admin' });
    await setDoc(doc(db, 'users/admin'), { role: 'admin', active: true, name: 'A' });
    await setDoc(doc(db, 'users/cash'), { role: 'cashier', active: true, name: 'C' });
    await setDoc(doc(db, 'users/off'), { role: 'cashier', active: false, name: 'D' });
    await setDoc(doc(db, 'settings/app'), { cashierCanDiscount: false, cashierCanCancel: false });
    await setDoc(doc(db, 'products/p1'), { name: 'Tea', price: 20, available: true });
    await setDoc(doc(db, 'tables/T1'), { name: 'Table 1', activeOrderId: null });
    await setDoc(doc(db, 'counters/orders'), { value: 5 });
    await setDoc(doc(db, 'orders/done'), baseOrder('cash', { status: 'completed', billNo: 'SNG-1', amountPaid: 40, payments: [{ id: 'x', amount: 40 }], paymentStatus: 'partial' }));
    await setDoc(doc(db, 'orders/open'), baseOrder('cash', { orderNo: 2 }));
  });
}

const as = (uid) => env.authenticatedContext(uid).firestore();

describe('first-run bootstrap', () => {
  beforeEach(async () => { await env.clearFirestore(); });

  it('lets the first user become admin together with meta/setup', async () => {
    const db = as('owner');
    const b = writeBatch(db);
    b.set(doc(db, 'users/owner'), { role: 'admin', active: true, name: 'Owner' });
    b.set(doc(db, 'meta/setup'), { by: 'owner', createdAt: serverTimestamp() });
    await assertSucceeds(b.commit());
  });

  it('rejects self-made admin once setup exists', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'meta/setup'), { by: 'x' }));
    const db = as('intruder');
    await assertFails(setDoc(doc(db, 'users/intruder'), { role: 'admin', active: true }));
    const b = writeBatch(db);
    b.set(doc(db, 'users/intruder'), { role: 'admin', active: true });
    b.set(doc(db, 'meta/setup'), { by: 'intruder' });
    await assertFails(b.commit());
  });

  it('rejects a self-made profile without meta/setup in the same batch', async () => {
    await assertFails(setDoc(doc(as('u1'), 'users/u1'), { role: 'admin', active: true }));
  });
});

describe('access control', () => {
  beforeEach(async () => { await env.clearFirestore(); await seed(); });

  it('blocks anonymous and profile-less users', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'orders/open')));
    await assertFails(getDoc(doc(as('stranger'), 'products/p1')));
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'meta/setup')));
  });

  it('blocks disabled staff', async () => {
    await assertFails(getDoc(doc(as('off'), 'products/p1')));
    await assertFails(setDoc(doc(as('off'), 'orders/new'), baseOrder('off')));
  });

  it('cashier reads menu but cannot edit it', async () => {
    const db = as('cash');
    await assertSucceeds(getDoc(doc(db, 'products/p1')));
    await assertFails(updateDoc(doc(db, 'products/p1'), { price: 1 }));
    await assertFails(setDoc(doc(db, 'settings/app'), { gstPercent: 0 }));
    await assertSucceeds(updateDoc(doc(as('admin'), 'products/p1'), { price: 25 }));
  });

  it('admin product writes require valid price', async () => {
    await assertFails(setDoc(doc(as('admin'), 'products/p2'), { name: 'Bad', price: -1, available: true }));
    await assertFails(setDoc(doc(as('admin'), 'products/p2'), { name: 'Bad', price: '10', available: true }));
  });

  it('expenses and staff list are admin-only', async () => {
    await assertFails(getDocs(collection(as('cash'), 'expenses')));
    await assertFails(setDoc(doc(as('cash'), 'expenses/e1'), { name: 'Milk', amount: 10 }));
    await assertSucceeds(setDoc(doc(as('admin'), 'expenses/e1'), { name: 'Milk', amount: 10 }));
    await assertFails(getDoc(doc(as('cash'), 'users/admin')));
    await assertSucceeds(getDoc(doc(as('cash'), 'users/cash')));
  });

  it('cashier cannot promote themselves', async () => {
    await assertFails(updateDoc(doc(as('cash'), 'users/cash'), { role: 'admin' }));
  });

  it('admin cannot demote or disable themselves', async () => {
    await assertFails(updateDoc(doc(as('admin'), 'users/admin'), { role: 'cashier' }));
    await assertFails(updateDoc(doc(as('admin'), 'users/admin'), { active: false }));
    await assertSucceeds(updateDoc(doc(as('admin'), 'users/cash'), { active: false }));
  });
});

describe('orders', () => {
  beforeEach(async () => { await env.clearFirestore(); await seed(); });

  it('cashier creates a valid order', async () => {
    await assertSucceeds(setDoc(doc(as('cash'), 'orders/n1'), baseOrder('cash')));
  });

  it('rejects forged creator, pre-filled refunds, overpayment and discounts without permission', async () => {
    const db = as('cash');
    await assertFails(setDoc(doc(db, 'orders/n1'), baseOrder('admin')));
    await assertFails(setDoc(doc(db, 'orders/n1'), baseOrder('cash', { refunds: [{ amount: 1 }] })));
    await assertFails(setDoc(doc(db, 'orders/n1'), baseOrder('cash', { amountPaid: 150 })));
    await assertFails(setDoc(doc(db, 'orders/n1'), baseOrder('cash', { discount: { type: 'flat', value: 10 } })));
    await assertSucceeds(setDoc(doc(as('admin'), 'orders/n2'), baseOrder('admin', { discount: { type: 'flat', value: 10 } })));
  });

  it('allows cashier discounts when enabled in settings', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'settings/app'), { cashierCanDiscount: true, cashierCanCancel: true }));
    await assertSucceeds(setDoc(doc(as('cash'), 'orders/n1'), baseOrder('cash', { discount: { type: 'flat', value: 10 } })));
  });

  it('orders can never be deleted', async () => {
    await assertFails(deleteDoc(doc(as('cash'), 'orders/open')));
    await assertFails(deleteDoc(doc(as('admin'), 'orders/open')));
  });

  it('cashier edits active order only with version bump', async () => {
    const db = as('cash');
    await assertFails(updateDoc(doc(db, 'orders/open'), { notes: 'x' }));
    await assertSucceeds(updateDoc(doc(db, 'orders/open'), { notes: 'x', version: 2 }));
  });

  it('cashier cannot cancel when the setting is off', async () => {
    await assertFails(updateDoc(doc(as('cash'), 'orders/open'), { status: 'cancelled', version: 2 }));
  });

  it('cashier cannot change items on a completed bill, but can collect the balance', async () => {
    const db = as('cash');
    await assertFails(updateDoc(doc(db, 'orders/done'), { items: [], version: 2 }));
    await assertFails(updateDoc(doc(db, 'orders/done'), { grandTotal: 1, version: 2 }));
    await assertFails(updateDoc(doc(db, 'orders/done'), { payments: [], amountPaid: 0, version: 2 }));
    await assertFails(updateDoc(doc(db, 'orders/done'), { payments: [{ id: 'x' }, { id: 'y' }], amountPaid: 140, version: 2 }));
    await assertSucceeds(updateDoc(doc(db, 'orders/done'), { payments: [{ id: 'x' }, { id: 'y' }], amountPaid: 100, paymentStatus: 'paid', version: 2 }));
  });

  it('only admin records refunds', async () => {
    await assertFails(updateDoc(doc(as('cash'), 'orders/done'), { refunds: [{ amount: 10 }], amountRefunded: 10, version: 2 }));
    await assertSucceeds(updateDoc(doc(as('admin'), 'orders/done'), { refunds: [{ amount: 10 }], amountRefunded: 10, version: 2 }));
    await assertFails(setDoc(doc(as('cash'), 'payments/r1'), { kind: 'refund', amount: 10, method: 'cash', by: 'cash' }));
    await assertSucceeds(setDoc(doc(as('admin'), 'payments/r1'), { kind: 'refund', amount: 10, method: 'cash', by: 'admin' }));
  });

  it('payment ledger is append-only and validated', async () => {
    const db = as('cash');
    await assertSucceeds(setDoc(doc(db, 'payments/p1'), { kind: 'payment', amount: 10, method: 'upi', by: 'cash' }));
    await assertFails(setDoc(doc(db, 'payments/p1'), { kind: 'payment', amount: 99, method: 'upi', by: 'cash' }));
    await assertFails(deleteDoc(doc(db, 'payments/p1')));
    await assertFails(setDoc(doc(db, 'payments/p2'), { kind: 'payment', amount: 0, method: 'upi', by: 'cash' }));
    await assertFails(setDoc(doc(db, 'payments/p3'), { kind: 'payment', amount: 5, method: 'crypto', by: 'cash' }));
  });

  it('reprint bookkeeping is allowed on any order', async () => {
    await assertSucceeds(updateDoc(doc(as('cash'), 'orders/done'), { printCount: 1, lastPrintedAt: serverTimestamp() }));
  });
});

describe('counters and tables', () => {
  beforeEach(async () => { await env.clearFirestore(); await seed(); });

  it('counters only move forward by one', async () => {
    const db = as('cash');
    await assertSucceeds(updateDoc(doc(db, 'counters/orders'), { value: 6 }));
    await assertFails(updateDoc(doc(db, 'counters/orders'), { value: 100 }));
    await assertFails(updateDoc(doc(db, 'counters/orders'), { value: 5 }));
    await assertFails(setDoc(doc(db, 'counters/invoice'), { value: 50 }));
    await assertSucceeds(setDoc(doc(db, 'counters/invoice'), { value: 1 }));
  });

  it('cashier may only change table occupancy', async () => {
    const db = as('cash');
    await assertSucceeds(updateDoc(doc(db, 'tables/T1'), { activeOrderId: 'o1', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db, 'tables/T1'), { name: 'VIP' }));
    await assertFails(deleteDoc(doc(db, 'tables/T1')));
  });
});
