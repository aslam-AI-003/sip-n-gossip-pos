import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createElement } from 'react';
import Receipt from '../components/Receipt.jsx';

let root = null;

const PX_PER_MM = 96 / 25.4;

function waitForImages(el) {
  const imgs = Array.from(el.querySelectorAll('img'));
  return Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((r) => {
    img.onload = r; img.onerror = r;
  }))));
}

/**
 * Print a receipt through the browser print dialog.
 * The page size is set to exactly paperWidth x receiptHeight so thermal
 * drivers feed only the paper needed (no A4 page, no trailing blank page).
 * Desktop: choose the 80mm printer in the dialog.
 * Android Chrome: opens the Android print service (a printer plugin for the
 * thermal printer must be installed, e.g. the vendor's or RawBT).
 */
export async function printReceipt(order, settings, { reprint = false } = {}) {
  const host = document.getElementById('print-root');
  if (!root) root = createRoot(host);
  flushSync(() => root.render(createElement(Receipt, { order, settings, reprint })));

  // Measure the rendered height while invisible.
  const prev = host.getAttribute('style') || '';
  host.setAttribute('style', 'display:block;position:absolute;left:-10000px;top:0;');
  await waitForImages(host);
  const el = host.firstElementChild;
  const heightMm = Math.ceil(el.getBoundingClientRect().height / PX_PER_MM) + 4;
  host.setAttribute('style', prev);

  const paper = Number(settings.printer?.paperWidthMm) || 80;
  let style = document.getElementById('receipt-page-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'receipt-page-style';
    document.head.appendChild(style);
  }
  style.textContent = `@media print { @page { size: ${paper}mm ${heightMm}mm; margin: 0; } html, body { width: ${paper}mm; margin: 0 !important; padding: 0 !important; } }`;

  // Give the browser a frame to apply styles before opening the dialog.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.print();
  return { heightMm };
}
