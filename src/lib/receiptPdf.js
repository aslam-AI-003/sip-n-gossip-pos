import { ORDER_TYPES, PAYMENT_METHODS, PAYMENT_STATUS_LABEL, lineTotal } from './calc.js';
import { fmtDateTime } from './format.js';

// jsPDF's built-in fonts do not contain the rupee glyph, so PDFs use "Rs.".
const money = (v) => `Rs.${(Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Build an 80mm-wide PDF receipt whose height fits the content. */
export async function buildReceiptPdf(order, settings) {
  const { jsPDF } = await import('jspdf');
  const paper = Number(settings.printer?.paperWidthMm) || 80;
  const content = Math.min(Number(settings.printer?.contentWidthMm) || 72, paper);
  const left = (paper - content) / 2;
  const right = left + content;

  // Two passes: first measure, then draw on a page of the right height.
  const draw = (pdf, real) => {
    let y = 5;
    const lh = (pt) => pt * 0.42;
    const text = (s, x, opts = {}) => { if (real) pdf.text(String(s), x, y, opts); };
    const font = (style, size) => { pdf.setFont('helvetica', style); pdf.setFontSize(size); };
    const center = (s, style = 'normal', size = 9) => {
      font(style, size);
      pdf.splitTextToSize(String(s), content).forEach((ln) => { text(ln, paper / 2, { align: 'center' }); y += lh(size) + 0.6; });
    };
    const kv = (k, v, style = 'normal', size = 8.5) => {
      font(style, size);
      text(k, left);
      text(v, right, { align: 'right' });
      y += lh(size) + 0.9;
    };
    const rule = () => {
      y += 0.5;
      if (real) { pdf.setLineDashPattern([0.8, 0.6], 0); pdf.setLineWidth(0.2); pdf.line(left, y, right, y); }
      y += 2.8;
    };

    if (settings.printer?.showLogo && settings.logoDataUrl) {
      try {
        if (real) pdf.addImage(settings.logoDataUrl, paper / 2 - 10, y - 2, 20, 14, undefined, 'FAST');
        y += 15;
      } catch { /* ignore bad logo */ }
    }
    center(settings.restaurantName, 'bold', 14);
    if (settings.tagline) center(settings.tagline, 'italic', 9);
    if (settings.address) center(settings.address, 'normal', 8);
    if (settings.phone) center(`Ph: ${settings.phone}`, 'normal', 8);
    if (settings.gstin) center(`GSTIN: ${settings.gstin}`, 'normal', 8);
    if (settings.fssai) center(`FSSAI: ${settings.fssai}`, 'normal', 8);
    if (order.status === 'cancelled') center('*** CANCELLED ***', 'bold', 10);
    else if (!order.billNo) center('PROVISIONAL - NOT A BILL', 'bold', 9);
    rule();

    if (order.billNo) kv('Bill No', order.billNo, 'bold');
    kv('Order No', `#${order.orderNo}`);
    kv('Date', fmtDateTime(order.billedAt || order.createdAt));
    kv('Type', ORDER_TYPES[order.type] || order.type);
    if (order.tableName) kv('Table', order.tableName);
    if (order.customer?.name) kv('Customer', order.customer.name);
    if (order.customer?.phone) kv('Phone', order.customer.phone);
    if (order.billedByName || order.createdByName) kv('Cashier', order.billedByName || order.createdByName);
    rule();

    const qtyX = right - 22;
    const nameW = content - 30;
    font('bold', 8.5);
    text('ITEM', left); text('QTY', qtyX, { align: 'center' }); text('PRICE', right, { align: 'right' });
    y += lh(8.5) + 0.5;
    rule();
    for (const l of order.items || []) {
      font('bold', 8.5);
      const lines = pdf.splitTextToSize(l.name, nameW);
      lines.forEach((ln, i) => {
        text(ln, left);
        if (i === 0) {
          font('normal', 8.5);
          text(String(l.qty), qtyX, { align: 'center' });
          text(money(lineTotal(l)), right, { align: 'right' });
          font('bold', 8.5);
        }
        y += lh(8.5) + 0.6;
      });
      font('normal', 7.5);
      if (l.qty > 1) { text(`  ${l.qty} x ${money(l.price)}`, left); y += lh(7.5) + 0.6; }
      if (l.note) {
        pdf.splitTextToSize(`  * ${l.note}`, content).forEach((ln) => { text(ln, left); y += lh(7.5) + 0.6; });
      }
      y += 0.6;
    }
    rule();

    const t = order.totals || {};
    kv('Subtotal', money(t.subtotal));
    if (t.discount > 0) kv(`Discount${order.discount?.type === 'percent' ? ` (${order.discount.value}%)` : ''}`, `-${money(t.discount)}`);
    if (t.parcelCharge > 0) kv('Parcel charges', money(t.parcelCharge));
    if (t.gst > 0) {
      kv(`CGST @ ${t.gstPercent / 2}%`, money(t.cgst));
      kv(`SGST @ ${t.gstPercent / 2}%`, money(t.sgst));
    }
    if (t.roundOff) kv('Round off', money(t.roundOff));
    rule();
    kv('GRAND TOTAL', money(t.grandTotal), 'bold', 12);
    rule();

    if ((order.payments || []).length === 0) kv('Payment', 'Not paid');
    for (const p of order.payments || []) {
      kv(`Paid - ${PAYMENT_METHODS[p.method] || p.method}`, money(p.amount));
      font('normal', 7.5);
      if (p.ref) { text(`  Ref: ${p.ref}`, left); y += lh(7.5) + 0.6; }
      if (p.tendered) { text(`  Cash received ${money(p.tendered)} / Change ${money(p.change || 0)}`, left); y += lh(7.5) + 0.6; }
    }
    if (order.amountRefunded > 0) kv('Refunded', `-${money(order.amountRefunded)}`);
    if (order.billNo && order.grandTotal - order.amountPaid > 0.004) kv('Balance due', money(order.grandTotal - order.amountPaid), 'bold');
    kv('Payment status', PAYMENT_STATUS_LABEL[order.paymentStatus] || order.paymentStatus, 'bold');
    rule();
    if (settings.receiptFooter) center(settings.receiptFooter, 'bold', 9);
    if (settings.receiptFooter2) center(settings.receiptFooter2, 'bold', 9);
    return y + 4;
  };

  const probe = new jsPDF({ unit: 'mm', format: [paper, 1000] });
  const height = draw(probe, false);
  const pdf = new jsPDF({ unit: 'mm', format: [paper, Math.max(height, 60)] });
  draw(pdf, true);
  return pdf;
}

export function receiptFileName(order) {
  return `${order.billNo || `order-${order.orderNo}`}.pdf`.replace(/[^\w.-]+/g, '_');
}

export async function downloadReceiptPdf(order, settings) {
  const pdf = await buildReceiptPdf(order, settings);
  pdf.save(receiptFileName(order));
}

/** Android: share the PDF to a printer app / WhatsApp via the system share sheet. */
export async function shareReceiptPdf(order, settings) {
  const pdf = await buildReceiptPdf(order, settings);
  const file = new File([pdf.output('blob')], receiptFileName(order), { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: order.billNo || `Order #${order.orderNo}` });
    return true;
  }
  pdf.save(receiptFileName(order));
  return false;
}

export const canShareFiles = () => typeof navigator !== 'undefined' && !!navigator.canShare;
