import { ORDER_TYPES, PAYMENT_METHODS, PAYMENT_STATUS_LABEL, lineTotal } from '../lib/calc.js';
import { inr, fmtDateTime } from '../lib/format.js';
import './Receipt.css';

/**
 * 80mm thermal receipt. Sizes are in mm/px so the same markup is used for
 * the on-screen preview and the printed output.
 */
export default function Receipt({ order, settings, reprint = false }) {
  const p = settings.printer || {};
  const paper = Number(p.paperWidthMm) || 80;
  const content = Math.min(Number(p.contentWidthMm) || 72, paper);
  const sym = settings.currencySymbol || '₹';
  const m = (v) => inr(v, { symbol: sym });
  const t = order.totals || {};
  const isBill = !!order.billNo;
  const when = order.billedAt || order.createdAt;

  return (
    <div
      className="receipt"
      style={{ width: `${paper}mm`, padding: `2mm ${(paper - content) / 2}mm 4mm`, fontSize: `${Number(p.fontSizePx) || 12}px` }}
    >
      {p.showLogo && settings.logoDataUrl ? <img className="r-logo" src={settings.logoDataUrl} alt="" /> : null}
      <div className="r-name">{settings.restaurantName}</div>
      {settings.receiptSlogan ? <div className="r-slogan">{settings.receiptSlogan}</div> : null}
      {settings.tagline ? <div className="r-tag">{settings.tagline}</div> : null}
      {settings.address ? <div className="r-center r-small">{settings.address}</div> : null}
      {settings.phone ? <div className="r-center r-small">Ph: {settings.phone}</div> : null}
      {settings.gstin ? <div className="r-center r-small">GSTIN: {settings.gstin}</div> : null}
      {settings.fssai ? <div className="r-center r-small">FSSAI: {settings.fssai}</div> : null}

      {order.status === 'cancelled' ? <div className="r-flag">*** CANCELLED ***</div> : null}
      {!isBill && order.status !== 'cancelled' ? <div className="r-flag">PROVISIONAL - NOT A BILL</div> : null}
      {reprint ? <div className="r-center r-small">(Reprint)</div> : null}

      <div className="r-rule" />
      {isBill ? <KV k="Bill No" v={order.billNo} bold /> : null}
      <KV k="Order No" v={`#${order.orderNo}`} />
      <KV k="Date" v={fmtDateTime(when)} />
      <KV k="Type" v={ORDER_TYPES[order.type] || order.type} />
      {order.tableName ? <KV k="Table" v={order.tableName} /> : null}
      {order.customer?.name ? <KV k="Customer" v={order.customer.name} /> : null}
      {order.customer?.phone ? <KV k="Phone" v={order.customer.phone} /> : null}
      {order.billedByName || order.createdByName ? <KV k="Cashier" v={order.billedByName || order.createdByName} /> : null}

      <div className="r-rule" />
      <div className="r-items r-head">
        <span>ITEM</span><span className="q">QTY</span><span className="a">PRICE</span>
      </div>
      <div className="r-rule" />
      {(order.items || []).map((l) => (
        <div key={l.lineId} className="r-line">
          <div className="r-items">
            <span className="n">{l.name}</span>
            <span className="q">{l.qty}</span>
            <span className="a">{m(lineTotal(l))}</span>
          </div>
          {l.qty > 1 ? <div className="r-sub">{l.qty} x {m(l.price)}</div> : null}
          {l.note ? <div className="r-sub">* {l.note}</div> : null}
        </div>
      ))}
      <div className="r-rule" />

      <KV k="Subtotal" v={m(t.subtotal)} />
      {t.discount > 0 ? (
        <KV k={`Discount${order.discount?.type === 'percent' ? ` (${order.discount.value}%)` : ''}`} v={`-${m(t.discount)}`} />
      ) : null}
      {t.parcelCharge > 0 ? <KV k="Parcel charges" v={m(t.parcelCharge)} /> : null}
      {t.gst > 0 ? (
        <>
          <KV k={`CGST @ ${t.gstPercent / 2}%`} v={m(t.cgst)} />
          <KV k={`SGST @ ${t.gstPercent / 2}%`} v={m(t.sgst)} />
        </>
      ) : null}
      {t.roundOff ? <KV k="Round off" v={m(t.roundOff)} /> : null}
      <div className="r-rule" />
      <div className="r-total"><span>GRAND TOTAL</span><span>{m(t.grandTotal)}</span></div>
      <div className="r-rule" />

      {(order.payments || []).length > 0 ? (
        <>
          {(order.payments || []).map((p2) => (
            <div key={p2.id}>
              <KV k={`Paid - ${PAYMENT_METHODS[p2.method] || p2.method}`} v={m(p2.amount)} />
              {p2.ref ? <div className="r-sub">Ref: {p2.ref}</div> : null}
              {p2.tendered ? <div className="r-sub">Cash received {m(p2.tendered)} / Change {m(p2.change || 0)}</div> : null}
            </div>
          ))}
        </>
      ) : (
        <KV k="Payment" v="Not paid" />
      )}
      {order.amountRefunded > 0 ? <KV k="Refunded" v={`-${m(order.amountRefunded)}`} /> : null}
      {isBill && order.grandTotal - order.amountPaid > 0.004 ? <KV k="Balance due" v={m(order.grandTotal - order.amountPaid)} bold /> : null}
      <KV k="Payment status" v={PAYMENT_STATUS_LABEL[order.paymentStatus] || order.paymentStatus} bold />

      <div className="r-rule" />
      {settings.receiptFooter ? <div className="r-foot">{settings.receiptFooter}</div> : null}
      {settings.receiptFooter2 ? <div className="r-foot">{settings.receiptFooter2}</div> : null}
    </div>
  );
}

function KV({ k, v, bold }) {
  return (
    <div className={`r-kv${bold ? ' b' : ''}`}>
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}
