// Rechnungsnummern-Format, z. B. "FL-{YYYY}-{####}" → "FL-2026-0001".
// Enthält das Format ein Jahr, läuft der Zähler pro Jahr; sonst durchgehend (Schlüssel 0).

const SEQ_RE = /\{(#+)\}/;

export function validateNumberFormat(format: string): string | null {
  const seqs = format.match(/\{#+\}/g) ?? [];
  if (seqs.length !== 1) return 'Das Format muss genau einen Zähler-Platzhalter wie {####} enthalten.';
  const unknown = format.replace(/\{(YYYY|YY|MM|#+)\}/g, '').match(/\{[^}]*\}/);
  if (unknown) return `Unbekannter Platzhalter ${unknown[0]}. Erlaubt: {YYYY}, {YY}, {MM}, {####}.`;
  return null;
}

/** Zählerschlüssel: Jahr, wenn das Format ein Jahr enthält; sonst 0 (durchgehend). */
export function counterKey(format: string, year: number): number {
  return /\{YYYY\}|\{YY\}/.test(format) ? year : 0;
}

export function formatInvoiceNumber(format: string, year: number, seq: number, month = 1): string {
  return format
    .replace('{YYYY}', String(year))
    .replace('{YY}', String(year).slice(-2))
    .replace('{MM}', String(month).padStart(2, '0'))
    .replace(SEQ_RE, (_m, hashes: string) => String(seq).padStart(hashes.length, '0'));
}
