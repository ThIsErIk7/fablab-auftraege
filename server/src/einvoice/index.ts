// VORBEREITUNG E-Rechnung (ZUGFeRD / XRechnung) – noch nicht aktiv.
//
// Idee: Eine gestellte Rechnung wird in ein neutrales Modell nach EN 16931 überführt.
// Daraus lassen sich später erzeugen:
//   - XRechnung (UBL- oder CII-XML), z. B. für öffentliche Auftraggeber (Hochschulen!)
//   - ZUGFeRD/Factur-X: PDF/A-3 mit eingebettetem CII-XML
//
// Alle benötigten Daten liegen bereits vor: eingefrorener Absender (sender_json),
// Empfänger (recipient_json), Positionen mit Menge/Einheit/Preis, Steuersatz und Summen in Cent.
// Fehlende Felder für XRechnung: Leitweg-ID des Empfängers (Buyer Reference) und
// ggf. E-Mail-Adressen beider Seiten – diese wären als zusätzliche Auftrags-/Einstellungsfelder zu ergänzen.

import type { InvoiceDetail } from '@fablab/shared';

export interface En16931Invoice {
  number: string;                 // BT-1
  issueDate: string;              // BT-2
  typeCode: '380' | '381';        // BT-3: 380 Rechnung, 381 Gutschrift/Storno
  currency: 'EUR';                // BT-5
  dueDate: string | null;         // BT-9
  buyerReference: string | null;  // BT-10 (Leitweg-ID bei XRechnung)
  precedingInvoice: string | null;// BT-25 (bei Storno)
  periodStart: string | null;     // BT-73
  periodEnd: string | null;       // BT-74
  seller: { name: string; address: string; vatId: string | null; taxNumber: string | null; iban: string | null; bic: string | null };
  buyer: { name: string; address: string; vatId: string | null };
  lines: { id: string; name: string; quantity: number; unitCode: string; netPriceMills: number; lineTotalCents: number; vatRateBp: number }[];
  totals: { netCents: number; taxCents: number; grossCents: number; taxRateBp: number; exemptionReason: string | null };
}

/** UN/ECE Rec. 20 Einheitencodes für die in der App verwendeten Einheiten. */
const UNIT_CODES: Record<string, string> = { h: 'HUR', g: 'GRM', ml: 'MLT', kg: 'KGM', 'm²': 'MTK', 'Stk.': 'H87', Stück: 'H87', Job: 'C62', Platte: 'C62', 'pausch.': 'LS' };

export function toEn16931(inv: InvoiceDetail): En16931Invoice {
  if (!inv.number || !inv.sender || !inv.invoiceDate) throw new Error('Nur gestellte Rechnungen können als E-Rechnung exportiert werden.');
  return {
    number: inv.number,
    issueDate: inv.invoiceDate,
    typeCode: inv.type === 'storno' ? '381' : '380',
    currency: 'EUR',
    dueDate: inv.dueDate,
    buyerReference: null,
    precedingInvoice: inv.cancelsNumber,
    periodStart: inv.serviceFrom,
    periodEnd: inv.serviceTo,
    seller: { name: inv.sender.name, address: inv.sender.address, vatId: inv.sender.vatId, taxNumber: inv.sender.taxNumber, iban: inv.sender.iban, bic: inv.sender.bic },
    buyer: { name: inv.recipient.name, address: inv.recipient.address, vatId: inv.recipient.vatId ?? null },
    lines: inv.items.map((it, i) => ({
      id: String(i + 1), name: it.description, quantity: it.quantity, unitCode: UNIT_CODES[it.unit] ?? 'C62',
      netPriceMills: it.unitPriceMills, lineTotalCents: it.totalCents, vatRateBp: inv.taxRateBp,
    })),
    totals: { netCents: inv.netCents, taxCents: inv.taxCents, grossCents: inv.grossCents, taxRateBp: inv.taxRateBp, exemptionReason: inv.taxRateBp === 0 ? inv.taxExemptNote : null },
  };
}

// TODO (Ausbaustufe): renderXRechnungCii(model): string  und  embedZugferd(pdf, xml): Buffer (PDF/A-3)
