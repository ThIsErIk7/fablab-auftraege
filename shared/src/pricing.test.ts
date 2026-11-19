import { describe, expect, it } from 'vitest';
import { computeTotals, itemTotal, priceForPart } from './pricing.ts';
import { formatCents, formatMills, millsToEuroInput, parseEuroToCents, parseEuroToMills, parseLocaleNumber, roundHalfAwayFromZero } from './money.ts';

const part = { id: 1, name: 'Gehäuse', quantity: 2, actualMinutes: 90, estMinutes: 120, materialAmount: 85, materialText: null };
const bambu = { name: 'Bambu H2D', hourlyRateCents: 800, jobFlatCents: 300 };
const petg = { name: 'PETG', unit: 'g' as const, priceMills: 40 }; // 0,040 €/g

describe('Geld', () => {
  it('rundet kaufmännisch und symmetrisch', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(1.005 * 100)).toBe(101);
  });
  it('liest deutsche und englische Zahlen', () => {
    expect(parseLocaleNumber('1.234,56')).toBe(1234.56);
    expect(parseLocaleNumber('1,234.56')).toBe(1234.56);
    expect(parseLocaleNumber('1,5')).toBe(1.5);
    expect(parseLocaleNumber('abc')).toBeNull();
    expect(parseEuroToCents('12,34 €')).toBe(1234);
    expect(parseEuroToMills('0,035')).toBe(35);
    expect(millsToEuroInput(35)).toBe('0,035');
    expect(millsToEuroInput(2000)).toBe('2,00');
    expect(formatMills(35)).toMatch(/0,035\s€/);
  });
  it('formatiert Euro deutsch', () => {
    expect(formatCents(123456)).toMatch(/1\.234,56\s€/);
  });
});

describe('Preisberechnung', () => {
  it('berechnet Maschinenzeit, Pauschale und Material', () => {
    const { items, warnings } = priceForPart(part, bambu, petg);
    expect(items.map((i) => i.totalCents)).toEqual([1200, 300, 340]); // 1,5 h × 8 €; 3 €; 85 g × 0,04 €
    expect(items[0]).toMatchObject({ quantity: 1.5, unit: 'h' });
    expect(items[2]).toMatchObject({ quantity: 85, unit: 'g', unitPriceMills: 40 });
    expect(items[0].unitPriceMills).toBe(8000);
    expect(warnings).toEqual([]);
  });
  it('nutzt geschätzte Zeit mit Warnung, wenn keine tatsächliche vorliegt', () => {
    const { items, warnings } = priceForPart({ ...part, actualMinutes: null }, bambu, petg);
    expect(items[0].totalCents).toBe(1600);
    expect(warnings[0]).toMatch(/geschätzte/);
  });
  it('wendet den Kundentyp-Rabatt pro Position an', () => {
    const { items } = priceForPart(part, bambu, petg, 2000); // 20 %
    expect(items.map((i) => i.totalCents)).toEqual([960, 240, 272]);
  });
  it('rundet Stunden auf 2 Stellen und rechnet mit der gedruckten Menge', () => {
    const { items } = priceForPart({ ...part, actualMinutes: 50 }, bambu, null);
    expect(items[0].quantity).toBe(0.83);
    expect(items[0].totalCents).toBe(664); // 0,83 × 8,00 € – nicht 666
  });
  it('legt eine 0-€-Position an, wenn nichts berechenbar ist', () => {
    const { items, warnings } = priceForPart({ ...part, materialText: 'Eigenes Holz' }, null, null);
    expect(items).toHaveLength(1);
    expect(items[0].totalCents).toBe(0);
    expect(warnings.join(' ')).toMatch(/keine Maschine/);
  });
  it('Material pro m² / Stück', () => {
    const { items } = priceForPart({ ...part, materialAmount: 0.25 }, null, { name: 'Acryl 3 mm', unit: 'm2', priceMills: 60000 });
    expect(items[0]).toMatchObject({ unit: 'm²', quantity: 0.25, totalCents: 1500 });
  });
  it('Preis pro Gramm mit Zehntelcent-Genauigkeit (0,035 €/g)', () => {
    const { items } = priceForPart({ ...part, materialAmount: 96 }, null, { name: 'PETG', unit: 'g', priceMills: 35 });
    expect(items[0]).toMatchObject({ quantity: 96, unit: 'g', totalCents: 336 });
    const r = priceForPart({ ...part, materialAmount: 12.34 }, null, { name: 'PLA', unit: 'g', priceMills: 25 });
    expect(r.items[0]).toMatchObject({ quantity: 12.3, totalCents: 31 }); // 12,3 g × 0,025 € = 0,3075 €
  });
  it('Resin pro Milliliter (SLA)', () => {
    const { items } = priceForPart({ ...part, materialAmount: 48.5 }, null, { name: 'Resin', unit: 'ml', priceMills: 150 });
    expect(items[0]).toMatchObject({ quantity: 48.5, unit: 'ml', totalCents: 728 }); // 7,275 € → 7,28 €
  });
  it('Summen: Steuer auf Netto-Summe', () => {
    const t = computeTotals([{ totalCents: 1001 }, { totalCents: 1001 }], 1900);
    expect(t).toEqual({ netCents: 2002, taxCents: 380, grossCents: 2382 });
    expect(computeTotals([{ totalCents: 1000 }], 0)).toEqual({ netCents: 1000, taxCents: 0, grossCents: 1000 });
    expect(computeTotals([{ totalCents: -1001 }], 1900)).toEqual({ netCents: -1001, taxCents: -190, grossCents: -1191 });
  });
  it('itemTotal mit Rabatt', () => {
    expect(itemTotal(3, 3330, 1000)).toBe(899);
  });
});
