import { describe, it, expect } from 'vitest';
import { summarize, series } from './stats.js';

const d = (h) => new Date(2025, 0, 15, h, 0, 0);
const orders = [
  {
    status: 'completed', type: 'dine_in', grandTotal: 500, amountPaid: 500, billedAt: d(10),
    totals: { subtotal: 520, discount: 20, parcelCharge: 0, gst: 0, roundOff: 0 },
    items: [{ productId: 'a', name: 'Cold Coffee', category: 'Milkshakes', price: 120, qty: 3 }, { productId: 'b', name: 'Fries', category: 'Snacks', price: 160, qty: 1 }],
  },
  {
    status: 'completed', type: 'parcel', grandTotal: 210, amountPaid: 100, billedAt: d(13),
    totals: { subtotal: 190, discount: 0, parcelCharge: 10, gst: 10, roundOff: 0 },
    items: [{ productId: 'a', name: 'Cold Coffee', category: 'Milkshakes', price: 95, qty: 2 }],
  },
  { status: 'cancelled', type: 'takeaway', grandTotal: 80, amountPaid: 0, items: [], totals: {} },
];
const payments = [
  { kind: 'payment', method: 'cash', amount: 200 },
  { kind: 'payment', method: 'upi', amount: 300 },
  { kind: 'payment', method: 'card', amount: 100 },
  { kind: 'refund', method: 'cash', amount: 50 },
];
const expenses = [{ amount: 100, category: 'Milk & dairy' }, { amount: 40, category: 'Packaging' }];

describe('summarize', () => {
  const s = summarize({ orders, payments, expenses });
  it('counts bills and cancellations separately', () => {
    expect(s.billCount).toBe(2);
    expect(s.cancelledCount).toBe(1);
  });
  it('separates revenue, discounts, tax', () => {
    expect(s.grossSales).toBe(710);
    expect(s.discounts).toBe(20);
    expect(s.gst).toBe(10);
    expect(s.parcelCharges).toBe(10);
    expect(s.revenue).toBe(710);
  });
  it('reports collections by method and refunds', () => {
    expect(s.collections).toEqual({ cash: 200, upi: 300, card: 100, online: 0 });
    expect(s.refunded).toBe(50);
    expect(s.netCollected).toBe(550);
  });
  it('reports pending dues', () => {
    expect(s.pendingDue).toBe(110);
  });
  it('estimates profit = revenue - GST - refunds - expenses', () => {
    expect(s.expenses).toBe(140);
    expect(s.estimatedProfit).toBe(710 - 10 - 50 - 140);
  });
  it('ranks best sellers by quantity', () => {
    expect(s.products[0]).toMatchObject({ name: 'Cold Coffee', qty: 5, amount: 550 });
    expect(s.categories[0]).toMatchObject({ name: 'Milkshakes', amount: 550 });
  });
  it('breaks down by order type', () => {
    expect(s.orderTypes.dine_in).toEqual({ count: 1, amount: 500 });
    expect(s.orderTypes.parcel).toEqual({ count: 1, amount: 210 });
  });
});

describe('series', () => {
  it('buckets by hour', () => {
    const h = series(orders, 'hour', d(0), d(23));
    expect(h).toHaveLength(24);
    expect(h[10]).toMatchObject({ sales: 500, orders: 1 });
    expect(h[13]).toMatchObject({ sales: 210, orders: 1 });
  });
  it('buckets by day', () => {
    const days = series(orders, 'day', new Date(2025, 0, 14), new Date(2025, 0, 16));
    expect(days.map((x) => x.sales)).toEqual([0, 710, 0]);
  });
  it('buckets by month', () => {
    const m = series(orders, 'month', new Date(2024, 10, 1), new Date(2025, 0, 31));
    expect(m.map((x) => x.sales)).toEqual([0, 0, 710]);
  });
});
