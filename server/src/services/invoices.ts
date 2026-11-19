import type { InvoiceDetail, InvoiceItem, InvoiceListItem, OrderStatus, Party } from '@fablab/shared';
import {
  addDaysIso, computeTotals, counterKey, formatInvoiceNumber, invoiceDisplayStatus, invoiceItemInputSchema,
  invoicePatchSchema, isInvoiceEditable, itemTotal, priceForPart, todayIso, validateNumberFormat,
} from '@fablab/shared';
import type { z } from 'zod';
import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { AppError, badRequest, conflict, notFound } from '../errors.ts';
import { discountFor, getMasterData } from '../repos/masterdata.ts';
import { getOrder } from '../repos/orders.ts';
import { toInvoice, toItem } from '../repos/rows.ts';
import { DEFAULT_INVOICE_SETTINGS, getInvoiceSettings } from '../repos/settings.ts';
import { logHistory } from './history.ts';

type ItemInput = z.infer<typeof invoiceItemInputSchema>;
type InvoicePatch = z.infer<typeof invoicePatchSchema>;

// ---------------------------------------------------------------------------
// Lesen

export interface InvoiceFilter {
  status?: string; // inkl. 'ueberfaellig'
  type?: 'rechnung' | 'storno';
  orderId?: number;
  q?: string;
  from?: string;
  to?: string;
}

const LIST_SQL = `
  SELECT i.*, o.title AS order_title, c.number AS cancels_number
  FROM invoices i
  LEFT JOIN orders o ON o.id = i.order_id
  LEFT JOIN invoices c ON c.id = i.cancels_invoice_id`;

function toListItem(r: any, today: string): InvoiceListItem {
  const inv = toInvoice(r);
  return { ...inv, displayStatus: invoiceDisplayStatus(inv, today), orderTitle: r.order_title ?? null, cancelsNumber: r.cancels_number ?? null };
}

export function listInvoices(db: DB, f: InvoiceFilter = {}): InvoiceListItem[] {
  const today = todayIso();
  const where: string[] = [];
  const args: any[] = [];
  if (f.status === 'ueberfaellig') {
    where.push("i.status = 'gestellt' AND i.type = 'rechnung' AND i.due_date < ?");
    args.push(today);
  } else if (f.status === 'offen') {
    where.push("i.status = 'gestellt' AND i.type = 'rechnung'");
  } else if (f.status) {
    where.push('i.status = ?');
    args.push(f.status);
  }
  if (f.type) { where.push('i.type = ?'); args.push(f.type); }
  if (f.orderId) { where.push('i.order_id = ?'); args.push(f.orderId); }
  if (f.from) { where.push('i.invoice_date >= ?'); args.push(f.from); }
  if (f.to) { where.push('i.invoice_date <= ?'); args.push(f.to); }
  if (f.q) {
    const like = `%${f.q}%`;
    where.push('(i.number LIKE ? OR o.title LIKE ? OR i.recipient_json LIKE ?)');
    args.push(like, like, like);
  }
  const rows = db.prepare(`${LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE WHEN i.status = 'entwurf' THEN 0 ELSE 1 END, COALESCE(i.invoice_date, i.created_at) DESC, i.id DESC`).all(...args);
  return (rows as any[]).map((r) => toListItem(r, today));
}

export function getInvoice(db: DB, id: number): InvoiceDetail {
  const row = db.prepare(`${LIST_SQL} WHERE i.id = ?`).get(id);
  if (!row) throw notFound('Rechnung');
  const items = (db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort, id').all(id) as any[]).map(toItem);
  const by = db.prepare('SELECT id, number FROM invoices WHERE cancels_invoice_id = ?').get(id) as any;
  return { ...toListItem(row, todayIso()), items, cancelledBy: by ? { id: by.id, number: by.number } : null };
}

function requireDraft(db: DB, id: number) {
  const r = db.prepare('SELECT status FROM invoices WHERE id = ?').get(id) as any;
  if (!r) throw notFound('Rechnung');
  if (!isInvoiceEditable(r.status)) throw conflict('Gestellte Rechnungen sind gesperrt. Korrekturen nur über eine Stornorechnung.');
}

function recalc(db: DB, id: number) {
  const items = db.prepare('SELECT total_cents AS totalCents FROM invoice_items WHERE invoice_id = ?').all(id) as any[];
  const { tax_rate_bp } = db.prepare('SELECT tax_rate_bp FROM invoices WHERE id = ?').get(id) as any;
  const t = computeTotals(items, tax_rate_bp);
  db.prepare('UPDATE invoices SET net_cents = ?, tax_cents = ?, gross_cents = ? WHERE id = ?').run(t.netCents, t.taxCents, t.grossCents, id);
}

// ---------------------------------------------------------------------------
// Entwurf aus Auftrag

export function buildItemsForOrder(db: DB, orderId: number) {
  const order = getOrder(db, orderId);
  const md = getMasterData(db);
  const discountBp = discountFor(db, order.customerType);
  const warnings: string[] = [];
  const items: Omit<InvoiceItem, 'id' | 'invoiceId' | 'sort'>[] = [];
  for (const part of order.parts) {
    if (part.status === 'fehlgeschlagen') {
      warnings.push(`„${part.name}“ ist fehlgeschlagen und wurde nicht übernommen (bei Bedarf manuell hinzufügen).`);
      continue;
    }
    const machine = md.machines.find((m) => m.id === part.machineId) ?? null;
    const material = md.materials.find((m) => m.id === part.materialId) ?? null;
    const r = priceForPart(part, machine, material, discountBp);
    items.push(...r.items);
    warnings.push(...r.warnings);
  }
  if (order.parts.length === 0) warnings.push('Der Auftrag hat keine Teile – bitte Positionen manuell hinzufügen.');
  return { order, items, warnings, discountBp };
}

export function createDraftFromOrder(db: DB, orderId: number, opts: { allowNoBilling?: boolean } = {}) {
  return tx(db, () => {
    const { order, items, warnings } = buildItemsForOrder(db, orderId);
    if (order.noBilling && !opts.allowNoBilling) throw badRequest('Dieser Auftrag ist als „nicht abrechnen“ markiert.');
    const existing = db.prepare("SELECT id FROM invoices WHERE order_id = ? AND status = 'entwurf'").get(orderId) as any;
    if (existing) throw new AppError(409, 'Für diesen Auftrag existiert bereits ein Rechnungsentwurf.', { invoiceId: existing.id });

    const s = getInvoiceSettings(db);
    const recipient: Party = {
      name: order.billToName || order.customerName,
      address: order.billToAddress ?? '',
      vatId: order.customerVatId,
    };
    const r = db.prepare(`
      INSERT INTO invoices (order_id, type, status, service_from, service_to, tax_rate_bp, tax_exempt_note, recipient_json, created_at)
      VALUES (?, 'rechnung', 'entwurf', ?, ?, ?, ?, ?, ?)
    `).run(orderId, order.createdAt.slice(0, 10), todayIso(), s.taxRateBp, s.taxRateBp === 0 ? s.taxExemptNote || null : null,
      JSON.stringify(recipient), new Date().toISOString());
    const id = Number(r.lastInsertRowid);
    insertItems(db, id, items);
    recalc(db, id);
    logHistory(db, { entity: 'invoice', entityId: id, orderId, field: 'created', message: 'Rechnungsentwurf erstellt' });
    return { invoice: getInvoice(db, id), warnings };
  });
}

function insertItems(db: DB, invoiceId: number, items: Omit<InvoiceItem, 'id' | 'invoiceId' | 'sort'>[]) {
  const start = (db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM invoice_items WHERE invoice_id = ?').get(invoiceId) as any).s;
  const stmt = db.prepare(`INSERT INTO invoice_items (invoice_id, part_id, description, quantity, unit, unit_price_mills, discount_bp, total_cents, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  items.forEach((it, i) =>
    stmt.run(invoiceId, it.partId, it.description, it.quantity, it.unit, it.unitPriceMills, it.discountBp, it.totalCents, start + i + 1));
}

/** Positionen aus Teilen neu berechnen (freie Zusatzpositionen bleiben erhalten). */
export function regenerateDraftItems(db: DB, id: number) {
  return tx(db, () => {
    requireDraft(db, id);
    const inv = getInvoice(db, id);
    if (!inv.orderId) throw badRequest('Rechnung ist keinem Auftrag zugeordnet.');
    const { items, warnings } = buildItemsForOrder(db, inv.orderId);
    db.prepare('DELETE FROM invoice_items WHERE invoice_id = ? AND part_id IS NOT NULL').run(id);
    // Teil-Positionen zuerst, freie Positionen dahinter
    db.prepare('UPDATE invoice_items SET sort = sort + ? WHERE invoice_id = ?').run(items.length + 1, id);
    const stmt = db.prepare(`INSERT INTO invoice_items (invoice_id, part_id, description, quantity, unit, unit_price_mills, discount_bp, total_cents, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    items.forEach((it, i) => stmt.run(id, it.partId, it.description, it.quantity, it.unit, it.unitPriceMills, it.discountBp, it.totalCents, i + 1));
    recalc(db, id);
    return { invoice: getInvoice(db, id), warnings };
  });
}

// ---------------------------------------------------------------------------
// Entwurf bearbeiten

export function updateDraft(db: DB, id: number, p: InvoicePatch) {
  return tx(db, () => {
    requireDraft(db, id);
    const sets: string[] = [];
    const args: any[] = [];
    const put = (col: string, v: unknown) => { sets.push(`${col} = ?`); args.push(v); };
    if (p.invoiceDate !== undefined) put('invoice_date', p.invoiceDate);
    if (p.serviceFrom !== undefined) put('service_from', p.serviceFrom);
    if (p.serviceTo !== undefined) put('service_to', p.serviceTo);
    if (p.taxRateBp !== undefined) put('tax_rate_bp', p.taxRateBp);
    if (p.taxExemptNote !== undefined) put('tax_exempt_note', p.taxExemptNote);
    if (p.notes !== undefined) put('notes', p.notes);
    if (p.recipient !== undefined) put('recipient_json', JSON.stringify(p.recipient));
    if (sets.length) db.prepare(`UPDATE invoices SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    recalc(db, id);
    return getInvoice(db, id);
  });
}

export function addItem(db: DB, invoiceId: number, it: ItemInput) {
  return tx(db, () => {
    requireDraft(db, invoiceId);
    insertItems(db, invoiceId, [{ ...it, totalCents: itemTotal(it.quantity, it.unitPriceMills, it.discountBp) }]);
    recalc(db, invoiceId);
    return getInvoice(db, invoiceId);
  });
}

export function updateItem(db: DB, itemId: number, patch: Partial<ItemInput>) {
  return tx(db, () => {
    const cur = db.prepare('SELECT * FROM invoice_items WHERE id = ?').get(itemId) as any;
    if (!cur) throw notFound('Position');
    requireDraft(db, cur.invoice_id);
    const next = { ...toItem(cur), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    next.totalCents = itemTotal(next.quantity, next.unitPriceMills, next.discountBp);
    db.prepare(`UPDATE invoice_items SET description = ?, quantity = ?, unit = ?, unit_price_mills = ?, discount_bp = ?, total_cents = ? WHERE id = ?`)
      .run(next.description, next.quantity, next.unit, next.unitPriceMills, next.discountBp, next.totalCents, itemId);
    recalc(db, cur.invoice_id);
    return getInvoice(db, cur.invoice_id);
  });
}

export function deleteItem(db: DB, itemId: number) {
  return tx(db, () => {
    const cur = db.prepare('SELECT invoice_id FROM invoice_items WHERE id = ?').get(itemId) as any;
    if (!cur) throw notFound('Position');
    requireDraft(db, cur.invoice_id);
    db.prepare('DELETE FROM invoice_items WHERE id = ?').run(itemId);
    recalc(db, cur.invoice_id);
    return getInvoice(db, cur.invoice_id);
  });
}

export function deleteDraft(db: DB, id: number) {
  tx(db, () => {
    requireDraft(db, id);
    const inv = getInvoice(db, id);
    db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
    logHistory(db, { entity: 'invoice', entityId: id, orderId: inv.orderId, field: 'deleted', message: 'Rechnungsentwurf verworfen' });
  });
}

// ---------------------------------------------------------------------------
// Stellen, Bezahlen, Stornieren

/** Fehlende Pflichtangaben (§ 14 Abs. 4 UStG) vor dem Stellen. */
export function missingMandatoryFields(db: DB, inv: InvoiceDetail): string[] {
  const s = getInvoiceSettings(db);
  const miss: string[] = [];
  if (!s.name || s.name === DEFAULT_INVOICE_SETTINGS.name) miss.push('Absendername (Einstellungen)');
  if (!s.address || s.address === DEFAULT_INVOICE_SETTINGS.address) miss.push('Absenderanschrift (Einstellungen)');
  if (!s.taxNumber && !s.vatId) miss.push('Steuernummer oder USt-IdNr. (Einstellungen)');
  if (!inv.recipient.name?.trim()) miss.push('Name des Rechnungsempfängers');
  if (!inv.recipient.address?.trim()) miss.push('Anschrift des Rechnungsempfängers');
  if (inv.items.length === 0) miss.push('mindestens eine Position');
  if (inv.taxRateBp === 0 && !inv.taxExemptNote?.trim()) miss.push('Hinweis zur Steuerbefreiung (bei 0 % USt.)');
  const fmtErr = validateNumberFormat(s.numberFormat);
  if (fmtErr) miss.push(`gültiges Rechnungsnummern-Format (${fmtErr})`);
  return miss;
}

/** Nächste Nummer ziehen – nur innerhalb einer Transaktion aufrufen. */
function nextNumber(db: DB, format: string, invoiceDate: string): string {
  const year = Number(invoiceDate.slice(0, 4));
  const month = Number(invoiceDate.slice(5, 7));
  const key = counterKey(format, year);
  const { last_value } = db.prepare(`
    INSERT INTO invoice_counters (counter_key, last_value) VALUES (?, 1)
    ON CONFLICT(counter_key) DO UPDATE SET last_value = last_value + 1
    RETURNING last_value`).get(key) as any;
  const number = formatInvoiceNumber(format, year, last_value, month);
  if (db.prepare('SELECT 1 FROM invoices WHERE number = ?').get(number)) {
    throw conflict(`Rechnungsnummer ${number} ist bereits vergeben – bitte Nummernformat oder Zählerstand prüfen.`);
  }
  return number;
}

export function issueInvoice(db: DB, id: number, opts: { invoiceDate?: string } = {}) {
  return tx(db, () => {
    requireDraft(db, id);
    const inv = getInvoice(db, id);
    const missing = missingMandatoryFields(db, inv);
    if (missing.length) throw badRequest(`Rechnung kann nicht gestellt werden. Es fehlt: ${missing.join(', ')}.`, { missing });
    const s = getInvoiceSettings(db);
    const invoiceDate = opts.invoiceDate ?? inv.invoiceDate ?? todayIso();
    if (invoiceDate < (lastIssuedDate(db) ?? '')) {
      // Fortlaufende Nummern sollen zur Datumsreihenfolge passen.
      throw badRequest('Das Rechnungsdatum liegt vor der zuletzt gestellten Rechnung.');
    }
    const number = nextNumber(db, s.numberFormat, invoiceDate);
    const sender = pickSender(s);
    db.prepare(`UPDATE invoices SET number = ?, status = 'gestellt', invoice_date = ?, due_date = ?,
      service_from = COALESCE(service_from, ?), service_to = COALESCE(service_to, service_from, ?),
      sender_json = ?, issued_at = ? WHERE id = ?`).run(
      number, invoiceDate, inv.type === 'storno' ? invoiceDate : addDaysIso(invoiceDate, s.paymentTermDays),
      invoiceDate, invoiceDate, JSON.stringify(sender), new Date().toISOString(), id,
    );
    logHistory(db, { entity: 'invoice', entityId: id, orderId: inv.orderId, field: 'status', oldValue: 'entwurf', newValue: 'gestellt', message: `Rechnung ${number} gestellt` });
    return getInvoice(db, id);
  });
}

function lastIssuedDate(db: DB): string | null {
  return (db.prepare("SELECT MAX(invoice_date) AS d FROM invoices WHERE status <> 'entwurf'").get() as any).d;
}

function pickSender(s: ReturnType<typeof getInvoiceSettings>) {
  const { name, address, email, phone, website, taxNumber, vatId, bankName, iban, bic, accountHolder, footer, logoDataUrl } = s;
  return { name, address, email, phone, website, taxNumber, vatId, bankName, iban, bic, accountHolder, footer, logoDataUrl };
}

export function markPaid(db: DB, id: number, paidAt?: string) {
  return tx(db, () => {
    const inv = getInvoice(db, id);
    if (inv.status !== 'gestellt') throw conflict('Nur gestellte Rechnungen können als bezahlt markiert werden.');
    const date = paidAt ?? todayIso();
    db.prepare("UPDATE invoices SET status = 'bezahlt', paid_at = ? WHERE id = ?").run(date, id);
    logHistory(db, { entity: 'invoice', entityId: id, orderId: inv.orderId, field: 'status', oldValue: 'gestellt', newValue: 'bezahlt', message: `Rechnung ${inv.number} als bezahlt markiert` });
    return getInvoice(db, id);
  });
}

export function markUnpaid(db: DB, id: number) {
  return tx(db, () => {
    const inv = getInvoice(db, id);
    if (inv.status !== 'bezahlt') throw conflict('Rechnung ist nicht als bezahlt markiert.');
    db.prepare("UPDATE invoices SET status = 'gestellt', paid_at = NULL WHERE id = ?").run(id);
    logHistory(db, { entity: 'invoice', entityId: id, orderId: inv.orderId, field: 'status', oldValue: 'bezahlt', newValue: 'gestellt', message: `Zahlung für ${inv.number} zurückgenommen` });
    return getInvoice(db, id);
  });
}

/**
 * Stornorechnung: neue Rechnung mit negierten Positionen und eigener Nummer, Verweis auf das Original.
 * Das Original wird auf "storniert" gesetzt; seine Beträge bleiben unverändert.
 */
export function cancelInvoice(db: DB, id: number, reason?: string | null) {
  return tx(db, () => {
    const orig = getInvoice(db, id);
    if (orig.type !== 'rechnung') throw conflict('Eine Stornorechnung kann nicht erneut storniert werden.');
    if (orig.status === 'entwurf') throw conflict('Entwürfe werden gelöscht, nicht storniert.');
    if (orig.status === 'storniert') throw conflict('Rechnung ist bereits storniert.');
    const today = todayIso();
    const note = [`Stornorechnung zu Rechnung ${orig.number} vom ${orig.invoiceDate?.split('-').reverse().join('.')}.`, reason].filter(Boolean).join(' ');
    const r = db.prepare(`
      INSERT INTO invoices (order_id, type, cancels_invoice_id, status, invoice_date, service_from, service_to, tax_rate_bp,
        tax_exempt_note, recipient_json, notes, created_at)
      VALUES (?, 'storno', ?, 'entwurf', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orig.orderId, orig.id, today, orig.serviceFrom, orig.serviceTo, orig.taxRateBp, orig.taxExemptNote,
      JSON.stringify(orig.recipient), note, new Date().toISOString());
    const sid = Number(r.lastInsertRowid);
    insertItems(db, sid, orig.items.map((it) => ({
      partId: null, description: it.description, quantity: -it.quantity, unit: it.unit, unitPriceMills: it.unitPriceMills,
      discountBp: it.discountBp, totalCents: -it.totalCents,
    })));
    // Summen exakt spiegeln (kein erneutes Runden)
    db.prepare('UPDATE invoices SET net_cents = ?, tax_cents = ?, gross_cents = ? WHERE id = ?')
      .run(-orig.netCents, -orig.taxCents, -orig.grossCents, sid);
    const storno = issueInvoice(db, sid, { invoiceDate: today });
    db.prepare("UPDATE invoices SET status = 'storniert' WHERE id = ?").run(id);
    // War das Original unbezahlt, ist mit dem Storno alles ausgeglichen; sonst steht eine Erstattung aus.
    if (orig.status === 'gestellt') db.prepare("UPDATE invoices SET status = 'bezahlt', paid_at = ? WHERE id = ?").run(today, sid);
    logHistory(db, { entity: 'invoice', entityId: id, orderId: orig.orderId, field: 'status', oldValue: orig.status, newValue: 'storniert', message: `Rechnung ${orig.number} storniert durch ${storno.number}` });
    return getInvoice(db, sid);
  });
}

// ---------------------------------------------------------------------------
// Automatischer Entwurf bei "Fertig"

export function onOrderStatusChanged(db: DB, orderId: number, change: { from: OrderStatus; to: OrderStatus }): number | null {
  if (change.to !== 'fertig' || change.from === 'fertig') return null;
  const s = getInvoiceSettings(db);
  if (!s.autoDraftOnFinish) return null;
  const o = db.prepare('SELECT no_billing FROM orders WHERE id = ?').get(orderId) as any;
  if (!o || o.no_billing) return null;
  const has = db.prepare("SELECT 1 FROM invoices WHERE order_id = ? AND type = 'rechnung' AND status <> 'storniert'").get(orderId);
  if (has) return null;
  return createDraftFromOrder(db, orderId).invoice.id;
}
