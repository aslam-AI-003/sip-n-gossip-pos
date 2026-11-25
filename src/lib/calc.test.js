import { describe, it, expect } from 'vitest';
import { computeTotals, paymentSummary, validatePayments, cashChange, sumAmounts } from './calc.js';

const items = [
  { price: 100, qty: 2 },
  { price: 50, qty: 1 },
  { price: 10, qty: 1, isAddon: true },
];

describe('computeTotals', () => {
  it('sums lines without tax or discount', () => {
    const t = computeTotals(items, null, 'dine_in', { gstEnabled: false, roundOff: false });
    expect(t.subtotal).toBe(260);
    expect(t.itemCount).toBe(4);
    expect(t.grandTotal).toBe(260);
    expect(t.parcelCharge).toBe(0);
  });

  it('never adds parcel charge to dine-in or takeaway', () => {
    const cfg = { parcelCharge: 5, parcelMode: 'per_item' };
    expect(computeTotals(items, null, 'dine_in', cfg).parcelCharge).toBe(0);
    expect(computeTotals(items, null, 'takeaway', cfg).parcelCharge).toBe(0);
  });

  it('applies per-item parcel charge to non add-on units only', () => {
    const t = computeTotals(items, null, 'parcel', { parcelCharge: 5, parcelMode: 'per_item' });
    expect(t.parcelCharge).toBe(15); // 3 food units x 5
    expect(t.grandTotal).toBe(275);
  });

  it('applies per-order parcel charge once', () => {
    const t = computeTotals(items, null, 'parcel', { parcelCharge: 20, parcelMode: 'per_order' });
    expect(t.parcelCharge).toBe(20);
  });

  it('applies percent and flat discounts, clamped to subtotal', () => {
    expect(computeTotals(items, { type: 'percent', value: 10 }).discount).toBe(26);
    expect(computeTotals(items, { type: 'flat', value: 30 }).discount).toBe(30);
    expect(computeTotals(items, { type: 'flat', value: 9999 }).discount).toBe(260);
    expect(computeTotals(items, { type: 'percent', value: 150 }).discount).toBe(260);
  });

  it('computes GST on (subtotal - discount + parcel) and splits CGST/SGST', () => {
    const t = computeTotals(items, { type: 'flat', value: 10 }, 'parcel', {
      gstEnabled: true, gstPercent: 5, parcelCharge: 5, parcelMode: 'per_item', roundOff: false,
    });
    // taxable = 260 - 10 + 15 = 265; gst = 13.25
    expect(t.taxable).toBe(265);
    expect(t.gst).toBe(13.25);
    expect(t.cgst + t.sgst).toBe(13.25);
    expect(t.grandTotal).toBe(278.25);
  });

  it('rounds grand total to nearest rupee when enabled', () => {
    const t = computeTotals(items, { type: 'flat', value: 10 }, 'parcel', {
      gstEnabled: true, gstPercent: 5, parcelCharge: 5, parcelMode: 'per_item', roundOff: true,
    });
    expect(t.grandTotal).toBe(278);
    expect(t.roundOff).toBe(-0.25);
  });

  it('avoids floating point drift', () => {
    const t = computeTotals([{ price: 0.1, qty: 3 }], null, 'dine_in', { roundOff: false });
    expect(t.subtotal).toBe(0.3);
  });

  it('ignores invalid quantities', () => {
    const t = computeTotals([{ price: 100, qty: -2 }, { price: 50, qty: 'x' }]);
    expect(t.subtotal).toBe(0);
  });
});

describe('payments', () => {
  it('split payment example: 500 = 200 cash + 300 UPI', () => {
    const pays = [{ method: 'cash', amount: 200 }, { method: 'upi', amount: 300 }];
    expect(validatePayments(500, [], pays)).toBeNull();
    expect(paymentSummary(500, pays)).toMatchObject({ paid: 500, balance: 0, status: 'paid' });
  });

  it('detects partial and pending', () => {
    expect(paymentSummary(500, [{ amount: 200 }]).status).toBe('partial');
    expect(paymentSummary(500, []).status).toBe('pending');
  });

  it('detects full refund', () => {
    expect(paymentSummary(500, [{ amount: 500 }], [{ amount: 500 }]).status).toBe('refunded');
    expect(paymentSummary(500, [{ amount: 500 }], [{ amount: 100 }]).status).toBe('paid');
  });

  it('rejects overpayment and invalid entries', () => {
    expect(validatePayments(500, [{ amount: 400 }], [{ method: 'cash', amount: 200 }])).toMatch(/exceed/);
    expect(validatePayments(500, [], [{ method: 'cash', amount: 0 }])).toMatch(/greater than zero/);
    expect(validatePayments(500, [], [{ method: 'bitcoin', amount: 10 }])).toMatch(/method/);
  });

  it('calculates cash change', () => {
    expect(cashChange(500, 278)).toBe(222);
    expect(cashChange(100, 278)).toBe(0);
  });

  it('sums amounts in paise', () => {
    expect(sumAmounts([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3);
  });
});
