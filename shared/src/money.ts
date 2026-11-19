// Geldbeträge sind überall ganzzahlige Cent. Nur hier wird gerundet/formatiert.

/** Kaufmännische Rundung (halbe Cent weg von 0), symmetrisch für negative Beträge (Storno). */
export function roundHalfAwayFromZero(x: number): number {
  // Kleine Korrektur gegen Gleitkomma-Artefakte wie 2.675 → 2.67499999
  const eps = 1e-9;
  return x >= 0 ? Math.floor(x + 0.5 + eps) : -Math.floor(-x + 0.5 + eps);
}

/** Rundet auf n Nachkommastellen (für Mengen wie Stunden oder kg). */
export function roundTo(x: number, decimals: number): number {
  const f = 10 ** decimals;
  return roundHalfAwayFromZero(x * f) / f;
}

const eurFormatter = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

export function formatCents(cents: number): string {
  return eurFormatter.format(cents / 100);
}

/** "12,5" / "12.50" / "1.234,56 €" → Cent. Gibt null bei ungültiger Eingabe. */
export function parseEuroToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number') return Number.isFinite(input) ? roundHalfAwayFromZero(input * 100) : null;
  const n = parseLocaleNumber(input.replace(/€|EUR/gi, ''));
  return n === null ? null : roundHalfAwayFromZero(n * 100);
}

// Einzelpreise (Material €/g, Rechnungspositionen) in Zehntelcent = 1/1000 € ("Mills"),
// damit z. B. 0,035 €/g exakt als Ganzzahl gespeichert werden kann.
export const MILLS_PER_CENT = 10;
export const centsToMills = (cents: number) => cents * MILLS_PER_CENT;

const millsFormatter = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 3 });
/** 35 → "0,035 €", 2000 → "2,00 €" */
export function formatMills(mills: number): string {
  return millsFormatter.format(mills / 1000);
}

export function parseEuroToMills(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  const n = typeof input === 'number' ? input : parseLocaleNumber(input.replace(/€|EUR/gi, ''));
  return n === null || !Number.isFinite(n) ? null : roundHalfAwayFromZero(n * 1000);
}

export function millsToEuroInput(mills: number | null | undefined): string {
  if (mills === null || mills === undefined) return '';
  const s = (mills / 1000).toFixed(3);
  // Drittes Nachkommastellen-Zeichen nur zeigen, wenn nötig
  return (s.endsWith('0') ? s.slice(0, -1) : s).replace('.', ',');
}

export function centsToEuroInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

/**
 * Zahl aus deutschem oder englischem Format lesen:
 * "1.234,5" → 1234.5, "1,234.5" → 1234.5, "1,5" → 1.5, "1.5" → 1.5, "1 234" → 1234.
 */
export function parseLocaleNumber(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  let s = input.trim().replace(/[\s  ']/g, '');
  if (s === '') return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Das zuletzt stehende Zeichen ist das Dezimaltrennzeichen.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // Nur Kommas: mehrere → Tausender, eines → Dezimal
    s = (s.match(/,/g)!.length > 1) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot >= 0 && (s.match(/\./g)!.length > 1)) {
    s = s.replace(/\./g, '');
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function formatNumber(n: number | null | undefined, maxDecimals = 2): string {
  if (n === null || n === undefined) return '';
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: maxDecimals }).format(n);
}

/** Basispunkte → "19 %" / "7,5 %" */
export function formatBp(bp: number): string {
  return `${formatNumber(bp / 100, 2)} %`;
}
