// SIP N' GOSSIP CAFE menu seed.
//
// SOURCE: the owner's 8-page menu PDF. Only enter names and prices exactly as
// printed. Do NOT guess. Anything unclear goes into `needsVerification` below.
//
// STATUS: the PDF was not available when this file was written, so only the
// category structure (as supplied by the owner) and the add-on prices the
// owner stated in writing are filled in. Every other category is empty and
// must be filled from the PDF (here, or via Menu > Import CSV in the app).
//
// "Parcel Extra – ₹5" is implemented as the configurable parcel charge in
// Settings (applied only to Parcel orders), not as a menu item, so it can
// never be charged twice.

export const MENU_SOURCE_COMPLETE = false;

export const MENU = [
  // Page 1
  { category: 'Special Veg Combos', page: 1, items: [] },
  { category: 'Special Non-Veg Combos', page: 1, items: [] },
  // Page 2
  { category: 'Juice Combos', page: 2, items: [] },
  { category: 'Milkshake Combos', page: 2, items: [] },
  // Page 3
  { category: 'Bread Omelette Specials', page: 3, items: [] },
  { category: 'Pasta Specials', page: 3, items: [] },
  { category: 'Sandwich', page: 3, items: [] },
  { category: 'Club Sandwich', page: 3, items: [] },
  // Page 4 (Maggi page not specified by owner; placed with page 4 snacks - verify)
  { category: 'Maggi', page: 4, items: [] },
  { category: 'Signature Loaded Fries', page: 4, items: [] },
  { category: 'Crispy Snacks', page: 4, items: [] },
  { category: 'Momos', page: 4, items: [] },
  { category: 'Sweet Corn', page: 4, items: [] },
  { category: 'Burger', page: 4, items: [] },
  { category: 'Wraps', page: 4, items: [] },
  // Page 5
  { category: 'Milkshakes', page: 5, items: [] },
  { category: 'Avil Milk Specials', page: 5, items: [] },
  { category: "SIP N' GOSSIP Special Shakes", page: 5, items: [] },
  { category: 'Falooda', page: 5, items: [] },
  { category: 'Ice Cream Scoop', page: 5, items: [] },
  // Page 6
  { category: 'Fresh Juice', page: 6, items: [] },
  { category: 'Mojito', page: 6, items: [] },
  { category: 'Lemon Juice', page: 6, items: [] },
  { category: 'Soda', page: 6, items: [] },
  { category: 'Lassi', page: 6, items: [] },
  // Page 7
  { category: 'Flavoured & Infused Tea', page: 7, items: [] },
  { category: 'Herbal Tea', page: 7, items: [] },
  { category: 'Hot Beverages', page: 7, items: [] },
  { category: 'Bun & Spreads', page: 7, items: [] },
  // Page 8
  {
    category: 'Add-ons & Extras',
    page: 8,
    isAddon: true,
    items: [
      { name: 'Cheese Extra', price: 10 },
      { name: 'Extra Mayonnaise', price: 10 },
    ],
  },
];

// Items that could not be read with certainty from the PDF.
export const needsVerification = [];
