import { useEffect, useState } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { FiSave, FiPrinter, FiPlus } from 'react-icons/fi';
import { db } from '../firebase.js';
import { useData } from '../context/DataContext.jsx';
import { useConnection } from '../context/ConnectionContext.jsx';
import { PAYMENT_METHODS, computeTotals, billConfigFromSettings } from '../lib/calc.js';
import { errorMessage } from '../lib/format.js';
import { resizeImage } from '../lib/image.js';
import { printReceipt } from '../lib/print.js';
import { downloadReceiptPdf } from '../lib/receiptPdf.js';
import Receipt from '../components/Receipt.jsx';

function sampleOrder(settings) {
  const items = [
    { lineId: '1', name: 'Sample item with a long name to test wrapping', price: 120, qty: 2, note: 'less sugar' },
    { lineId: '2', name: 'Sample item', price: 50, qty: 1, note: '' },
    { lineId: '3', name: 'Cheese Extra', price: 10, qty: 1, isAddon: true, note: '' },
  ];
  const totals = computeTotals(items, { type: 'flat', value: 10 }, 'parcel', billConfigFromSettings(settings));
  return {
    id: 'test', billNo: `${settings.invoicePrefix}TEST`, orderNo: 0, type: 'parcel', tableName: null,
    customer: { name: 'Test customer', phone: '' }, items, discount: { type: 'flat', value: 10 }, totals, grandTotal: totals.grandTotal,
    payments: [{ id: 'p', method: 'cash', amount: totals.grandTotal, tendered: 500, change: 500 - totals.grandTotal }],
    amountPaid: totals.grandTotal, amountRefunded: 0, paymentStatus: 'paid', status: 'completed', createdAt: new Date(), billedAt: new Date(), billedByName: 'Test',
  };
}

export default function Settings() {
  const { settings } = useData();
  const { online } = useConnection();
  const [f, setF] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [newCat, setNewCat] = useState('');

  useEffect(() => { setF(settings); }, [settings]);
  useEffect(() => { if (window.location.hash) document.querySelector(window.location.hash)?.scrollIntoView(); }, []);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setP = (k) => (e) => setF({ ...f, printer: { ...f.printer, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } });

  const save = async () => {
    setMsg(null);
    const gst = Number(f.gstPercent);
    if (f.gstEnabled && !(gst > 0 && gst <= 100)) { setMsg({ err: true, text: 'Enter a GST percentage greater than 0, or turn GST off.' }); return; }
    if (!(Number(f.parcelCharge) >= 0)) { setMsg({ err: true, text: 'Parcel charge must be 0 or more.' }); return; }
    const pw = Number(f.printer.paperWidthMm);
    const cw = Number(f.printer.contentWidthMm);
    if (!(pw >= 48 && pw <= 112) || !(cw >= 40 && cw <= pw)) { setMsg({ err: true, text: 'Check printer paper and content widths.' }); return; }
    if (!Object.values(f.paymentMethods).some(Boolean)) { setMsg({ err: true, text: 'Enable at least one payment method.' }); return; }
    setBusy(true);
    try {
      await setDoc(doc(db, 'settings', 'app'), {
        ...f,
        gstPercent: gst || 0,
        parcelCharge: Number(f.parcelCharge) || 0,
        cashierHistoryDays: Math.max(0, Number(f.cashierHistoryDays) || 0),
        printer: { ...f.printer, paperWidthMm: pw, contentWidthMm: cw, fontSizePx: Number(f.printer.fontSizePx) || 12 },
        updatedAt: serverTimestamp(),
      });
      setMsg({ text: 'Settings saved. GST and parcel changes apply to new orders.' });
    } catch (e) { setMsg({ err: true, text: errorMessage(e) }); } finally { setBusy(false); }
  };

  const onLogo = async (e) => {
    try { setF({ ...f, logoDataUrl: await resizeImage(e.target.files[0], 240, 'image/png') }); } catch (x) { setMsg({ err: true, text: x.message }); }
  };

  const dirty = JSON.stringify({ ...f, updatedAt: null }) !== JSON.stringify({ ...settings, updatedAt: null });

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <h1>Settings</h1>
        <button type="button" className="btn gold" onClick={save} disabled={busy || !online || !dirty}>{busy ? <span className="spinner sm" /> : <FiSave />}Save settings</button>
      </div>
      {msg ? <div className={`alert ${msg.err ? 'error' : 'ok'}`}>{msg.text}</div> : null}

      <section className="card">
        <h2 style={{ marginBottom: 12 }}>Restaurant</h2>
        <div className="grid-2">
          <div className="field"><label>Restaurant name</label><input value={f.restaurantName} onChange={set('restaurantName')} /></div>
          <div className="field"><label>Tagline</label><input value={f.tagline} onChange={set('tagline')} /></div>
          <div className="field"><label>Phone</label><input value={f.phone} onChange={set('phone')} /></div>
          <div className="field"><label>GSTIN (leave blank if not registered)</label><input value={f.gstin} onChange={set('gstin')} /></div>
          <div className="field"><label>FSSAI licence no. (optional)</label><input value={f.fssai} onChange={set('fssai')} /></div>
          <div className="field"><label>Currency symbol</label><input value={f.currencySymbol} onChange={set('currencySymbol')} maxLength={3} /></div>
        </div>
        <div className="field"><label>Address</label><textarea value={f.address} onChange={set('address')} /></div>
        <div className="field">
          <label>Logo (printed on receipts if enabled)</label>
          <div className="row">
            {f.logoDataUrl ? <img src={f.logoDataUrl} alt="" style={{ height: 56, background: '#fff', borderRadius: 6, padding: 4 }} /> : null}
            <input type="file" accept="image/*" onChange={onLogo} />
            {f.logoDataUrl ? <button type="button" className="btn sm" onClick={() => setF({ ...f, logoDataUrl: '' })}>Remove</button> : null}
          </div>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 12 }}>Billing &amp; tax</h2>
        <div className="grid-3">
          <label className="check"><input type="checkbox" checked={f.gstEnabled} onChange={set('gstEnabled')} />Charge GST</label>
          <div className="field"><label>GST % (split equally into CGST + SGST)</label><input type="number" inputMode="decimal" min="0" max="100" step="0.01" value={f.gstPercent} onChange={set('gstPercent')} disabled={!f.gstEnabled} /></div>
          <div className="field"><label>Invoice prefix</label><input value={f.invoicePrefix} onChange={set('invoicePrefix')} maxLength={10} /></div>
          <div className="field"><label>Parcel charge (₹)</label><input type="number" inputMode="decimal" min="0" value={f.parcelCharge} onChange={set('parcelCharge')} /></div>
          <div className="field"><label>Parcel charge applies</label>
            <select value={f.parcelMode} onChange={set('parcelMode')}>
              <option value="per_item">Per item quantity (add-ons excluded)</option>
              <option value="per_order">Once per order</option>
            </select>
          </div>
          <label className="check"><input type="checkbox" checked={f.roundOff} onChange={set('roundOff')} />Round grand total to nearest ₹1</label>
        </div>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Parcel charges apply only to Parcel orders, never to Dine-in or Takeaway. GST is calculated on (subtotal − discount + parcel charges).</p>
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 12 }}>Payment methods</h2>
        <div className="row wrap">
          {Object.entries(PAYMENT_METHODS).map(([k, v]) => (
            <label key={k} className="check" style={{ marginRight: 16 }}>
              <input type="checkbox" checked={f.paymentMethods[k] !== false} onChange={(e) => setF({ ...f, paymentMethods: { ...f.paymentMethods, [k]: e.target.checked } })} />{v}
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 12 }}>Receipt &amp; 80mm printer</h2>
        <div className="grid-2">
          <div>
            <div className="grid-2">
              <div className="field"><label>Paper width (mm)</label>
                <select value={f.printer.paperWidthMm} onChange={(e) => {
                  const pw = Number(e.target.value);
                  setF({ ...f, printer: { ...f.printer, paperWidthMm: pw, contentWidthMm: pw === 58 ? 48 : 72 } });
                }}>
                  <option value={80}>80 mm</option>
                  <option value={58}>58 mm</option>
                </select>
              </div>
              <div className="field"><label>Printable width (mm)</label><input type="number" value={f.printer.contentWidthMm} onChange={setP('contentWidthMm')} /></div>
              <div className="field"><label>Font size (px)</label><input type="number" min="9" max="18" value={f.printer.fontSizePx} onChange={setP('fontSizePx')} /></div>
            </div>
            <label className="check"><input type="checkbox" checked={f.printer.showLogo} onChange={setP('showLogo')} />Print logo</label>
            <label className="check"><input type="checkbox" checked={f.printer.autoPrintAfterPayment} onChange={setP('autoPrintAfterPayment')} />Open print dialog automatically after payment</label>
            <div className="field"><label>Footer line 1</label><input value={f.receiptFooter} onChange={set('receiptFooter')} /></div>
            <div className="field"><label>Footer line 2</label><input value={f.receiptFooter2} onChange={set('receiptFooter2')} /></div>
            <div className="field"><label>Slogan (last line of the bill)</label><input value={f.receiptSlogan} onChange={set('receiptSlogan')} /></div>
            <div className="row wrap">
              <button type="button" className="btn" onClick={() => printReceipt(sampleOrder(f), f)}><FiPrinter />Print test receipt</button>
              <button type="button" className="btn" onClick={() => downloadReceiptPdf(sampleOrder(f), f)}>Test PDF</button>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>Most 80mm printers print 72mm wide (576 dots). Use 64–70mm if the right edge is cut off. In the print dialog set margins to “None” and scale to 100%.</p>
          </div>
          <div style={{ background: '#2a2a2a', padding: 10, borderRadius: 8, overflowX: 'auto' }}>
            <div className="receipt-preview" style={{ width: 'fit-content', padding: 0 }}><Receipt order={sampleOrder(f)} settings={f} /></div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 12 }}>Cashier permissions</h2>
        <label className="check"><input type="checkbox" checked={f.cashierCanDiscount} onChange={set('cashierCanDiscount')} />Cashiers can apply discounts</label>
        <label className="check"><input type="checkbox" checked={f.cashierCanCancel} onChange={set('cashierCanCancel')} />Cashiers can cancel unpaid active orders</label>
        <div className="field" style={{ maxWidth: 320 }}><label>Order history visible to cashiers (days back, 0 = today only)</label><input type="number" min="0" value={f.cashierHistoryDays} onChange={set('cashierHistoryDays')} /></div>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Discount and cancel permissions are enforced by the database rules. Refunds, menu, reports, expenses, staff and settings are always admin-only.</p>
      </section>

      <section className="card" id="expenses">
        <h2 style={{ marginBottom: 12 }}>Expense categories</h2>
        <div className="row wrap" style={{ marginBottom: 10 }}>
          {f.expenseCategories.map((c) => (
            <span key={c} className="badge" style={{ fontSize: 13, padding: '6px 10px' }}>
              {c}
              <button type="button" className="btn ghost sm" style={{ minHeight: 24, padding: '0 4px' }} onClick={() => setF({ ...f, expenseCategories: f.expenseCategories.filter((x) => x !== c) })} aria-label={`Remove ${c}`}>×</button>
            </span>
          ))}
        </div>
        <div className="row" style={{ maxWidth: 420 }}>
          <input className="grow" placeholder="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
          <button type="button" className="btn" onClick={() => { const c = newCat.trim(); if (c && !f.expenseCategories.includes(c)) setF({ ...f, expenseCategories: [...f.expenseCategories, c] }); setNewCat(''); }}><FiPlus />Add</button>
        </div>
      </section>

    </div>
  );
}
