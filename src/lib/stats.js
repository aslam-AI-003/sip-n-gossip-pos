import { round2 } from './calc.js';
import { toDate, startOfDay, startOfWeek, startOfMonth, addDays } from './format.js';

const P = (n) => Math.round((Number(n) || 0) * 100);
const R = (p) => p / 100;

/**
 * Aggregate Firestore records into report figures.
 * - orders: orders closed in the period (completed + cancelled)
 * - payments: payment ledger entries dated in the period
 * - expenses: expenses dated in the period
 * Revenue figures come from completed bills; collections come from the
 * payment ledger (money actually received in the period).
 */
export function summarize({ orders = [], payments = [], expenses = [] }) {
  const bills = orders.filter((o) => o.status === 'completed');
  const cancelled = orders.filter((o) => o.status === 'cancelled');
  const acc = { gross: 0, discount: 0, parcel: 0, gst: 0, roundOff: 0, revenue: 0, due: 0, billPaid: 0 };
  const products = new Map();
  const categories = new Map();
  const orderTypes = { dine_in: { count: 0, amount: 0 }, takeaway: { count: 0, amount: 0 }, parcel: { count: 0, amount: 0 } };
  const discounts = [];

  for (const o of bills) {
    const t = o.totals || {};
    acc.gross += P(t.subtotal);
    acc.discount += P(t.discount);
    acc.parcel += P(t.parcelCharge);
    acc.gst += P(t.gst);
    acc.roundOff += P(t.roundOff);
    acc.revenue += P(o.grandTotal);
    acc.due += Math.max(0, P(o.grandTotal) - P(o.amountPaid));
    const ot = orderTypes[o.type] || (orderTypes[o.type] = { count: 0, amount: 0 });
    ot.count += 1;
    ot.amount += P(o.grandTotal);
    if (P(t.discount) > 0) discounts.push(o);
    for (const l of o.items || []) {
      const amt = P(l.price) * (Number(l.qty) || 0);
      const pk = l.productId || l.name;
      const p = products.get(pk) || { name: l.name, category: l.category || '', qty: 0, amount: 0 };
      p.qty += Number(l.qty) || 0;
      p.amount += amt;
      products.set(pk, p);
      const ck = l.category || 'Uncategorised';
      const c = categories.get(ck) || { name: ck, qty: 0, amount: 0 };
      c.qty += Number(l.qty) || 0;
      c.amount += amt;
      categories.set(ck, c);
    }
  }

  const collections = { cash: 0, upi: 0, card: 0, online: 0 };
  const refundsByMethod = { cash: 0, upi: 0, card: 0, online: 0 };
  const refunds = [];
  for (const p of payments) {
    if (p.kind === 'refund') {
      refundsByMethod[p.method] = (refundsByMethod[p.method] || 0) + P(p.amount);
      refunds.push(p);
    } else {
      collections[p.method] = (collections[p.method] || 0) + P(p.amount);
    }
  }
  const collected = Object.values(collections).reduce((a, b) => a + b, 0);
  const refunded = Object.values(refundsByMethod).reduce((a, b) => a + b, 0);

  const expenseByCat = new Map();
  let expenseTotal = 0;
  for (const e of expenses) {
    expenseTotal += P(e.amount);
    expenseByCat.set(e.category || 'Other', (expenseByCat.get(e.category || 'Other') || 0) + P(e.amount));
  }

  const netRevenueExTax = acc.revenue - acc.gst - refunded;
  const toR = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, R(v)]));

  return {
    billCount: bills.length,
    cancelledCount: cancelled.length,
    cancelledAmount: R(cancelled.reduce((s, o) => s + P(o.grandTotal), 0)),
    grossSales: R(acc.gross),
    discounts: R(acc.discount),
    parcelCharges: R(acc.parcel),
    gst: R(acc.gst),
    roundOff: R(acc.roundOff),
    revenue: R(acc.revenue),
    avgBill: bills.length ? round2(R(acc.revenue) / bills.length) : 0,
    pendingDue: R(acc.due),
    collections: toR(collections),
    collected: R(collected),
    refundsByMethod: toR(refundsByMethod),
    refunded: R(refunded),
    netCollected: R(collected - refunded),
    expenses: R(expenseTotal),
    expenseByCategory: [...expenseByCat.entries()].map(([name, v]) => ({ name, amount: R(v) })).sort((a, b) => b.amount - a.amount),
    netRevenueExTax: R(netRevenueExTax),
    estimatedProfit: R(netRevenueExTax - expenseTotal),
    products: [...products.values()].map((p) => ({ ...p, amount: R(p.amount) })).sort((a, b) => b.qty - a.qty || b.amount - a.amount),
    categories: [...categories.values()].map((c) => ({ ...c, amount: R(c.amount) })).sort((a, b) => b.amount - a.amount),
    orderTypes: Object.fromEntries(Object.entries(orderTypes).map(([k, v]) => [k, { count: v.count, amount: R(v.amount) }])),
    discountBills: discounts,
    refundEntries: refunds,
  };
}

const DAY_FMT = { day: '2-digit', month: 'short' };

/** Bucket completed bills into a time series of revenue and bill counts. */
export function series(orders, unit, from, to) {
  const start = toDate(from);
  const end = toDate(to);
  const buckets = [];
  const keyOf = (d) => {
    if (unit === 'hour') return d.getHours();
    if (unit === 'day') return startOfDay(d).getTime();
    if (unit === 'week') return startOfWeek(d).getTime();
    return startOfMonth(d).getTime();
  };
  if (unit === 'hour') {
    for (let h = 0; h < 24; h += 1) buckets.push({ key: h, label: `${String(h).padStart(2, '0')}:00`, sales: 0, orders: 0 });
  } else {
    let cur = unit === 'day' ? startOfDay(start) : unit === 'week' ? startOfWeek(start) : startOfMonth(start);
    while (cur <= end) {
      const label = unit === 'month'
        ? cur.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
        : cur.toLocaleDateString('en-IN', DAY_FMT);
      buckets.push({ key: cur.getTime(), label, sales: 0, orders: 0 });
      if (unit === 'day') cur = addDays(cur, 1);
      else if (unit === 'week') cur = addDays(cur, 7);
      else { cur = new Date(cur); cur.setMonth(cur.getMonth() + 1); }
    }
  }
  const idx = new Map(buckets.map((b, i) => [b.key, i]));
  for (const o of orders) {
    if (o.status !== 'completed') continue;
    const d = toDate(o.billedAt || o.closedAt);
    if (!d) continue;
    const i = idx.get(keyOf(d));
    if (i == null) continue;
    buckets[i].sales = round2(buckets[i].sales + (o.grandTotal || 0));
    buckets[i].orders += 1;
  }
  return buckets;
}
