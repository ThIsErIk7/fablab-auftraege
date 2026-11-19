import type { InvoiceDisplayStatus, InvoiceStatus, OrderStatus, Part, PartStatus } from './types.ts';

/** Erlaubte Statusübergänge für Aufträge (auch für Kanban-Drag & Drop). */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  neu: ['in_bearbeitung', 'fertig', 'storniert'],
  in_bearbeitung: ['neu', 'fertig', 'storniert'],
  fertig: ['in_bearbeitung', 'abgeholt', 'storniert'],
  abgeholt: ['fertig'],
  storniert: ['neu'],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || ORDER_TRANSITIONS[from].includes(to);
}

/** Teile kennen keine Einschränkung, aber "erledigt" und Status bleiben synchron. */
export function applyPartDone(part: Pick<Part, 'status' | 'done'>, done: boolean): { status: PartStatus; done: boolean } {
  if (done) return { done: true, status: 'fertig' };
  return { done: false, status: part.status === 'fertig' ? 'offen' : part.status };
}

export function applyPartStatus(status: PartStatus): { status: PartStatus; done: boolean } {
  return { status, done: status === 'fertig' };
}

/**
 * Ein Auftrag gilt als komplett, wenn es Teile gibt und alle erledigt sind.
 * Fehlgeschlagene Teile zählen nicht als erledigt.
 */
export function allPartsDone(parts: Pick<Part, 'done'>[]): boolean {
  return parts.length > 0 && parts.every((p) => p.done);
}

/** Soll die App vorschlagen, den Auftrag auf "Fertig" zu setzen? */
export function shouldSuggestFinish(orderStatus: OrderStatus, parts: Pick<Part, 'done'>[]): boolean {
  return (orderStatus === 'neu' || orderStatus === 'in_bearbeitung') && allPartsDone(parts);
}

export const INVOICE_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  entwurf: ['gestellt'],
  gestellt: ['bezahlt', 'storniert'],
  bezahlt: ['gestellt', 'storniert'],
  storniert: [],
};

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return INVOICE_TRANSITIONS[from].includes(to);
}

export function isInvoiceEditable(status: InvoiceStatus): boolean {
  return status === 'entwurf';
}

/** Überfällig = gestellt, nicht bezahlt, Fälligkeit liegt vor heute. */
export function invoiceDisplayStatus(
  inv: { status: InvoiceStatus; dueDate: string | null; type?: string },
  today: string = todayIso(),
): InvoiceDisplayStatus {
  if (inv.status === 'gestellt' && inv.type !== 'storno' && inv.dueDate && inv.dueDate < today) return 'ueberfaellig';
  return inv.status;
}

export function isOrderOverdue(o: { status: OrderStatus; dueDate: string | null }, today: string = todayIso()): boolean {
  return !!o.dueDate && o.dueDate < today && (o.status === 'neu' || o.status === 'in_bearbeitung');
}

export function todayIso(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function formatDateDe(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}
