import type { InvoiceSettings } from '@fablab/shared';
import type { DB } from '../db/connection.ts';

/** Neutrale Platzhalter – die echten Werte werden in der App unter Einstellungen gepflegt. */
export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = {
  name: 'Bitte in den Einstellungen eintragen',
  address: 'Straße Nr.\nPLZ Ort',
  email: null,
  phone: null,
  website: null,
  taxNumber: null,
  vatId: null,
  bankName: null,
  iban: null,
  bic: null,
  accountHolder: null,
  footer: null,
  logoDataUrl: null,
  paymentTermDays: 14,
  numberFormat: 'FL-{YYYY}-{####}',
  taxRateBp: 1900,
  taxExemptNote: '',
  autoDraftOnFinish: false,
  introText: 'Vielen Dank für Ihren Auftrag. Wir berechnen Ihnen folgende Leistungen:',
};

export function getInvoiceSettings(db: DB): InvoiceSettings {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'invoice'").get() as { value: string } | undefined;
  return { ...DEFAULT_INVOICE_SETTINGS, ...(row ? JSON.parse(row.value) : {}) };
}

export function saveInvoiceSettings(db: DB, s: InvoiceSettings): InvoiceSettings {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('invoice', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify(s));
  return getInvoiceSettings(db);
}
