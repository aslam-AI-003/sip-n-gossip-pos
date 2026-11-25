// Pure billing calculations. All internal math is done in integer paise to
// avoid floating point drift; public results are returned in rupees rounded
// to 2 decimals.

const toPaise = (rupees) => Math.round((Number(rupees) || 0) * 100);
const toRupees = (paise) => Math.round(paise) / 100;

export const ORDER_TYPES = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  parcel: 'Parcel',
};

export const PAYMENT_METHODS = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  online: 'Online',
};

export const DEFAULT_BILL_CONFIG = {
  gstEnabled: false,
  gstPercent: 0,
  parcelMode: 'per_item', // 'per_item' | 'per_order'
  parcelCharge: 0,
  roundOff: true,
};

/** Pick the bill-relevant config out of the settings document. */
export function billConfigFromSettings(settings = {}) {
  return {
    gstEnabled: !!settings.gstEnabled,
    gstPercent: clampNumber(settings.gstPercent, 0, 100),
    parcelMode: settings.parcelMode === 'per_order' ? 'per_order' : 'per_item',
    parcelCharge: clampNumber(settings.parcelCharge, 0, 100000),
    roundOff: settings.roundOff !== false,
  };
}

function clampNumber(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function lineTotal(line) {
  return toRupees(toPaise(line.price) * lineQty(line));
}

function lineQty(line) {
  const q = Math.floor(Number(line.qty));
  return Number.isFinite(q) && q > 0 ? q : 0;
}

/**
 * Compute bill totals.
 * @param {Array<{price:number, qty:number, isAddon?:boolean}>} items
 * @param {{type:'percent'|'flat', value:number}|null} discount
 * @param {string} orderType dine_in | takeaway | parcel
 * @param {object} config result of billConfigFromSettings
 */
export function computeTotals(items = [], discount = null, orderType = 'dine_in', config = DEFAULT_BILL_CONFIG) {
  const cfg = { ...DEFAULT_BILL_CONFIG, ...config };
  let subtotalP = 0;
  let itemCount = 0;
  let parcelUnits = 0;
  for (const line of items) {
    const q = lineQty(line);
    subtotalP += toPaise(line.price) * q;
    itemCount += q;
    if (!line.isAddon) parcelUnits += q;
  }

  let discountP = 0;
  if (discount && Number(discount.value) > 0) {
    if (discount.type === 'percent') {
      const pct = clampNumber(discount.value, 0, 100);
      discountP = Math.round((subtotalP * pct) / 100);
    } else {
      discountP = toPaise(discount.value);
    }
  }
  discountP = Math.min(Math.max(discountP, 0), subtotalP);

  let parcelP = 0;
  if (orderType === 'parcel' && items.length > 0) {
    const chargeP = toPaise(cfg.parcelCharge);
    parcelP = cfg.parcelMode === 'per_order' ? chargeP : chargeP * parcelUnits;
  }

  const taxableP = subtotalP - discountP + parcelP;
  const gstP = cfg.gstEnabled ? Math.round((taxableP * clampNumber(cfg.gstPercent, 0, 100)) / 100) : 0;
  const cgstP = Math.floor(gstP / 2);
  const sgstP = gstP - cgstP;
  const rawP = taxableP + gstP;
  const roundedP = cfg.roundOff ? Math.round(rawP / 100) * 100 : rawP;
  const roundOffP = roundedP - rawP;

  return {
    itemCount,
    subtotal: toRupees(subtotalP),
    discount: toRupees(discountP),
    parcelCharge: toRupees(parcelP),
    taxable: toRupees(taxableP),
    gstPercent: cfg.gstEnabled ? clampNumber(cfg.gstPercent, 0, 100) : 0,
    gst: toRupees(gstP),
    cgst: toRupees(cgstP),
    sgst: toRupees(sgstP),
    roundOff: toRupees(roundOffP),
    grandTotal: toRupees(roundedP),
  };
}

/** Sum of an array of {amount} in rupees, computed in paise. */
export function sumAmounts(list = []) {
  return toRupees(list.reduce((s, p) => s + toPaise(p.amount), 0));
}

/** Payment status for an order. */
export function paymentSummary(grandTotal, payments = [], refunds = []) {
  const paid = sumAmounts(payments);
  const refunded = sumAmounts(refunds);
  const balance = toRupees(Math.max(toPaise(grandTotal) - toPaise(paid), 0));
  let status = 'pending';
  if (refunded > 0 && toPaise(refunded) >= toPaise(paid) && paid > 0) status = 'refunded';
  else if (toPaise(paid) >= toPaise(grandTotal) && (paid > 0 || toPaise(grandTotal) === 0)) status = 'paid';
  else if (paid > 0) status = 'partial';
  return { paid, refunded, balance, status };
}

export const PAYMENT_STATUS_LABEL = {
  paid: 'Paid',
  partial: 'Partially Paid',
  pending: 'Pending',
  refunded: 'Refunded',
};

/**
 * Validate new payment entries against the outstanding balance.
 * Returns an error string or null.
 */
export function validatePayments(grandTotal, existing = [], incoming = []) {
  for (const p of incoming) {
    if (!PAYMENT_METHODS[p.method]) return 'Invalid payment method.';
    const a = Number(p.amount);
    if (!Number.isFinite(a) || a <= 0) return 'Each payment amount must be greater than zero.';
    if (toPaise(a) !== Math.round(a * 100)) return 'Invalid amount.';
  }
  const already = toPaise(sumAmounts(existing));
  const adding = toPaise(sumAmounts(incoming));
  if (already + adding > toPaise(grandTotal)) {
    return 'Payments exceed the bill total. Enter only the amount applied to the bill (change is calculated separately).';
  }
  return null;
}

export function cashChange(tendered, due) {
  const t = toPaise(tendered);
  const d = toPaise(due);
  return t > d ? toRupees(t - d) : 0;
}

export const round2 = (n) => toRupees(toPaise(n));
