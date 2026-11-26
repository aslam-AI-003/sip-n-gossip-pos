import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { doc, getDocFromServer, onSnapshot } from 'firebase/firestore';
import {
  FiSearch, FiPlus, FiMinus, FiTrash2, FiEdit3, FiX, FiShoppingBag, FiSave, FiCreditCard, FiRefreshCw, FiFilePlus,
} from 'react-icons/fi';
import { db } from '../firebase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { useConnection } from '../context/ConnectionContext.jsx';
import { computeTotals, billConfigFromSettings, lineTotal, ORDER_TYPES } from '../lib/calc.js';
import { inr, price as fmtPrice, errorMessage } from '../lib/format.js';
import { newId, saveOrder } from '../lib/orders.js';
import { printReceipt } from '../lib/print.js';
import { markPrinted } from '../lib/orders.js';
import PaymentModal from '../components/PaymentModal.jsx';
import ReceiptModal from '../components/ReceiptModal.jsx';
import Modal from '../components/Modal.jsx';
import './POS.css';

// Parcel is not offered for new bills (old parcel bills still display correctly).
const BILLING_TYPES = ['dine_in', 'takeaway'];
const ALL = '__all__';
const ADDONS = '__addons__';
const lineKey = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function blankSession() {
  return { orderId: newId('orders'), version: null, orderNo: null, config: null };
}

export default function POS() {
  const { user, isAdmin } = useAuth();
  const { settings, categories, categoryById, products, ready } = useData();
  const { online, verify } = useConnection();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(blankSession);
  const [orderType, setOrderType] = useState('dine_in');
  const [table, setTable] = useState(null);
  const [customer, setCustomer] = useState({ name: '', phone: '' });
  const [lines, setLines] = useState([]);
  const [discount, setDiscount] = useState({ type: 'percent', value: '' });
  const [notes, setNotes] = useState('');
  const [dirty, setDirty] = useState(false);

  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState(ALL);
  const [cartOpen, setCartOpen] = useState(false);
  const [noteFor, setNoteFor] = useState(null);
  const [payOpen, setPayOpen] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState('');
  const [remoteChanged, setRemoteChanged] = useState(false);
  const searchRef = useRef(null);

  const canDiscount = isAdmin || settings.cashierCanDiscount;

  // ---------- menu ----------
  const addonCatIds = useMemo(() => new Set(categories.filter((c) => c.isAddon).map((c) => c.id)), [categories]);
  const sellable = useMemo(() => products.filter((p) => p.active !== false && categoryById[p.categoryId]?.active !== false), [products, categoryById]);
  const isAddonProduct = useCallback((p) => !!p.isAddon || addonCatIds.has(p.categoryId), [addonCatIds]);
  const addons = useMemo(() => sellable.filter(isAddonProduct), [sellable, isAddonProduct]);
  const visibleCats = useMemo(() => categories.filter((c) => c.active !== false && sellable.some((p) => p.categoryId === c.id)), [categories, sellable]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = sellable;
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
    else if (activeCat === ADDONS) list = addons;
    else if (activeCat !== ALL) list = list.filter((p) => p.categoryId === activeCat);
    return list;
  }, [sellable, addons, search, activeCat]);

  // Names used in more than one category (e.g. "Watermelon" juice and mojito)
  // get the category appended on the bill so receipts are unambiguous.
  const sharedNames = useMemo(() => {
    const seen = new Map();
    for (const p of sellable) {
      const k = p.name.trim().toLowerCase();
      if (!seen.has(k)) seen.set(k, new Set());
      seen.get(k).add(p.categoryId);
    }
    return new Set([...seen].filter(([, cats]) => cats.size > 1).map(([k]) => k));
  }, [sellable]);
  const billName = (p) => (sharedNames.has(p.name.trim().toLowerCase()) && categoryById[p.categoryId]
    ? `${p.name} (${categoryById[p.categoryId].name})` : p.name);

  // ---------- totals ----------
  const config = session.config || billConfigFromSettings(settings);
  const disc = canDiscount || session.version ? { type: discount.type, value: Number(discount.value) || 0 } : null;
  const totals = useMemo(() => computeTotals(lines, disc, orderType, config), [lines, disc?.type, disc?.value, orderType, config]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- cart ops ----------
  const touch = () => setDirty(true);
  const addProduct = (p) => {
    if (!p.available) return;
    setLines((ls) => {
      const i = ls.findIndex((l) => l.productId === p.id && !l.note && !l.saved);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, {
        lineId: lineKey(), productId: p.id, name: billName(p), price: Number(p.price), qty: 1, note: '',
        category: categoryById[p.categoryId]?.name || '', isAddon: isAddonProduct(p),
      }];
    });
    touch();
  };
  const changeQty = (lineId, d) => {
    setLines((ls) => ls.flatMap((l) => {
      if (l.lineId !== lineId) return [l];
      const q = l.qty + d;
      return q > 0 ? [{ ...l, qty: q }] : [];
    }));
    touch();
  };
  const setQty = (lineId, q) => {
    const n = Math.max(1, Math.min(999, Math.floor(Number(q)) || 1));
    setLines((ls) => ls.map((l) => (l.lineId === lineId ? { ...l, qty: n } : l)));
    touch();
  };
  const removeLine = (lineId) => { setLines((ls) => ls.filter((l) => l.lineId !== lineId)); touch(); };
  const setNote = (lineId, note) => { setLines((ls) => ls.map((l) => (l.lineId === lineId ? { ...l, note } : l))); touch(); };

  const resetAll = useCallback((keepType = true) => {
    setSession(blankSession());
    setLines([]);
    setTable(null);
    setCustomer({ name: '', phone: '' });
    setDiscount({ type: 'percent', value: '' });
    setNotes('');
    setDirty(false);
    setError(null);
    setRemoteChanged(false);
    if (!keepType) setOrderType('dine_in');
  }, []);

  const loadOrder = useCallback(async (orderId) => {
    setBusy(true);
    setError(null);
    try {
      const s = await getDocFromServer(doc(db, 'orders', orderId));
      if (!s.exists()) throw new Error('Order not found.');
      const o = s.data();
      if (o.status !== 'active') throw new Error(`Order #${o.orderNo} is ${o.status} and cannot be edited.`);
      setSession({ orderId: s.id, version: o.version, orderNo: o.orderNo, config: o.config, createdByName: o.createdByName });
      setOrderType(o.type);
      setTable(o.tableId ? { id: o.tableId, name: o.tableName } : null);
      setCustomer({ name: o.customer?.name || '', phone: o.customer?.phone || '' });
      setLines((o.items || []).map((l) => ({ ...l, saved: true })));
      setDiscount(o.discount ? { type: o.discount.type, value: String(o.discount.value) } : { type: 'percent', value: '' });
      setNotes(o.notes || '');
      setDirty(false);
      setRemoteChanged(false);
      return o;
    } catch (e) {
      setError({ msg: errorMessage(e) });
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  // Deep links: /pos?order=ID[&pay=1]  /pos?type=takeaway
  useEffect(() => {
    if (!ready) return;
    const orderId = params.get('order');
    const type = params.get('type');
    if (orderId) {
      loadOrder(orderId).then((o) => { if (o && params.get('pay') === '1') setPayOpen(true); });
      setParams({}, { replace: true });
    } else if (type && BILLING_TYPES.includes(type)) {
      resetAll(); setOrderType(type);
      setParams({}, { replace: true });
    }
  }, [ready, params]); // eslint-disable-line react-hooks/exhaustive-deps

  // Watch the order being edited for changes from other devices.
  useEffect(() => {
    if (!session.version) return undefined;
    return onSnapshot(doc(db, 'orders', session.orderId), (s) => {
      if (!s.exists()) return;
      const o = s.data();
      if (o.version !== session.version || o.status !== 'active') setRemoteChanged(true);
    }, () => {});
  }, [session.orderId, session.version]);

  // ---------- persistence ----------
  const buildInput = (extra = {}) => ({
    orderId: session.orderId,
    expectedVersion: session.version,
    type: orderType,
    table,
    customer,
    items: lines.map(({ saved, ...l }) => l), // eslint-disable-line no-unused-vars
    discount: disc && disc.value > 0 ? disc : null,
    notes,
    ...extra,
  });

  const precheck = async () => {
    if (lines.length === 0) { setError({ msg: 'Add at least one item.' }); return false; }
    const ok = await verify();
    if (!ok) { setError({ msg: 'No connection to the server. The order was not saved.' }); return false; }
    return true;
  };

  const handleSaveError = (e) => {
    setError({ msg: errorMessage(e), conflict: e.code === 'conflict' });
  };

  const saveActive = async () => {
    setError(null);
    if (!(await precheck())) return;
    setBusy(true);
    try {
      const { order, duplicate } = await saveOrder(buildInput({ finalize: false }), settings, user);
      const label = order.tableName ? ` for ${order.tableName}` : '';
      setToast(duplicate ? `Order #${order.orderNo} was already saved.` : `Order #${order.orderNo} saved${label}.`);
      resetAll();
      setCartOpen(false);
    } catch (e) {
      handleSaveError(e);
    } finally {
      setBusy(false);
    }
  };

  const openPay = async () => {
    setError(null);
    if (!(await precheck())) return;
    setPayOpen(true);
  };

  const confirmPayment = async (payments) => {
    const ok = await verify();
    if (!ok) throw new Error('No connection to the server. Payment was not recorded.');
    try {
      const { order } = await saveOrder(buildInput({ finalize: true, payments }), settings, user);
      setPayOpen(false);
      setCartOpen(false);
      resetAll();
      setReceipt(order);
      if (settings.printer?.autoPrintAfterPayment) {
        printReceipt(order, settings).then(() => markPrinted(order.id)).catch(() => {});
      }
    } catch (e) {
      if (e.code === 'conflict') { setPayOpen(false); handleSaveError(e); }
      throw Object.assign(new Error(errorMessage(e)), { userMessage: errorMessage(e) });
    }
  };

  const newOrder = () => {
    if (dirty && lines.length && !window.confirm('Discard the unsaved cart?')) return;
    resetAll();
  };

  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); }, [toast]);

  if (!ready) return <div className="center-screen"><span className="spinner" /></div>;

  const editing = !!session.version;
  const canSubmit = online && !busy && lines.length > 0;

  // ---------- render ----------
  const cart = (
    <aside className={`pos-cart${cartOpen ? ' open' : ''}`}>
      <div className="cart-head">
        <div className="grow">
          <div className="cart-title">
            {editing ? `Order #${session.orderNo}` : 'New order'}
            {editing ? <span className="badge gold" style={{ marginLeft: 8 }}>Active</span> : null}
          </div>
          <small>{ORDER_TYPES[orderType]}{table ? ` · ${table.name}` : ''}</small>
        </div>
        <button type="button" className="btn sm" onClick={newOrder} title="Start a new order"><FiFilePlus />New</button>
        <button type="button" className="btn ghost icon-btn cart-close" onClick={() => setCartOpen(false)} aria-label="Close cart"><FiX size={20} /></button>
      </div>

      {remoteChanged ? (
        <div className="alert warn" style={{ margin: '8px 12px 0' }}>
          This order was updated on another device.
          <button type="button" className="btn sm" style={{ marginLeft: 8 }} onClick={() => loadOrder(session.orderId)}><FiRefreshCw />Reload</button>
        </div>
      ) : null}

      <div className="cart-lines">
        {lines.length === 0 ? <div className="empty">Tap menu items to add them.</div> : null}
        {lines.map((l) => (
          <div key={l.lineId} className="cart-line">
            <div className="cl-top">
              <div className="grow">
                <div className="cl-name">{l.name}{l.isAddon ? <span className="badge" style={{ marginLeft: 6 }}>Add-on</span> : null}</div>
                <small>{fmtPrice(l.price)} each</small>
              </div>
              <div className="cl-total">{inr(lineTotal(l))}</div>
            </div>
            <div className="cl-actions">
              <div className="qty">
                <button type="button" onClick={() => changeQty(l.lineId, -1)} aria-label="Decrease"><FiMinus /></button>
                <input type="number" inputMode="numeric" value={l.qty} onChange={(e) => setQty(l.lineId, e.target.value)} aria-label="Quantity" />
                <button type="button" onClick={() => changeQty(l.lineId, 1)} aria-label="Increase"><FiPlus /></button>
              </div>
              <button type="button" className={`btn sm${l.note ? ' gold' : ''}`} onClick={() => setNoteFor(noteFor === l.lineId ? null : l.lineId)}><FiEdit3 />Note</button>
              <button type="button" className="btn sm ghost" onClick={() => removeLine(l.lineId)} aria-label="Remove item"><FiTrash2 /></button>
            </div>
            {noteFor === l.lineId || l.note ? (
              <input className="cl-note" placeholder="Item note e.g. less sugar, no onion" value={l.note} onChange={(e) => setNote(l.lineId, e.target.value)} maxLength={200} />
            ) : null}
          </div>
        ))}
      </div>

      {addons.length > 0 && lines.length > 0 ? (
        <div className="addon-strip">
          {addons.map((a) => (
            <button key={a.id} type="button" className="btn sm" disabled={!a.available} onClick={() => addProduct(a)}>
              <FiPlus />{a.name} {fmtPrice(a.price)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="cart-foot">
        <details className="cart-more">
          <summary>Customer, instructions{canDiscount ? ', discount' : ''}</summary>
          <div className="grid-2" style={{ marginTop: 8 }}>
            <input placeholder="Customer name" value={customer.name} onChange={(e) => { setCustomer({ ...customer, name: e.target.value }); touch(); }} />
            <input placeholder="Phone" type="tel" inputMode="tel" value={customer.phone} onChange={(e) => { setCustomer({ ...customer, phone: e.target.value }); touch(); }} />
          </div>
          <textarea style={{ marginTop: 8, minHeight: 50 }} placeholder="Special instructions for the order" value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} maxLength={300} />
          {canDiscount ? (
            <div className="row" style={{ marginTop: 8 }}>
              <div className="seg">
                <button type="button" className={discount.type === 'percent' ? 'on' : ''} onClick={() => { setDiscount({ ...discount, type: 'percent' }); touch(); }}>%</button>
                <button type="button" className={discount.type === 'flat' ? 'on' : ''} onClick={() => { setDiscount({ ...discount, type: 'flat' }); touch(); }}>₹</button>
              </div>
              <input className="grow" type="number" inputMode="decimal" min="0" placeholder="Discount" value={discount.value} onChange={(e) => { setDiscount({ ...discount, value: e.target.value }); touch(); }} />
            </div>
          ) : null}
        </details>

        <div className="totals">
          <div><span>Subtotal ({totals.itemCount} items)</span><span>{inr(totals.subtotal)}</span></div>
          {totals.discount > 0 ? <div className="neg"><span>Discount</span><span>-{inr(totals.discount)}</span></div> : null}
          {totals.parcelCharge > 0 ? <div><span>Parcel charges</span><span>{inr(totals.parcelCharge)}</span></div> : null}
          {totals.gst > 0 ? <div><span>GST {totals.gstPercent}%</span><span>{inr(totals.gst)}</span></div> : null}
          {totals.roundOff ? <div><span>Round off</span><span>{inr(totals.roundOff)}</span></div> : null}
          <div className="grand"><span>Grand total</span><span>{inr(totals.grandTotal)}</span></div>
        </div>

        {error ? (
          <div className="alert error" style={{ marginBottom: 8 }}>
            {error.msg}
            {error.conflict && session.version ? (
              <button type="button" className="btn sm" style={{ marginLeft: 8 }} onClick={() => loadOrder(session.orderId)}><FiRefreshCw />Reload</button>
            ) : null}
          </div>
        ) : null}
        {!online ? <div className="alert error" style={{ marginBottom: 8 }}>Offline: saving and payment are disabled.</div> : null}

        <div className="cart-buttons">
          <button type="button" className="btn lg" disabled={!canSubmit} onClick={saveActive}>
            {busy ? <span className="spinner sm" /> : <FiSave />}{editing ? 'Update order' : 'Save order'}
          </button>
          <button type="button" className="btn emerald lg" disabled={!canSubmit} onClick={openPay}>
            <FiCreditCard />Pay {inr(totals.grandTotal)}
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="pos">
      <div className="pos-bar">
        <div className="seg">
          {Object.entries(ORDER_TYPES).filter(([k]) => BILLING_TYPES.includes(k)).map(([k, v]) => (
            <button key={k} type="button" className={orderType === k ? 'on' : ''} onClick={() => { setOrderType(k); touch(); }}>{v}</button>
          ))}
        </div>
        <div className="search grow">
          <FiSearch />
          <input
            ref={searchRef} placeholder="Search menu…" value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { addProduct(shown[0]); setSearch(''); } }}
          />
          {search ? <button type="button" className="btn ghost icon-btn" onClick={() => setSearch('')} aria-label="Clear search"><FiX /></button> : null}
        </div>
      </div>

      <div className="pos-body">
        <nav className="pos-cats" aria-label="Menu categories">
          <button type="button" className={activeCat === ALL ? 'on' : ''} onClick={() => { setActiveCat(ALL); setSearch(''); }}>All items</button>
          {visibleCats.map((c) => (
            <button key={c.id} type="button" className={activeCat === c.id ? 'on' : ''} onClick={() => { setActiveCat(c.id); setSearch(''); }}>{c.name}</button>
          ))}
        </nav>

        <section className="pos-products">
          {sellable.length === 0 ? (
            <div className="empty">
              No menu items yet.{isAdmin ? <> <br /><button type="button" className="btn gold" style={{ marginTop: 12 }} onClick={() => navigate('/menu')}>Set up the menu</button></> : ' Ask an admin to add the menu.'}
            </div>
          ) : null}
          {shown.length === 0 && sellable.length > 0 ? <div className="empty">No items match “{search}”.</div> : null}
          <div className="product-grid">
            {shown.map((p) => {
              const qty = lines.filter((l) => l.productId === p.id).reduce((s, l) => s + l.qty, 0);
              return (
                <button
                  key={p.id} type="button" className={`product${p.available ? '' : ' off'}`}
                  onClick={() => addProduct(p)} disabled={!p.available}
                  title={p.description || p.name}
                >
                  {p.image ? <img src={p.image} alt="" loading="lazy" /> : null}
                  <span className="p-name">{p.name}</span>
                  {(activeCat === ALL || search) && sharedNames.has(p.name.trim().toLowerCase())
                    ? <span className="p-desc" style={{ color: 'var(--emerald-2)' }}>{categoryById[p.categoryId]?.name}</span> : null}
                  {p.description ? <span className="p-desc">{p.description}</span> : null}
                  <span className="p-foot">
                    <span className="p-price">{fmtPrice(p.price)}</span>
                    {!p.available ? <span className="badge red">Unavailable</span> : null}
                    {qty > 0 ? <span className="p-qty">{qty}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {cart}
      </div>

      <button type="button" className="pos-sticky" onClick={() => setCartOpen(true)}>
        <FiShoppingBag />
        <span className="grow" style={{ textAlign: 'left' }}>{totals.itemCount} item{totals.itemCount === 1 ? '' : 's'}{table ? ` · ${table.name}` : ''}</span>
        <strong>{inr(totals.grandTotal)}</strong>
        <span className="badge gold">View cart</span>
      </button>

      {toast ? <div className="toast" role="status">{toast}</div> : null}

      {payOpen ? (
        <PaymentModal
          title={`Pay ${editing ? `order #${session.orderNo}` : 'bill'}`}
          grandTotal={totals.grandTotal}
          methods={settings.paymentMethods}
          onClose={() => setPayOpen(false)}
          onConfirm={confirmPayment}
          summary={<p className="muted" style={{ marginTop: 0 }}>{ORDER_TYPES[orderType]}{table ? ` · ${table.name}` : ''} · {totals.itemCount} items</p>}
        />
      ) : null}

      {receipt ? (
        <ReceiptModal
          order={receipt}
          settings={settings}
          title={`Saved · ${receipt.billNo}`}
          onClose={() => { setReceipt(null); searchRef.current?.focus(); }}
        />
      ) : null}
    </div>
  );
}
