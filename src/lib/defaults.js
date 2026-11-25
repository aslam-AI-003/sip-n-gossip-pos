export const DEFAULT_EXPENSE_CATEGORIES = [
  'Raw materials',
  'Vegetables & fruits',
  'Milk & dairy',
  'Packaging',
  'Electricity',
  'Rent',
  'Staff salaries',
  'Maintenance',
  'Other',
];

// Values the owner must confirm in Settings are left blank / zero on purpose.
// GST is OFF until the owner enters a rate.
export const DEFAULT_SETTINGS = {
  restaurantName: "SIP N' GOSSIP CAFE",
  tagline: 'Fresh Sips, Happy Vibes!',
  address: '',
  phone: '',
  gstin: '',
  fssai: '',
  gstEnabled: false,
  gstPercent: 0,
  invoicePrefix: 'SNG-',
  receiptFooter: 'Thank you for visiting!',
  receiptFooter2: 'Visit Again!',
  logoDataUrl: '',
  currencySymbol: '₹',
  parcelMode: 'per_item',
  parcelCharge: 5, // "Parcel Extra - ₹5" from the menu; editable in Settings
  roundOff: true,
  paymentMethods: { cash: true, upi: true, card: true, online: true },
  printer: {
    paperWidthMm: 80,
    contentWidthMm: 72,
    fontSizePx: 12,
    showLogo: true,
    autoPrintAfterPayment: false,
  },
  cashierCanDiscount: false,
  cashierCanCancel: true,
  cashierHistoryDays: 1,
  expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
};

export function withDefaults(s = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    paymentMethods: { ...DEFAULT_SETTINGS.paymentMethods, ...(s.paymentMethods || {}) },
    printer: { ...DEFAULT_SETTINGS.printer, ...(s.printer || {}) },
    expenseCategories: s.expenseCategories?.length ? s.expenseCategories : DEFAULT_EXPENSE_CATEGORIES,
  };
}
