import { useMemo, useState } from 'react';
import {
  doc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, collection,
} from 'firebase/firestore';
import { FiPlus, FiEdit, FiSearch, FiUpload, FiPercent, FiSave, FiList, FiTrash2 } from 'react-icons/fi';
import { db } from '../firebase.js';
import { useData } from '../context/DataContext.jsx';
import { useConnection } from '../context/ConnectionContext.jsx';
import Modal from '../components/Modal.jsx';
import { inr, price as fmtPrice, errorMessage, slugify } from '../lib/format.js';
import { round2 } from '../lib/calc.js';
import { resizeImage } from '../lib/image.js';
import { csvToMenu, groupItems, importMenu } from '../lib/menuImport.js';
import { MENU, MENU_SOURCE_COMPLETE } from '../data/menu.js';

async function commitChunks(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach((op) => op(b));
    await b.commit(); // eslint-disable-line no-await-in-loop
  }
}

export default function MenuAdmin() {
  const { products, categories, categoryById } = useData();
  const { online } = useConnection();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [edit, setEdit] = useState(null);
  const [modal, setModal] = useState(null); // 'cats' | 'import' | 'bulk'
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter((p) => (showInactive || p.active !== false)
      && (!cat || p.categoryId === cat)
      && (!s || p.name.toLowerCase().includes(s)))
      .sort((a, b) => (categoryById[a.categoryId]?.sortOrder ?? 999) - (categoryById[b.categoryId]?.sortOrder ?? 999) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [products, q, cat, showInactive, categoryById]);

  const changed = Object.entries(drafts).filter(([id, v]) => {
    const p = products.find((x) => x.id === id);
    return p && v !== '' && Number(v) !== p.price;
  });

  const savePrices = async () => {
    const bad = changed.find(([, v]) => !(Number(v) >= 0));
    if (bad) { setMsg({ err: true, text: 'Prices must be zero or more.' }); return; }
    setBusy(true); setMsg(null);
    try {
      await commitChunks(changed.map(([id, v]) => (b) => b.update(doc(db, 'products', id), { price: round2(Number(v)), updatedAt: serverTimestamp() })));
      setDrafts({});
      setMsg({ text: `Updated ${changed.length} price${changed.length === 1 ? '' : 's'}. Future orders use the new prices; saved bills keep their original prices.` });
    } catch (e) { setMsg({ err: true, text: errorMessage(e) }); } finally { setBusy(false); }
  };

  const [pending, setPending] = useState({});
  // Keep the button disabled until Firestore confirms the write.
  const toggleAvail = async (p) => {
    setPending((x) => ({ ...x, [p.id]: true }));
    try { await updateDoc(doc(db, 'products', p.id), { available: !p.available, updatedAt: serverTimestamp() }); } catch (e) { setMsg({ err: true, text: errorMessage(e) }); }
    setPending((x) => { const { [p.id]: _, ...rest } = x; return rest; }); // eslint-disable-line no-unused-vars
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Menu</h1>
        <div className="row wrap">
          <button type="button" className="btn" onClick={() => setModal('cats')}><FiList />Categories</button>
          <button type="button" className="btn" onClick={() => setModal('import')}><FiUpload />Import</button>
          <button type="button" className="btn" onClick={() => setModal('bulk')}><FiPercent />Bulk price</button>
          <button type="button" className="btn gold" onClick={() => setEdit({})} disabled={!categories.length}><FiPlus />Add item</button>
        </div>
      </div>
      {msg ? <div className={`alert ${msg.err ? 'error' : 'ok'}`}>{msg.text}</div> : null}
      {products.length === 0 ? (
        <div className="alert warn">The menu is empty. Use <strong>Import</strong> to load the categories and items, or paste the menu as CSV.</div>
      ) : null}

      <div className="card">
        <div className="row wrap">
          <div className="search grow" style={{ minWidth: 200 }}><FiSearch /><input placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show deactivated</label>
        </div>
      </div>

      {changed.length ? (
        <div className="alert warn row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <span>{changed.length} unsaved price change{changed.length === 1 ? '' : 's'}</span>
          <span className="row">
            <button type="button" className="btn sm" onClick={() => setDrafts({})}>Discard</button>
            <button type="button" className="btn sm emerald" onClick={savePrices} disabled={busy || !online}><FiSave />Save prices</button>
          </span>
        </div>
      ) : null}

      <div className="card" style={{ padding: 0, marginTop: 12 }}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Item</th><th className="hide-sm">Category</th><th className="num">Price (₹)</th><th>Available</th><th /></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} style={{ opacity: p.active === false ? 0.5 : 1 }}>
                  <td>
                    <strong>{p.name}</strong>
                    {p.active === false ? <span className="badge red" style={{ marginLeft: 6 }}>Deactivated</span> : null}
                    {p.description ? <div><small>{p.description}</small></div> : null}
                  </td>
                  <td className="hide-sm">{categoryById[p.categoryId]?.name || <span className="badge red">Missing</span>}</td>
                  <td className="num">
                    <input
                      type="number" inputMode="decimal" min="0" step="1" style={{ width: 96, textAlign: 'right' }}
                      value={drafts[p.id] ?? p.price} onChange={(e) => setDrafts({ ...drafts, [p.id]: e.target.value })}
                      aria-label={`Price of ${p.name}`}
                    />
                  </td>
                  <td>
                    <button type="button" className={`btn sm ${p.available ? 'emerald' : 'danger'}`} onClick={() => toggleAvail(p)} disabled={!online || !!pending[p.id]} aria-busy={!!pending[p.id]}>
                      {pending[p.id] ? <span className="spinner sm" /> : null}
                      {p.available ? 'Available' : 'Unavailable'}
                    </button>
                  </td>
                  <td className="num"><button type="button" className="btn ghost icon-btn" onClick={() => setEdit(p)} aria-label="Edit"><FiEdit /></button></td>
                </tr>
              ))}
              {list.length === 0 ? <tr><td colSpan={5} className="empty">No items.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      {edit ? <ProductForm initial={edit} onClose={() => setEdit(null)} /> : null}
      {modal === 'cats' ? <CategoryManager onClose={() => setModal(null)} /> : null}
      {modal === 'import' ? <ImportModal onClose={() => setModal(null)} onDone={(t) => setMsg({ text: t })} /> : null}
      {modal === 'bulk' ? <BulkPrice onClose={() => setModal(null)} onDone={(t) => setMsg({ text: t })} /> : null}
    </div>
  );
}

function ProductForm({ initial, onClose }) {
  const { categories, categoryById } = useData();
  const { online } = useConnection();
  const [f, setF] = useState({
    name: initial.name || '',
    categoryId: initial.categoryId || categories[0]?.id || '',
    price: initial.price != null ? String(initial.price) : '',
    description: initial.description || '',
    available: initial.available !== false,
    active: initial.active !== false,
    isAddon: !!initial.isAddon,
    sortOrder: initial.sortOrder ?? '',
    image: initial.image || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const onImage = async (e) => {
    setErr('');
    try { setF({ ...f, image: await resizeImage(e.target.files[0]) }); } catch (x) { setErr(x.message); }
  };

  const save = async () => {
    setErr('');
    const price = Number(f.price);
    if (!f.name.trim()) return setErr('Enter the item name.');
    if (f.price === '' || !(price >= 0)) return setErr('Enter a valid price.');
    if (!categoryById[f.categoryId]) return setErr('Choose a category.');
    setBusy(true);
    const data = {
      name: f.name.trim(), categoryId: f.categoryId, price: round2(price), description: f.description.trim(),
      available: !!f.available, active: !!f.active, isAddon: !!f.isAddon || !!categoryById[f.categoryId]?.isAddon,
      sortOrder: f.sortOrder === '' ? 999 : Number(f.sortOrder), image: f.image || '', updatedAt: serverTimestamp(),
    };
    try {
      if (initial.id) await updateDoc(doc(db, 'products', initial.id), data);
      else {
        const id = `${f.categoryId}--${slugify(f.name)}-${Date.now().toString(36)}`;
        await setDoc(doc(db, 'products', id), { ...data, createdAt: serverTimestamp() });
      }
      onClose();
    } catch (e) { setErr(errorMessage(e)); setBusy(false); }
    return null;
  };

  const remove = async () => {
    if (!window.confirm(`Permanently delete "${initial.name}"? Past bills keep their copy of the item. Consider "Deactivate" instead.`)) return;
    setBusy(true);
    try { await deleteDoc(doc(db, 'products', initial.id)); onClose(); } catch (e) { setErr(errorMessage(e)); setBusy(false); }
  };

  return (
    <Modal title={initial.id ? 'Edit item' : 'Add item'} onClose={onClose} busy={busy} footer={(
      <>
        {initial.id ? <button type="button" className="btn danger" onClick={remove} disabled={busy || !online}><FiTrash2 />Delete</button> : null}
        <button type="button" className="btn gold" onClick={save} disabled={busy || !online}>{busy ? <span className="spinner sm" /> : null}Save</button>
      </>
    )}>
      {err ? <div className="alert error">{err}</div> : null}
      <div className="field"><label>Item name</label><input value={f.name} onChange={set('name')} maxLength={100} autoFocus /></div>
      <div className="grid-2">
        <div className="field"><label>Category</label><select value={f.categoryId} onChange={set('categoryId')}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label>Price (₹)</label><input type="number" inputMode="decimal" min="0" step="0.01" value={f.price} onChange={set('price')} /></div>
      </div>
      <div className="field"><label>Description (combo contents etc.)</label><textarea value={f.description} onChange={set('description')} maxLength={300} /></div>
      <div className="grid-2">
        <label className="check"><input type="checkbox" checked={f.available} onChange={set('available')} />Available for billing</label>
        <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} />Active (uncheck to deactivate)</label>
        <label className="check"><input type="checkbox" checked={f.isAddon} onChange={set('isAddon')} />Add-on (shown in cart add-on bar)</label>
        <div className="field"><label>Sort order</label><input type="number" value={f.sortOrder} onChange={set('sortOrder')} /></div>
      </div>
      <div className="field">
        <label>Image (optional, resized automatically)</label>
        <div className="row">
          {f.image ? <img src={f.image} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }} /> : null}
          <input type="file" accept="image/*" onChange={onImage} />
          {f.image ? <button type="button" className="btn sm" onClick={() => setF({ ...f, image: '' })}>Remove</button> : null}
        </div>
      </div>
    </Modal>
  );
}

function CategoryManager({ onClose }) {
  const { categories, products } = useData();
  const { online } = useConnection();
  const [rows, setRows] = useState(() => categories.map((c) => ({ ...c })));
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const count = (id) => products.filter((p) => p.categoryId === id).length;
  const upd = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    if (rows.some((r) => r.name.toLowerCase() === name.toLowerCase())) { setErr('Category already exists.'); return; }
    setRows([...rows, { id: null, name, sortOrder: rows.length + 1, active: true, isAddon: false }]);
    setNewName('');
  };

  const save = async () => {
    setErr(''); setBusy(true);
    try {
      const ops = rows.map((r) => (b) => {
        const data = { name: r.name.trim(), sortOrder: Number(r.sortOrder) || 0, active: r.active !== false, isAddon: !!r.isAddon, updatedAt: serverTimestamp() };
        if (r.id) b.update(doc(db, 'categories', r.id), data);
        else b.set(doc(collection(db, 'categories')), { ...data, createdAt: serverTimestamp() });
      });
      await commitChunks(ops);
      onClose();
    } catch (e) { setErr(errorMessage(e)); setBusy(false); }
  };

  const remove = async (r, i) => {
    if (!r.id) { setRows(rows.filter((_, j) => j !== i)); return; }
    if (count(r.id) > 0) { setErr(`"${r.name}" still has ${count(r.id)} items. Move or delete them first, or deactivate the category.`); return; }
    if (!window.confirm(`Delete category "${r.name}"?`)) return;
    try { await deleteDoc(doc(db, 'categories', r.id)); setRows(rows.filter((_, j) => j !== i)); } catch (e) { setErr(errorMessage(e)); }
  };

  return (
    <Modal wide title="Categories" onClose={onClose} busy={busy} footer={<button type="button" className="btn gold" onClick={save} disabled={busy || !online}>{busy ? <span className="spinner sm" /> : null}Save categories</button>}>
      {err ? <div className="alert error">{err}</div> : null}
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Order</th><th>Name</th><th>Items</th><th>Active</th><th>Add-ons</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id || `new-${i}`}>
                <td><input type="number" value={r.sortOrder ?? ''} onChange={(e) => upd(i, { sortOrder: e.target.value })} style={{ width: 70 }} /></td>
                <td><input value={r.name} onChange={(e) => upd(i, { name: e.target.value })} /></td>
                <td>{r.id ? count(r.id) : 0}</td>
                <td><input type="checkbox" checked={r.active !== false} onChange={(e) => upd(i, { active: e.target.checked })} /></td>
                <td><input type="checkbox" checked={!!r.isAddon} onChange={(e) => upd(i, { isAddon: e.target.checked })} /></td>
                <td><button type="button" className="btn ghost icon-btn" onClick={() => remove(r, i)} aria-label="Delete"><FiTrash2 /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <input className="grow" placeholder="New category name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button type="button" className="btn" onClick={add}><FiPlus />Add</button>
      </div>
    </Modal>
  );
}

function ImportModal({ onClose, onDone }) {
  const { online } = useConnection();
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const parsed = useMemo(() => (csv.trim() ? csvToMenu(csv) : null), [csv]);
  const seedCount = MENU.reduce((s, g) => s + g.items.length, 0);

  const run = async (groups) => {
    setErr(''); setBusy(true);
    try {
      const r = await importMenu(groups);
      onDone(`Import finished: ${r.createdCats} new categories, ${r.createdProducts} new items, ${r.skipped} existing items left unchanged.`);
      onClose();
    } catch (e) { setErr(errorMessage(e)); setBusy(false); }
  };

  return (
    <Modal wide title="Import menu" onClose={onClose} busy={busy}>
      {err ? <div className="alert error">{err}</div> : null}
      <div className="card">
        <h3>SIP N' GOSSIP menu (built-in)</h3>
        <p className="muted">{MENU.length} categories, {seedCount} items.{!MENU_SOURCE_COMPLETE ? ' The item list is incomplete: items from the PDF still need to be entered (paste them below as CSV, or add them one by one).' : ''}</p>
        <button type="button" className="btn gold" disabled={busy || !online} onClick={() => run(MENU.map((g, i) => ({ ...g, sortOrder: i + 1 })))}>
          {busy ? <span className="spinner sm" /> : <FiUpload />}Load built-in menu
        </button>
      </div>
      <div className="card">
        <h3>Paste CSV</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          One item per line: <code>Category,Item,Price,Description,AddOn</code>. Description and AddOn (yes/no) are optional. Wrap text containing commas in quotes. Existing items with the same name in the same category are skipped, never overwritten.
        </p>
        <textarea rows={8} style={{ fontFamily: 'monospace', fontSize: 13 }} placeholder={'Category,Item,Price,Description\nMojito,Example Mojito,0,'} value={csv} onChange={(e) => setCsv(e.target.value)} />
        {parsed ? (
          <>
            {parsed.errors.length ? <div className="alert error" style={{ marginTop: 8 }}>{parsed.errors.slice(0, 10).map((x) => <div key={x}>{x}</div>)}</div> : null}
            <p>{parsed.items.length} valid items in {groupItems(parsed.items).length} categories.</p>
            <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
              <table className="data"><tbody>{parsed.items.slice(0, 200).map((it, i) => <tr key={i}><td>{it.category}</td><td>{it.name}</td><td className="num">{fmtPrice(it.price)}</td></tr>)}</tbody></table>
            </div>
            <button type="button" className="btn emerald" style={{ marginTop: 10 }} disabled={busy || !online || parsed.items.length === 0 || parsed.errors.length > 0} onClick={() => run(groupItems(parsed.items))}>
              Import {parsed.items.length} items
            </button>
            {parsed.errors.length > 0 ? <small style={{ marginLeft: 8 }}>Fix the errors above to import.</small> : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function BulkPrice({ onClose, onDone }) {
  const { products, categories } = useData();
  const { online } = useConnection();
  const [cat, setCat] = useState('');
  const [mode, setMode] = useState('percent');
  const [value, setValue] = useState('');
  const [rounding, setRounding] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const targets = products.filter((p) => p.active !== false && (!cat || p.categoryId === cat));
  const v = Number(value) || 0;
  const next = (p) => {
    let n = mode === 'percent' ? p.price * (1 + v / 100) : p.price + v;
    n = rounding ? Math.round(n) : round2(n);
    return Math.max(0, n);
  };
  const apply = async () => {
    if (!v) { setErr('Enter a change.'); return; }
    if (!window.confirm(`Change ${targets.length} prices?`)) return;
    setBusy(true); setErr('');
    try {
      await commitChunks(targets.map((p) => (b) => b.update(doc(db, 'products', p.id), { price: next(p), updatedAt: serverTimestamp() })));
      onDone(`Updated ${targets.length} prices. Saved bills keep their original prices.`);
      onClose();
    } catch (e) { setErr(errorMessage(e)); setBusy(false); }
  };
  return (
    <Modal wide title="Bulk price update" onClose={onClose} busy={busy} footer={<button type="button" className="btn gold" onClick={apply} disabled={busy || !online || !targets.length}>{busy ? <span className="spinner sm" /> : null}Apply to {targets.length} items</button>}>
      {err ? <div className="alert error">{err}</div> : null}
      <div className="grid-3">
        <div className="field"><label>Category</label><select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label>Change by</label><div className="seg"><button type="button" className={mode === 'percent' ? 'on' : ''} onClick={() => setMode('percent')}>%</button><button type="button" className={mode === 'flat' ? 'on' : ''} onClick={() => setMode('flat')}>₹</button></div></div>
        <div className="field"><label>Amount (negative to reduce)</label><input type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></div>
      </div>
      <label className="check"><input type="checkbox" checked={rounding} onChange={(e) => setRounding(e.target.checked)} />Round to whole rupees</label>
      <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto', marginTop: 8 }}>
        <table className="data">
          <thead><tr><th>Item</th><th className="num">Now</th><th className="num">New</th></tr></thead>
          <tbody>{targets.map((p) => <tr key={p.id}><td>{p.name}</td><td className="num">{inr(p.price)}</td><td className="num" style={{ color: 'var(--gold)' }}>{inr(next(p))}</td></tr>)}</tbody>
        </table>
      </div>
    </Modal>
  );
}
