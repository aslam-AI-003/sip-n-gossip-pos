import { collection, doc, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase.js';
import { slugify } from './format.js';

/** Minimal RFC4180 CSV parser (handles quotes, commas and newlines in quotes). */
export function parseCsv(text) {
  const out = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
}

/**
 * Rows: Category, Item, Price, Description(optional), AddOn(optional yes/no)
 * Returns { items: [{category, name, price, description, isAddon}], errors: [] }
 */
export function csvToMenu(text) {
  const rows = parseCsv(text);
  const items = [];
  const errors = [];
  rows.forEach((r, i) => {
    if (i === 0 && /category/i.test(r[0]) && /item|name/i.test(r[1] || '')) return; // header
    const [category, name, priceRaw, description = '', addon = ''] = r;
    const price = Number(String(priceRaw || '').replace(/[₹,\s]|rs\.?/gi, ''));
    if (!category || !name) { errors.push(`Line ${i + 1}: category and item name are required.`); return; }
    if (!Number.isFinite(price) || price < 0 || priceRaw === '') { errors.push(`Line ${i + 1}: "${name}" has an invalid price "${priceRaw}".`); return; }
    items.push({ category, name, price, description, isAddon: /^(y|yes|true|1)$/i.test(addon) });
  });
  return { items, errors };
}

/**
 * Upsert-without-overwrite import: creates missing categories and products.
 * Existing products (same category + same name, case-insensitive) are left
 * untouched so admin edits and prices are never overwritten by an import.
 */
export async function importMenu(groups) {
  const [catSnap, prodSnap] = await Promise.all([getDocs(collection(db, 'categories')), getDocs(collection(db, 'products'))]);
  const cats = catSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const prods = prodSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const catByName = new Map(cats.map((c) => [c.name.trim().toLowerCase(), c]));
  const prodKey = (catId, name) => `${catId}::${name.trim().toLowerCase()}`;
  const existing = new Set(prods.map((p) => prodKey(p.categoryId, p.name)));
  const usedIds = new Set([...cats.map((c) => c.id), ...prods.map((p) => p.id)]);
  let maxSort = cats.reduce((m, c) => Math.max(m, c.sortOrder || 0), 0);

  const ops = [];
  let createdCats = 0;
  let createdProducts = 0;
  let skipped = 0;

  for (const g of groups) {
    const key = g.category.trim().toLowerCase();
    let cat = catByName.get(key);
    if (!cat) {
      let id = slugify(g.category) || `cat-${Date.now()}`;
      while (usedIds.has(id)) id = `${id}-x`;
      usedIds.add(id);
      maxSort += 1;
      cat = { id, name: g.category.trim(), sortOrder: g.sortOrder ?? maxSort, active: true, isAddon: !!g.isAddon };
      catByName.set(key, cat);
      ops.push((b) => b.set(doc(db, 'categories', id), { name: cat.name, sortOrder: cat.sortOrder, active: true, isAddon: cat.isAddon, createdAt: serverTimestamp() }));
      createdCats += 1;
    }
    (g.items || []).forEach((it, idx) => {
      const k = prodKey(cat.id, it.name);
      if (existing.has(k)) { skipped += 1; return; }
      existing.add(k);
      let id = `${cat.id}--${slugify(it.name)}`.slice(0, 120);
      while (usedIds.has(id)) id = `${id}-x`;
      usedIds.add(id);
      const data = {
        name: it.name.trim(),
        categoryId: cat.id,
        price: Number(it.price),
        description: (it.description || '').trim(),
        available: true,
        active: true,
        isAddon: !!(it.isAddon || g.isAddon || cat.isAddon),
        sortOrder: idx + 1,
        image: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      ops.push((b) => b.set(doc(db, 'products', id), data));
      createdProducts += 1;
    });
  }

  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach((op) => op(b));
    await b.commit(); // eslint-disable-line no-await-in-loop
  }
  return { createdCats, createdProducts, skipped };
}

export function groupItems(items) {
  const m = new Map();
  for (const it of items) {
    if (!m.has(it.category)) m.set(it.category, { category: it.category, items: [] });
    m.get(it.category).items.push(it);
  }
  return [...m.values()];
}
