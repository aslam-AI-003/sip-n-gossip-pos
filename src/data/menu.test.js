import { describe, it, expect } from 'vitest';
import { MENU } from './menu.js';

const REQUIRED = [
  'Special Veg Combos', 'Special Non-Veg Combos', 'Juice Combos', 'Milkshake Combos', 'Bread Omelette Specials',
  'Pasta Specials', 'Sandwich', 'Club Sandwich', 'Maggi', 'Signature Loaded Fries', 'Crispy Snacks', 'Momos',
  'Sweet Corn', 'Burger', 'Wraps', 'Milkshakes', 'Avil Milk Specials', "SIP N' GOSSIP Special Shakes", 'Falooda',
  'Ice Cream Scoop', 'Fresh Juice', 'Mojito', 'Lemon Juice', 'Soda', 'Lassi', 'Flavoured & Infused Tea',
  'Herbal Tea', 'Hot Beverages', 'Bun & Spreads', 'Add-ons & Extras',
];

// Item counts per category as printed in the PDF.
const COUNTS = {
  'Special Veg Combos': 5, 'Special Non-Veg Combos': 5, 'Juice Combos': 12, 'Milkshake Combos': 9,
  'Bread Omelette Specials': 9, 'Pasta Specials': 8, Sandwich: 13, 'Club Sandwich': 5, Maggi: 9,
  'Signature Loaded Fries': 10, 'Crispy Snacks': 9, Momos: 5, 'Sweet Corn': 4, Burger: 8, Wraps: 11,
  Milkshakes: 39, 'Avil Milk Specials': 9, "SIP N' GOSSIP Special Shakes": 5, Falooda: 11, 'Ice Cream Scoop': 9,
  'Fresh Juice': 26, Mojito: 9, 'Lemon Juice': 10, Soda: 5, Lassi: 12, 'Flavoured & Infused Tea': 20,
  'Herbal Tea': 3, 'Hot Beverages': 11, 'Bun & Spreads': 3, 'Add-ons & Extras': 2,
};

describe('menu seed', () => {
  it('has exactly the 30 required categories in order', () => {
    expect(MENU.map((c) => c.category)).toEqual(REQUIRED);
  });

  it('matches the PDF item counts', () => {
    for (const c of MENU) expect([c.category, c.items.length]).toEqual([c.category, COUNTS[c.category]]);
  });

  it('has numeric positive prices and no duplicate items within a category', () => {
    for (const c of MENU) {
      const names = new Set();
      for (const it of c.items) {
        expect(typeof it.price).toBe('number');
        expect(it.price).toBeGreaterThan(0);
        expect(Number.isInteger(it.price)).toBe(true);
        const k = it.name.toLowerCase();
        expect(names.has(k), `${c.category}: ${it.name}`).toBe(false);
        names.add(k);
      }
    }
  });

  it('keeps combo descriptions', () => {
    for (const c of MENU.slice(0, 2)) for (const it of c.items) expect(it.description).toMatch(/\+/);
  });

  it('spot-checks prices from the PDF', () => {
    const find = (cat, name) => MENU.find((c) => c.category === cat).items.find((i) => i.name === name).price;
    expect(find("Special Non-Veg Combos", "SIP N' GOSSIP Special Combo")).toBe(209);
    expect(find('Milkshake Combos', 'Fig + Dry Fruits')).toBe(100);
    expect(find('Sandwich', 'Crispy Chicken Cheese Sandwich')).toBe(120);
    expect(find('Crispy Snacks', 'Crab Lollipop (5 pcs)')).toBe(160);
    expect(find('Milkshakes', 'Avacoda Tender')).toBe(100);
    expect(find("SIP N' GOSSIP Special Shakes", 'Milo Shake')).toBe(69);
    expect(find('Hot Beverages', 'Tea')).toBe(15);
    expect(find('Add-ons & Extras', 'Cheese Extra')).toBe(10);
  });
});
