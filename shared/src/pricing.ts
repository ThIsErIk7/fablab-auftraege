import { centsToMills, roundHalfAwayFromZero, roundTo } from './money.ts';
import type { InvoiceItem, Machine, Material, Part } from './types.ts';
import { MATERIAL_UNIT_LABELS } from './types.ts';

/** Position ohne DB-Felder, wie sie die Preisberechnung vorschlägt. */
export type DraftItem = Omit<InvoiceItem, 'id' | 'invoiceId' | 'sort'>;

export interface PartPricingResult {
  items: DraftItem[];
  warnings: string[];
}

/**
 * Gesamtbetrag einer Position in Cent: Menge × Einzelpreis (Zehntelcent), abzüglich Positionsrabatt.
 * Gerundet wird genau einmal, auf ganze Cent.
 */
export function itemTotal(quantity: number, unitPriceMills: number, discountBp = 0): number {
  return roundHalfAwayFromZero((quantity * unitPriceMills * (10000 - discountBp)) / 100000);
}

/**
 * Preis-Positionen für ein Teil:
 *  - Maschinenzeit: tatsächliche Minuten (sonst geschätzte) × Stundensatz
 *  - Pauschale pro Job: einmal pro Teil-Zeile (ein Job, egal wie viele Stück)
 *  - Material: Verbrauch × Materialpreis pro Einheit (€/g, €/ml, €/m², …)
 * Der Kundentyp-Rabatt wird als Positionsrabatt eingetragen.
 */
export function priceForPart(
  part: Pick<Part, 'id' | 'name' | 'quantity' | 'actualMinutes' | 'estMinutes' | 'materialAmount' | 'materialText'>,
  machine: Pick<Machine, 'name' | 'hourlyRateCents' | 'jobFlatCents'> | null,
  material: Pick<Material, 'name' | 'unit' | 'priceMills'> | null,
  discountBp = 0,
): PartPricingResult {
  const items: DraftItem[] = [];
  const warnings: string[] = [];
  const label = part.quantity > 1 ? `${part.name} (${part.quantity} Stk.)` : part.name;
  const mk = (description: string, quantity: number, unit: string, unitPriceMills: number): DraftItem => ({
    partId: part.id,
    description,
    quantity,
    unit,
    unitPriceMills,
    discountBp,
    totalCents: itemTotal(quantity, unitPriceMills, discountBp),
  });

  if (machine) {
    const minutes = part.actualMinutes ?? part.estMinutes;
    if (machine.hourlyRateCents > 0) {
      if (minutes == null) {
        warnings.push(`„${part.name}“: keine Maschinenzeit eingetragen.`);
      } else {
        if (part.actualMinutes == null) warnings.push(`„${part.name}“: geschätzte statt tatsächlicher Maschinenzeit verwendet.`);
        const hours = roundTo(minutes / 60, 2);
        items.push(mk(`${label} – Maschinenzeit ${machine.name}`, hours, 'h', centsToMills(machine.hourlyRateCents)));
      }
    }
    if (machine.jobFlatCents > 0) {
      items.push(mk(`${label} – Pauschale ${machine.name}`, 1, 'Job', centsToMills(machine.jobFlatCents)));
    }
  } else {
    warnings.push(`„${part.name}“: keine Maschine zugeordnet.`);
  }

  if (material) {
    if (part.materialAmount == null) {
      warnings.push(`„${part.name}“: kein Materialverbrauch eingetragen.`);
    } else if (material.unit === 'g' || material.unit === 'ml') {
      // Gramm/Milliliter: auf 0,1 genau abrechnen
      const qty = roundTo(part.materialAmount, 1);
      items.push(mk(`${label} – Material ${material.name}`, qty, MATERIAL_UNIT_LABELS[material.unit], material.priceMills));
    } else {
      const qty = roundTo(part.materialAmount, 3);
      items.push(mk(`${label} – Material ${material.name}`, qty, MATERIAL_UNIT_LABELS[material.unit], material.priceMills));
    }
  } else if (part.materialText) {
    warnings.push(`„${part.name}“: Material „${part.materialText}“ hat keinen hinterlegten Preis.`);
  }

  if (items.length === 0) {
    items.push(mk(label, part.quantity, 'Stk.', 0));
    warnings.push(`„${part.name}“: kein Preis berechenbar – bitte Position manuell anpassen.`);
  }
  return { items, warnings };
}

export interface Totals {
  netCents: number;
  taxCents: number;
  grossCents: number;
}

/** Steuer wird auf die Netto-Summe gerechnet (nicht pro Position). */
export function computeTotals(items: Pick<InvoiceItem, 'totalCents'>[], taxRateBp: number): Totals {
  const netCents = items.reduce((s, i) => s + i.totalCents, 0);
  const taxCents = roundHalfAwayFromZero((netCents * taxRateBp) / 10000);
  return { netCents, taxCents, grossCents: netCents + taxCents };
}
