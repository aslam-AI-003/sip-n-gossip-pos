# SIP N' GOSSIP CAFE POS

*Fresh Sips, Happy Vibes!*

An online-only restaurant POS and billing app with dine-in, takeaway and parcel orders, split payments, 80mm thermal receipts, a dashboard, reports and expenses. It has no stock or inventory features by design.

It is a standalone project. It shares no code, database or configuration with the `Couple_friendly_restaurant` app.

**Stack:** React 18 + Vite, Firebase Authentication, Cloud Firestore, Recharts, jsPDF. Deployed as a static site on Vercel. No server code or Admin SDK credentials are needed.

---

## 1. Create the Firebase project (new, separate)

1. Go to https://console.firebase.google.com → **Add project** → name it e.g. `sip-n-gossip-pos`. Analytics is optional.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
3. **Build → Firestore Database → Create database**. Choose **production mode** and a region close to the cafe, e.g. `asia-south1` (Mumbai).
4. **Project settings → Your apps → Web (</>)**. Register the app and copy the config values.
5. Under **Authentication → Settings → Authorized domains**, add your Vercel domain (e.g. `sng-pos.vercel.app`) and any custom domain.

### Deploy the security rules (required)

```bash
npm install
npx firebase login
npx firebase use --add          # pick the new project
npx firebase deploy --only firestore:rules,firestore:indexes
```

The rules in `firestore.rules` enforce roles, block deletes of bills, make the payment ledger append-only, and allow refunds only for admins. All queries use single-field indexes, so no composite indexes are needed.

## 2. Environment variables

Copy `.env.example` to `.env` for local use. On Vercel, add the same keys under **Project → Settings → Environment Variables** for Production and Preview:

| Variable | Value |
|---|---|
| `VITE_FIREBASE_API_KEY` | from the web app config |
| `VITE_FIREBASE_AUTH_DOMAIN` | `<project>.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | project id |
| `VITE_FIREBASE_STORAGE_BUCKET` | from config |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | from config |
| `VITE_FIREBASE_APP_ID` | from config |

These are public web identifiers, not secrets. Access control comes from the security rules.

## 3. Deploy to Vercel

1. Push this folder to a **new** GitHub repository, e.g. `sip-n-gossip-pos`.
2. In Vercel, choose **Add New → Project** and import that repository. The framework is auto-detected as Vite, and `vercel.json` sets the build command and SPA rewrites.
3. Add the environment variables and deploy.

Local development:

```bash
npm install
npm run dev
```

## 4. First run

1. Open the deployed site. The **First-time setup** screen appears once. Create the owner account, which becomes the admin, and choose the number of tables.
2. Go to **Settings**. Enter the address, phone and GSTIN. Turn GST on and enter the rate only if it applies to you; GST is off by default. Set the invoice prefix and the parcel charge. The default parcel charge is ₹5 per item, from "Parcel Extra – ₹5".
3. Go to **Menu → Import → Load built-in menu**. This creates the 30 categories and the add-ons. Then add the menu items (see "Menu status" below).
4. Go to **Staff → Add staff** to create cashier logins.

## 5. Roles

| | Admin | Cashier |
|---|---|---|
| Billing, orders, tables, payments, print/reprint | ✓ | ✓ |
| Collect pending balances | ✓ | ✓ |
| Discounts | ✓ | if enabled in Settings |
| Cancel unpaid active orders | ✓ | if enabled in Settings |
| Refunds | ✓ | ✗ |
| Dashboard, reports, expenses, menu, staff, settings | ✓ | ✗ |

The database rules enforce these permissions, not just the UI. Disabling a staff member blocks their access right away.

## 6. 80mm thermal printer setup

The receipt page is sized to exactly **80mm × receipt length**, so the printer feeds only the paper the receipt needs: no A4 page and no blank trailing page.

**Desktop (Windows/macOS/Linux, Chrome):**

1. Install the printer's driver and add the printer in the OS. Set paper size to 80mm (often "80 x 297mm" or "Receipt").
2. Click **Print** on a bill. In Chrome's dialog, pick the thermal printer, set **Margins: None**, **Scale: Default/100%**, and turn **Headers and footers** off. Chrome remembers these settings.
3. Use **Settings → Print test receipt** to check alignment. If the right edge is cut off, lower **Printable width** from 72mm to 64–70mm. Use 58mm paper width for 58mm printers.
4. Optional: launch Chrome with `--kiosk-printing` to skip the dialog and always print to the default printer.

**Android (phone/tablet, Chrome):**

- **Print:** Chrome opens the Android print service. Install a print service for your printer: the vendor's plugin, or a generic one such as *RawBT* for Bluetooth/USB ESC/POS printers. Then choose it in the print dialog.
- **Share PDF:** sends an 80mm PDF to a printer app or WhatsApp through the Android share sheet.
- **PDF:** downloads the 80mm receipt PDF. PDFs show "Rs." instead of "₹" because the PDF library's built-in font has no rupee glyph. Printed receipts show ₹.

The app does not use direct Bluetooth/USB (Web Bluetooth/WebUSB ESC/POS) printing. Browser support for it is limited and it has not been tested on hardware. The browser print dialog is the supported path.

## 7. Online-only behaviour

- A connection indicator (top right) checks the Firestore server every 20s, plus on reconnect and when the tab becomes visible.
- While offline, a red banner appears, and **Save order**, **Pay**, payments, refunds and expenses are disabled.
- All bill and payment writes use Firestore **transactions**. These succeed only when the server confirms them, and they fail rather than queue when offline. The app shows a bill as saved only after the server confirms it.
- Duplicate protection: each cart has a fixed order ID and each payment row a fixed payment ID. A retried click returns the existing bill and never creates a second one.
- Bill and order numbers come from transactional counters, so each number is unique and in sequence.
- If another device changes an active order at the same time, the save is rejected with a "Reload" prompt instead of overwriting the other device's changes.

## 8. Data model (Firestore)

| Collection | Purpose |
|---|---|
| `users/{uid}` | name, email, role (`admin`/`cashier`), active |
| `settings/app` | restaurant details, GST, parcel charge, printer, permissions, expense categories |
| `categories`, `products` | menu: price (number), available, active, isAddon, description, image |
| `tables` | table name, `activeOrderId` (occupancy) |
| `orders` | items with **price snapshot**, totals, discount, payments, refunds, status, paymentStatus, bill/order numbers |
| `payments` | append-only ledger of payments and refunds (used for collection reports) |
| `expenses` | name, category, amount, date, payment method, description |
| `counters` | `orders`, `invoice` sequence numbers |
| `meta/setup` | marks first-run setup as complete |

There are no stock or inventory collections. Price changes only affect future orders, because each bill stores the price at the time of sale.

## 9. Calculations

- Subtotal = Σ price × qty. All internal math uses integer paise.
- Discount = % or flat amount, capped at the subtotal.
- Parcel charge applies **only to Parcel orders**, per item quantity (add-ons excluded) or once per order.
- GST = rate × (subtotal − discount + parcel), shown as CGST + SGST at half the rate each.
- Optional rounding to the nearest ₹1, shown as "Round off".
- Reports: revenue = completed bills. Collections = the payment ledger in the period. Estimated profit = revenue − GST − refunds − expenses.

## 10. Tests

```bash
npm test               # unit tests: billing math, report aggregation
npm run test:emulator  # Firestore rules + real order/payment transactions on the emulator (needs Java 11+)
npm run test:e2e       # full browser test on desktop / Android phone / tablet sizes (needs Chrome at /usr/bin/google-chrome)
```

Screenshots, the captured print output (`print-output.pdf/.png`) and exported reports are written to `test-output/`.

## Menu status

`src/data/menu.js` contains the 30 categories and the add-ons **Cheese Extra ₹10** and **Extra Mayonnaise ₹10**. The menu PDF has not been entered yet. Add the items in one of these ways:

- Fill in `src/data/menu.js` and use **Menu → Import → Load built-in menu**. Existing items are never overwritten.
- Use **Menu → Import → Paste CSV** with `Category,Item,Price,Description`.
- Use **Menu → Add item**.
