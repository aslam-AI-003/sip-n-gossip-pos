// End-to-end browser test of the real UI against the Firebase emulators.
// Run: npm run test:e2e   (starts emulators + Vite, drives Chrome with Playwright)
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = 'test-output';
mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:5199';
const results = [];
const ok = (name, detail = '') => { results.push({ name, pass: true, detail }); console.log(`PASS ${name} ${detail}`); };
const fail = (name, detail) => { results.push({ name, pass: false, detail }); console.log(`FAIL ${name} ${detail}`); };
const pages = [];
async function check(name, fn) {
  try { const d = await fn(); ok(name, d || ''); } catch (e) {
    fail(name, e.message.split('\n').slice(0, 3).join(' | '));
    for (const [i, pg] of pages.entries()) await pg.screenshot({ path: `${OUT}/FAIL-${name.replace(/\W+/g, '_').slice(0, 40)}-${i}.png` }).catch(() => {});
  }
}
const expectEq = (a, b, what) => { if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const vite = spawn('node_modules/.bin/vite', ['--port', '5199', '--strictPort', '--host', '127.0.0.1'], {
  env: { ...process.env, VITE_USE_EMULATOR: 'true' }, stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('vite did not start')), 30000);
  vite.stdout.on('data', (d) => { if (String(d).includes('Local')) { clearTimeout(t); res(); } });
});

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });

async function noHScroll(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (sw > iw + 1) throw new Error(`${label}: page is ${sw}px wide in a ${iw}px viewport`);
  return `${sw}<=${iw}`;
}
async function minTouch(page, selector) {
  const small = await page.$$eval(selector, (els) => els.filter((e) => e.offsetParent).map((e) => ({ t: (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 20), h: e.getBoundingClientRect().height }))
    .filter((x) => x.h < 43.5));
  if (small.length) throw new Error(`targets under 44px: ${JSON.stringify(small.slice(0, 5))}`);
}
const money = (s) => Number(String(s).replace(/[^\d.-]/g, ''));

try {
  // ================= DESKTOP (admin) =================
  const desk = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  const page = await desk.newPage();
  pages.push(page);
  page.on('console', (msg) => { if (['error', 'warning'].includes(msg.type())) console.log(`[browser ${msg.type()}] ${msg.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => fail('no JS errors (desktop)', e.message));
  await page.goto(`${BASE}/`);

  await check('first-run setup creates admin', async () => {
    await page.getByText('First-time setup').waitFor();
    const inputs = page.locator('form input');
    await inputs.nth(0).fill('Owner');
    await inputs.nth(1).fill('owner@sng.test');
    await inputs.nth(2).fill('ownerpass1');
    await inputs.nth(3).fill('ownerpass1');
    await inputs.nth(4).fill('6');
    await page.getByRole('button', { name: 'Create admin account' }).click();
    await page.locator('.sidebar').getByText('Dashboard').waitFor({ timeout: 15000 });
    await page.locator('.conn.online').waitFor({ timeout: 15000 });
  });

  await check('import built-in menu structure + CSV items', async () => {
    await page.goto(`${BASE}/menu`);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('button', { name: 'Load built-in menu' }).click();
    await page.getByText(/Import finished: 30 new categories, 2 new items/).waitFor();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.locator('textarea').fill([
      'Category,Item,Price,Description',
      'Hot Beverages,E2E Tea,20,',
      'Burger,E2E Burger,120,',
      'Mojito,E2E Mojito,90,',
      'Special Veg Combos,E2E Veg Combo,199,"Burger + Fries + Mojito"',
      'Hot Beverages,E2E Tea,25,',
    ].join('\n'));
    await page.getByRole('button', { name: /Import 5 items/ }).click();
    await page.getByText(/0 new categories, 4 new items, 1 existing/).waitFor();
    return 'duplicate row skipped';
  });

  await check('mark item unavailable blocks it in POS', async () => {
    const row = page.locator('tr', { hasText: 'E2E Mojito' });
    await row.getByRole('button', { name: 'Available', exact: true }).click();
    await row.getByRole('button', { name: 'Unavailable', exact: true }).waitFor();
    await page.goto(`${BASE}/pos`);
    const btn = page.locator('button.product', { hasText: 'E2E Mojito' });
    if (!(await btn.isDisabled())) throw new Error('unavailable product is clickable');
    await page.goto(`${BASE}/menu`);
    await page.locator('tr', { hasText: 'E2E Mojito' }).getByRole('button', { name: 'Unavailable', exact: true }).click();
    await page.locator('tr', { hasText: 'E2E Mojito' }).getByRole('button', { name: 'Available', exact: true }).waitFor();
  });

  await check('settings: enable 5% GST and set address', async () => {
    await page.goto(`${BASE}/settings`);
    await page.getByLabel('Charge GST').check();
    await page.locator('input[type=number]').first().fill('5');
    await page.locator('textarea').first().fill('12 Beach Road, Kochi, Kerala');
    await page.locator('input').nth(2).fill('+91 90000 00000');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await page.getByText('Settings saved').waitFor();
  });

  await check('dine-in: save active order on Table 1', async () => {
    await page.goto(`${BASE}/pos`);
    await page.getByRole('button', { name: 'Select table' }).click();
    await page.locator('.table-tile', { hasText: 'Table 1' }).click();
    await page.locator('button.product', { hasText: 'E2E Tea' }).click();
    await page.locator('button.product', { hasText: 'E2E Tea' }).click();
    await page.locator('button.product', { hasText: 'E2E Burger' }).click();
    const total = await page.locator('.pos-cart .totals .grand span').last().innerText();
    expectEq(money(total), 168, 'grand total (160 + 5% GST)');
    await page.getByRole('button', { name: 'Save order' }).click();
    await page.locator('.toast', { hasText: 'Order #1 saved for Table 1' }).waitFor();
    return total;
  });

  await check('tables page shows Table 1 occupied', async () => {
    await page.goto(`${BASE}/tables`);
    const tile = page.locator('.table-tile', { hasText: 'Table 1' });
    await tile.locator('text=#1').waitFor();
    const cls = await tile.getAttribute('class');
    if (!cls.includes('busy')) throw new Error('not marked occupied');
    await page.screenshot({ path: `${OUT}/desktop-tables.png` });
  });

  await check('dine-in: reopen table, add items + add-on, split pay 200 cash + rest UPI', async () => {
    await page.locator('.table-tile', { hasText: 'Table 1' }).click();
    await page.getByText('Order #1').first().waitFor();
    await page.locator('button.product', { hasText: 'E2E Mojito' }).click();
    await page.locator('.addon-strip button', { hasText: 'Cheese Extra' }).click();
    const total = money(await page.locator('.pos-cart .totals .grand span').last().innerText());
    expectEq(total, 273, 'grand total (40+120+90+10 = 260 + 13 GST)');
    await page.screenshot({ path: `${OUT}/desktop-pos.png` });
    await page.getByRole('button', { name: /^Pay / }).click();
    const modal = page.locator('.modal');
    await modal.locator('input[placeholder=Amount]').first().fill('200');
    await modal.getByRole('button', { name: 'Split payment' }).click();
    await modal.locator('select').nth(1).selectOption('upi');
    const second = await modal.locator('input[placeholder=Amount]').nth(1).inputValue();
    expectEq(Number(second), 73, 'auto-filled remaining');
    await modal.locator('#tendered').fill('500');
    const change = await modal.getByText('Change to return').locator('..').innerText();
    if (!change.includes('300.00')) throw new Error(`change shown: ${change}`);
    await page.screenshot({ path: `${OUT}/desktop-payment.png` });
    await modal.getByRole('button', { name: /Confirm/ }).click();
    await page.getByText('Saved · SNG-00001').waitFor({ timeout: 15000 });
  });

  await check('80mm receipt: print output is one 80mm page, no A4', async () => {
    await page.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
    await page.locator('.modal').getByRole('button', { name: /^Print$/ }).click();
    await page.waitForFunction(() => window.__printed === 1);
    await page.screenshot({ path: `${OUT}/desktop-receipt-modal.png` });
    await page.pdf({ path: `${OUT}/print-output.pdf`, preferCSSPageSize: true, printBackground: true });
    const info = execFileSync('pdfinfo', [`${OUT}/print-output.pdf`]).toString();
    const pages = Number(/Pages:\s+(\d+)/.exec(info)[1]);
    const [, w, h] = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(info);
    const wmm = (Number(w) / 72) * 25.4;
    const hmm = (Number(h) / 72) * 25.4;
    expectEq(pages, 1, 'pages');
    if (Math.abs(wmm - 80) > 0.6) throw new Error(`width ${wmm.toFixed(1)}mm`);
    execFileSync('pdftoppm', ['-png', '-r', '203', '-singlefile', `${OUT}/print-output.pdf`, `${OUT}/print-output`]);
    const text = execFileSync('pdftotext', ['-layout', `${OUT}/print-output.pdf`, '-']).toString();
    for (const s of ["SIP N' GOSSIP CAFE", 'Fresh Sips, Happy Vibes!', 'SNG-00001', 'GRAND TOTAL', '273.00', 'Cash', 'UPI', 'Thank you for visiting!', 'Visit Again!', 'Table 1', 'CGST', 'Paid']) {
      if (!text.includes(s)) throw new Error(`printed receipt missing "${s}"`);
    }
    if (/Billing|Dashboard|Orders/.test(text)) throw new Error('app UI leaked into print output');
    return `${pages} page, ${wmm.toFixed(1)} x ${hmm.toFixed(1)} mm`;
  });

  await check('receipt PDF download is 80mm wide', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.modal').getByRole('button', { name: /^PDF$/ }).click()]);
    const path = `${OUT}/${dl.suggestedFilename()}`;
    await dl.saveAs(path);
    const info = execFileSync('pdfinfo', [path]).toString();
    const [, w, h] = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(info);
    const wmm = (Number(w) / 72) * 25.4;
    if (Math.abs(wmm - 80) > 0.6) throw new Error(`width ${wmm}`);
    const text = execFileSync('pdftotext', ['-layout', path, '-']).toString();
    if (!text.includes('Rs.273.00')) throw new Error('total missing in PDF');
    execFileSync('pdftoppm', ['-png', '-r', '150', '-singlefile', path, `${OUT}/receipt-download`]);
    await page.locator('.modal').getByRole('button', { name: 'Close' }).click();
    return `${dl.suggestedFilename()} ${wmm.toFixed(1)} x ${((Number(h) / 72) * 25.4).toFixed(1)} mm`;
  });

  await check('table freed after billing', async () => {
    await page.goto(`${BASE}/tables`);
    const cls = await page.locator('.table-tile', { hasText: 'Table 1' }).getAttribute('class');
    if (cls.includes('busy')) throw new Error('still occupied');
  });

  await check('parcel: parcel charges + bill as pending, then collect from Orders', async () => {
    await page.goto(`${BASE}/pos?type=parcel`);
    await page.locator('.pos-bar .seg button.on', { hasText: 'Parcel' }).waitFor();
    await page.locator('button.product', { hasText: 'E2E Veg Combo' }).click();
    const parcel = await page.locator('.pos-cart .totals div', { hasText: 'Parcel charges' }).innerText();
    if (!parcel.includes('5.00')) throw new Error(`parcel line: ${parcel}`);
    // 199 + 5 = 204, GST 10.20 -> 214.20 -> rounded 214
    expectEq(money(await page.locator('.pos-cart .totals .grand span').last().innerText()), 214, 'parcel total');
    await page.getByRole('button', { name: /^Pay / }).click();
    await page.getByRole('button', { name: 'Bill as pending (no payment)' }).click();
    await page.getByText('Saved · SNG-00002').waitFor();
    await page.locator('.modal').getByRole('button', { name: 'Close' }).click();
    await page.goto(`${BASE}/orders`);
    await page.getByRole('button', { name: 'Pending payment' }).click();
    await page.locator('tr', { hasText: 'SNG-00002' }).click();
    await page.getByRole('button', { name: /Collect/ }).click();
    await page.locator('.modal').getByRole('button', { name: 'UPI', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: /Confirm/ }).click();
    await page.locator('.modal .badge', { hasText: 'Paid' }).waitFor();
    await page.locator('.modal').getByRole('button', { name: 'Close' }).click();
  });

  await check('takeaway: no parcel charge, full cash', async () => {
    await page.goto(`${BASE}/pos?type=takeaway`);
    await page.locator('.pos-bar .seg button.on', { hasText: 'Takeaway' }).waitFor();
    await page.locator('button.product', { hasText: 'E2E Veg Combo' }).click();
    if (await page.locator('.pos-cart .totals div', { hasText: 'Parcel charges' }).count()) throw new Error('parcel charge on takeaway');
    await page.getByRole('button', { name: /^Pay / }).click();
    await page.locator('.modal').getByRole('button', { name: 'Cash', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: /Confirm/ }).click();
    await page.getByText('Saved · SNG-00003').waitFor();
    await page.locator('.modal').getByRole('button', { name: 'Close' }).click();
  });

  await check('cancel an active order frees the table', async () => {
    await page.goto(`${BASE}/pos?table=T02`);
    await page.getByRole('button', { name: 'Table 2' }).waitFor();
    await page.locator('button.product', { hasText: 'E2E Tea' }).click();
    await page.getByRole('button', { name: 'Save order' }).click();
    await page.locator('.toast').waitFor();
    await page.goto(`${BASE}/orders`);
    await page.locator('tr', { hasText: 'Table 2' }).click();
    await page.getByRole('button', { name: 'Cancel order' }).click();
    await page.locator('.modal input').fill('Customer left');
    await page.locator('.modal').getByRole('button', { name: 'Cancel order' }).click();
    await page.locator('.modal .badge', { hasText: 'cancelled' }).waitFor();
    await page.locator('.modal').getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Cancelled', exact: true }).click();
    await page.locator('tr', { hasText: 'Table 2' }).waitFor();
    await page.goto(`${BASE}/tables`);
    const cls = await page.locator('.table-tile', { hasText: 'Table 2' }).getAttribute('class');
    if (cls.includes('busy')) throw new Error('Table 2 still occupied');
  });

  await check('admin refund recorded', async () => {
    await page.goto(`${BASE}/orders`);
    await page.getByRole('button', { name: 'Completed', exact: true }).click();
    await page.locator('tr', { hasText: 'SNG-00003' }).click();
    await page.getByRole('button', { name: 'Refund', exact: true }).click();
    await page.locator('.modal input').first().fill('50');
    await page.locator('.modal input').last().fill('Item not available');
    await page.getByRole('button', { name: 'Record refund' }).click();
    await page.locator('.modal').getByText('Refunded').first().waitFor();
    await page.locator('.modal').getByRole('button', { name: 'Close' }).click();
  });

  await check('dashboard figures match Firebase records', async () => {
    await page.goto(`${BASE}/dashboard`);
    await page.locator('.kpi').first().waitFor();
    await page.waitForTimeout(1500);
    const kpi = async (k) => money(await page.locator('.kpi', { hasText: k }).locator('.v').innerText());
    // Bills: 273 + 214 + 209 (199 + 9.95 GST = 208.95 -> 209)
    expectEq(await kpi('Today sales'), 696, 'today sales');
    expectEq(await kpi('Bills'), 3, 'bills');
    expectEq(await kpi('Cash'), 200 + 209, 'cash');
    expectEq(await kpi('UPI'), 73 + 214, 'upi');
    expectEq(await kpi('Pending payments'), 0, 'pending');
    // profit = 696 - GST(13 + 10.20 + 9.95) - refund 50 - expenses 0 = 612.85
    expectEq(await kpi('Estimated profit'), 612.85, 'profit');
    await page.screenshot({ path: `${OUT}/desktop-dashboard.png`, fullPage: true });
  });

  await check('expense entry updates profit', async () => {
    await page.goto(`${BASE}/expenses`);
    await page.getByRole('button', { name: 'Add expense' }).click();
    await page.locator('.modal input').first().fill('Milk');
    await page.locator('.modal select').first().selectOption('Milk & dairy');
    await page.locator('.modal input[type=number]').fill('112.85');
    await page.locator('.modal').getByRole('button', { name: 'Save' }).click();
    await page.locator('tr', { hasText: 'Milk' }).waitFor();
    await page.goto(`${BASE}/dashboard`);
    await page.waitForTimeout(1500);
    expectEq(money(await page.locator('.kpi', { hasText: 'Estimated profit' }).locator('.v').innerText()), 500, 'profit after expense');
  });

  await check('reports + CSV/Excel/PDF exports', async () => {
    await page.goto(`${BASE}/reports`);
    await page.locator('.kpi', { hasText: 'Total revenue' }).waitFor();
    expectEq(money(await page.locator('.kpi', { hasText: 'Total revenue' }).locator('.v').innerText()), 696, 'revenue');
    const files = [];
    for (const name of ['CSV', 'Excel', 'PDF']) {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name, exact: true }).click()]);
      await dl.saveAs(`${OUT}/${dl.suggestedFilename()}`);
      files.push(dl.suggestedFilename());
    }
    await page.screenshot({ path: `${OUT}/desktop-reports.png` });
    return files.join(', ');
  });

  await check('admin adds a cashier', async () => {
    await page.goto(`${BASE}/staff`);
    await page.getByRole('button', { name: 'Add staff' }).click();
    const inputs = page.locator('.modal input');
    await inputs.nth(0).fill('Cashier One');
    await inputs.nth(1).fill('cashier@sng.test');
    await inputs.nth(2).fill('cashpass1');
    await page.getByRole('button', { name: 'Create login' }).click();
    await page.getByText('Cashier One added as cashier').waitFor();
    // Admin is still signed in (secondary auth instance used).
    await page.locator('.sidebar', { hasText: 'Owner' }).waitFor();
  });

  // ================= ANDROID PHONE (cashier) =================
  const phone = await browser.newContext({
    viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  });
  const m = await phone.newPage();
  m.on('pageerror', (e) => fail('no JS errors (mobile)', e.message));
  await m.goto(`${BASE}/`);

  await check('mobile: cashier login', async () => {
    await m.locator('#email').fill('cashier@sng.test');
    await m.locator('#pw').fill('cashpass1');
    await m.getByRole('button', { name: 'Sign in' }).tap();
    await m.locator('.bottom-nav').waitFor();
    await m.locator('.conn.online').waitFor({ timeout: 15000 });
  });

  await check('mobile: cashier cannot open admin pages', async () => {
    await m.goto(`${BASE}/dashboard`);
    await m.waitForURL(/\/pos/);
    if (await m.locator('.bottom-nav', { hasText: 'Dashboard' }).count()) throw new Error('admin nav visible');
  });

  for (const path of ['/pos', '/orders', '/tables']) {
    await check(`mobile: no horizontal scroll on ${path}`, async () => {
      await m.goto(`${BASE}${path}`);
      await m.waitForTimeout(800);
      return noHScroll(m, path);
    });
  }

  await check('mobile: touch targets >= 44px on POS', async () => {
    await m.goto(`${BASE}/pos`);
    await m.locator('button.product').first().waitFor();
    await minTouch(m, '.pos-cats button, button.product, .pos-sticky, .bottom-nav a, .bottom-nav button');
  });

  await check('mobile: takeaway billing via sticky cart', async () => {
    await m.locator('.pos-bar .seg button', { hasText: 'Takeaway' }).tap();
    await m.locator('.search input').fill('burger');
    await m.locator('button.product', { hasText: 'E2E Burger' }).tap();
    await m.locator('.search input').fill('');
    await m.locator('button.product', { hasText: 'E2E Tea' }).tap();
    await m.screenshot({ path: `${OUT}/mobile-pos.png` });
    const sticky = await m.locator('.pos-sticky').innerText();
    if (!sticky.includes('2 items')) throw new Error(`sticky: ${sticky}`);
    await m.locator('.pos-sticky').tap();
    await m.locator('.pos-cart.open').waitFor();
    await m.locator('.cart-line', { hasText: 'E2E Tea' }).getByRole('button', { name: 'Increase' }).tap();
    expectEq(money(await m.locator('.pos-cart .totals .grand span').last().innerText()), 168, 'mobile total');
    await m.screenshot({ path: `${OUT}/mobile-cart.png` });
    await noHScroll(m, 'cart');
    await m.getByRole('button', { name: /^Pay / }).tap();
    await m.locator('.modal').getByRole('button', { name: 'UPI', exact: true }).tap();
    await m.locator('.modal input[placeholder^=Reference]').fill('UTR998877');
    await m.screenshot({ path: `${OUT}/mobile-payment.png` });
    await m.locator('.modal').getByRole('button', { name: /Confirm/ }).tap();
    await m.getByText('Saved · SNG-00004').waitFor();
    await m.screenshot({ path: `${OUT}/mobile-receipt.png` });
    await noHScroll(m, 'receipt modal');
    await m.locator('.modal').getByRole('button', { name: 'Close' }).tap();
  });

  await check('cross-device sync: phone bill appears on desktop instantly', async () => {
    await page.goto(`${BASE}/orders`);
    await page.getByRole('button', { name: 'Completed', exact: true }).click();
    await page.locator('tr', { hasText: 'SNG-00004' }).waitFor({ timeout: 5000 });
  });

  await check('cross-device sync: desktop price change reaches phone', async () => {
    await page.goto(`${BASE}/menu`);
    const row = page.locator('tr', { hasText: 'E2E Burger' });
    await row.locator('input[type=number]').fill('130');
    await page.getByRole('button', { name: 'Save prices' }).click();
    await page.getByText(/Updated 1 price/).waitFor();
    await m.locator('button.product', { hasText: 'E2E Burger' }).locator('text=₹130').waitFor({ timeout: 5000 });
  });

  await check('historical bill keeps old price after price change', async () => {
    await page.goto(`${BASE}/orders`);
    await page.getByRole('button', { name: 'Completed', exact: true }).click();
    await page.locator('tr', { hasText: 'SNG-00004' }).click();
    await page.locator('.modal td', { hasText: '₹120.00' }).first().waitFor();
    await page.locator('.modal').getByRole('button', { name: 'Close' }).click();
  });

  await check('offline: billing disabled, clear error shown', async () => {
    await m.locator('button.product', { hasText: 'E2E Tea' }).tap();
    await phone.setOffline(true);
    await m.locator('.conn.offline').waitFor({ timeout: 5000 });
    await m.locator('.offline-banner').waitFor();
    await m.locator('.pos-sticky').tap();
    const pay = m.getByRole('button', { name: /^Pay / });
    if (!(await pay.isDisabled())) throw new Error('Pay enabled while offline');
    if (!(await m.getByRole('button', { name: 'Save order' }).isDisabled())) throw new Error('Save enabled while offline');
    await m.screenshot({ path: `${OUT}/mobile-offline.png` });
  });

  await check('offline: billing resumes only after verified reconnection', async () => {
    await phone.setOffline(false);
    await m.locator('.conn.online').waitFor({ timeout: 20000 });
    const pay = m.getByRole('button', { name: /^Pay / });
    if (await pay.isDisabled()) throw new Error('Pay still disabled');
    await pay.tap();
    await m.locator('.modal').getByRole('button', { name: 'Cash', exact: true }).tap();
    await m.locator('.modal').getByRole('button', { name: /Confirm/ }).tap();
    await m.getByText('Saved · SNG-00005').waitFor({ timeout: 15000 });
    await m.locator('.modal').getByRole('button', { name: 'Close' }).tap();
  });

  // ================= ANDROID TABLET (admin) =================
  const tab = await browser.newContext({ viewport: { width: 800, height: 1280 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const t = await tab.newPage();
  t.on('pageerror', (e) => fail('no JS errors (tablet)', e.message));
  await t.goto(`${BASE}/`);
  await check('tablet: admin login and pages fit', async () => {
    await t.locator('#email').fill('owner@sng.test');
    await t.locator('#pw').fill('ownerpass1');
    await t.getByRole('button', { name: 'Sign in' }).tap();
    await t.locator('.bottom-nav').waitFor();
    const widths = [];
    for (const p of ['/pos', '/orders', '/dashboard', '/reports', '/menu', '/settings', '/expenses', '/staff']) {
      await t.goto(`${BASE}${p}`);
      await t.waitForTimeout(900);
      widths.push(await noHScroll(t, p));
    }
    await t.goto(`${BASE}/pos`);
    await t.waitForTimeout(800);
    await t.screenshot({ path: `${OUT}/tablet-pos.png` });
    return `${widths.length} pages`;
  });

  for (const p of ['/dashboard', '/reports', '/menu', '/settings', '/expenses']) {
    await check(`phone: no horizontal scroll on ${p} (admin)`, async () => {
      const pc = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, storageState: await tab.storageState({ indexedDB: true }) });
      const pp = await pc.newPage();
      await pp.goto(`${BASE}${p}`);
      await pp.waitForTimeout(1500);
      const r = await noHScroll(pp, p);
      if (p === '/dashboard') await pp.screenshot({ path: `${OUT}/mobile-dashboard.png`, fullPage: true });
      await pc.close();
      return r;
    });
  }
} finally {
  await browser.close();
  vite.kill();
  writeFileSync(`${OUT}/e2e-results.json`, JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
