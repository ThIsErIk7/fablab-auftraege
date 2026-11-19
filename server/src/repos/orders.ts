import type { OrderDetail, OrderInput, OrderListItem, OrderStatus, Part, PartInput, PartStatus } from '@fablab/shared';
import {
  applyPartDone, applyPartStatus, canTransitionOrder, ORDER_STATUS_LABELS, PART_STATUS_LABELS, shouldSuggestFinish,
} from '@fablab/shared';
import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { logHistory } from '../services/history.ts';
import { buildUpdate, toOrder, toPart } from './rows.ts';

// ---------------------------------------------------------------------------
// Aufträge

export interface OrderFilter {
  q?: string;
  status?: string[];
  priority?: string[];
  processId?: number;
  machineId?: number;
  dueFrom?: string;
  dueTo?: string;
  overdue?: boolean;
  sort?: 'created' | 'due' | 'priority' | 'title' | 'status' | 'customer' | 'progress';
  dir?: 'asc' | 'desc';
}

const SORTS: Record<NonNullable<OrderFilter['sort']>, string> = {
  created: 'o.created_at',
  due: "COALESCE(o.due_date, '9999-12-31')",
  priority: "CASE o.priority WHEN 'hoch' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END",
  title: 'o.title COLLATE NOCASE',
  status: "CASE o.status WHEN 'neu' THEN 0 WHEN 'in_bearbeitung' THEN 1 WHEN 'fertig' THEN 2 WHEN 'abgeholt' THEN 3 ELSE 4 END",
  customer: 'o.customer_name COLLATE NOCASE',
  progress: 'CAST(parts_done AS REAL) / MAX(parts_total, 1)',
};

export function listOrders(db: DB, f: OrderFilter = {}): OrderListItem[] {
  const where: string[] = [];
  const args: any[] = [];
  if (f.q) {
    const like = `%${f.q.trim()}%`;
    where.push(`(o.title LIKE ? OR o.customer_name LIKE ? OR o.notes LIKE ? OR o.assignee LIKE ? OR CAST(o.id AS TEXT) = ?
      OR EXISTS (SELECT 1 FROM parts p WHERE p.order_id = o.id AND (p.name LIKE ? OR p.file_ref LIKE ?)))`);
    args.push(like, like, like, like, f.q.trim().replace(/^#/, ''), like, like);
  }
  if (f.status?.length) { where.push(`o.status IN (${f.status.map(() => '?').join(',')})`); args.push(...f.status); }
  if (f.priority?.length) { where.push(`o.priority IN (${f.priority.map(() => '?').join(',')})`); args.push(...f.priority); }
  if (f.processId) { where.push('EXISTS (SELECT 1 FROM parts p WHERE p.order_id = o.id AND p.process_id = ?)'); args.push(f.processId); }
  if (f.machineId) { where.push('EXISTS (SELECT 1 FROM parts p WHERE p.order_id = o.id AND p.machine_id = ?)'); args.push(f.machineId); }
  if (f.dueFrom) { where.push('o.due_date >= ?'); args.push(f.dueFrom); }
  if (f.dueTo) { where.push('o.due_date <= ?'); args.push(f.dueTo); }
  if (f.overdue) { where.push("o.due_date < date('now','localtime') AND o.status IN ('neu','in_bearbeitung')"); }

  const sortExpr = SORTS[f.sort ?? 'created'] ?? SORTS.created;
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  const rows = db.prepare(`
    SELECT o.*,
      (SELECT COUNT(*) FROM parts p WHERE p.order_id = o.id) AS parts_total,
      (SELECT COUNT(*) FROM parts p WHERE p.order_id = o.id AND p.done = 1) AS parts_done,
      (SELECT GROUP_CONCAT(DISTINCT p.process_id) FROM parts p WHERE p.order_id = o.id) AS process_ids,
      (SELECT GROUP_CONCAT(DISTINCT p.machine_id) FROM parts p WHERE p.order_id = o.id) AS machine_ids,
      (SELECT COUNT(*) FROM invoices i WHERE i.order_id = o.id AND i.type = 'rechnung' AND i.status <> 'storniert') AS invoice_count
    FROM orders o
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${sortExpr} ${dir}, o.id DESC
  `).all(...args) as any[];
  const ids = (s: string | null) => (s ? s.split(',').map(Number) : []);
  return rows.map((r) => ({
    ...toOrder(r),
    partsTotal: r.parts_total,
    partsDone: r.parts_done,
    processIds: ids(r.process_ids),
    machineIds: ids(r.machine_ids),
    invoiceCount: r.invoice_count,
  }));
}

export function getOrder(db: DB, id: number): OrderDetail {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!row) throw notFound('Auftrag');
  const parts = (db.prepare('SELECT * FROM parts WHERE order_id = ? ORDER BY sort, id').all(id) as any[]).map(toPart);
  return { ...toOrder(row as any), parts };
}

const ORDER_COLUMNS = {
  title: 'title', customerName: 'customer_name', contact: 'contact', customerType: 'customer_type',
  billToName: 'bill_to_name', billToAddress: 'bill_to_address', customerVatId: 'customer_vat_id', noBilling: 'no_billing',
  dueDate: 'due_date', priority: 'priority', notes: 'notes', assignee: 'assignee',
};

export function createOrder(db: DB, input: OrderInput, parts: PartInput[] = []): OrderDetail {
  return tx(db, () => {
    const r = db.prepare(`
      INSERT INTO orders (title, customer_name, contact, customer_type, bill_to_name, bill_to_address, customer_vat_id,
        no_billing, due_date, priority, status, notes, assignee, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.title, input.customerName, input.contact, input.customerType, input.billToName, input.billToAddress,
      input.customerVatId, input.noBilling ? 1 : 0, input.dueDate, input.priority, input.status, input.notes, input.assignee,
      new Date().toISOString(),
    );
    const id = Number(r.lastInsertRowid);
    logHistory(db, { entity: 'order', entityId: id, orderId: id, field: 'created', newValue: input.status, message: 'Auftrag angelegt' });
    for (const p of parts) createPart(db, id, p, { log: false });
    return getOrder(db, id);
  });
}

export function updateOrder(db: DB, id: number, patch: Partial<OrderInput>): OrderDetail {
  return tx(db, () => {
    const before = getOrder(db, id);
    const { status, ...rest } = patch;
    const { sql, values } = buildUpdate(rest, ORDER_COLUMNS);
    if (sql) db.prepare(`UPDATE orders SET ${sql} WHERE id = ?`).run(...values, id);
    if (rest.dueDate !== undefined && rest.dueDate !== before.dueDate) {
      logHistory(db, { entity: 'order', entityId: id, orderId: id, field: 'due_date', oldValue: before.dueDate, newValue: rest.dueDate, message: `Deadline geändert` });
    }
    if (rest.priority && rest.priority !== before.priority) {
      logHistory(db, { entity: 'order', entityId: id, orderId: id, field: 'priority', oldValue: before.priority, newValue: rest.priority, message: `Priorität: ${before.priority} → ${rest.priority}` });
    }
    if (status && status !== before.status) setOrderStatus(db, id, status);
    return getOrder(db, id);
  });
}

/**
 * Statuswechsel mit Prüfung und Protokoll. Gibt zurück, ob ein Rechnungsentwurf angelegt werden soll
 * (die Entscheidung trifft der Aufrufer, um zyklische Abhängigkeiten zu vermeiden).
 */
export function setOrderStatus(db: DB, id: number, status: OrderStatus): { from: OrderStatus; to: OrderStatus } {
  const row = db.prepare('SELECT status FROM orders WHERE id = ?').get(id) as { status: OrderStatus } | undefined;
  if (!row) throw notFound('Auftrag');
  const from = row.status;
  if (from === status) return { from, to: status };
  if (!canTransitionOrder(from, status)) {
    throw conflict(`Statuswechsel „${ORDER_STATUS_LABELS[from]}“ → „${ORDER_STATUS_LABELS[status]}“ ist nicht erlaubt.`);
  }
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  logHistory(db, {
    entity: 'order', entityId: id, orderId: id, field: 'status', oldValue: from, newValue: status,
    message: `Status: ${ORDER_STATUS_LABELS[from]} → ${ORDER_STATUS_LABELS[status]}`,
  });
  return { from, to: status };
}

export function deleteOrder(db: DB, id: number) {
  const inv = db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE order_id = ? AND status <> 'entwurf'").get(id) as any;
  if (inv.n > 0) throw conflict('Auftrag hat gestellte Rechnungen und kann nicht gelöscht werden. Stattdessen stornieren.');
  tx(db, () => {
    db.prepare("DELETE FROM invoices WHERE order_id = ? AND status = 'entwurf'").run(id);
    const r = db.prepare('DELETE FROM orders WHERE id = ?').run(id);
    if (r.changes === 0) throw notFound('Auftrag');
    db.prepare("DELETE FROM history WHERE order_id = ? AND entity IN ('order','part')").run(id);
  });
}

// ---------------------------------------------------------------------------
// Teile

const PART_COLUMNS = {
  name: 'name', quantity: 'quantity', processId: 'process_id', machineId: 'machine_id', materialId: 'material_id',
  materialText: 'material_text', color: 'color', dimW: 'dim_w', dimD: 'dim_d', dimH: 'dim_h', fileRef: 'file_ref',
  estMinutes: 'est_minutes', actualMinutes: 'actual_minutes', materialAmount: 'material_amount', status: 'status',
  done: 'done', notes: 'notes',
};

/** Konsistenz Verfahren ↔ Maschine ↔ Material sicherstellen. Ergänzt fehlendes Verfahren aus der Maschine. */
function normalizePart<T extends Partial<PartInput>>(db: DB, p: T, current?: Part): T {
  const out = { ...p };
  const machineId = 'machineId' in p ? p.machineId : current?.machineId;
  let processId = 'processId' in p ? p.processId : current?.processId;
  if (machineId) {
    const m = db.prepare('SELECT process_id FROM machines WHERE id = ?').get(machineId) as any;
    if (!m) throw badRequest('Maschine existiert nicht.');
    if (processId == null) { processId = m.process_id; out.processId = processId; }
    else if (m.process_id !== processId) throw badRequest('Die gewählte Maschine gehört nicht zum gewählten Verfahren.');
  }
  const materialId = 'materialId' in p ? p.materialId : current?.materialId;
  if (materialId) {
    const mat = db.prepare('SELECT process_id FROM materials WHERE id = ?').get(materialId) as any;
    if (!mat) throw badRequest('Material existiert nicht.');
    if (processId != null && mat.process_id !== processId) throw badRequest('Das Material gehört nicht zum gewählten Verfahren.');
    if (!('materialText' in p)) out.materialText = null;
  }
  // done ↔ status synchron halten
  if (p.status !== undefined && p.done === undefined) Object.assign(out, applyPartStatus(p.status));
  else if (p.done !== undefined && p.status === undefined) Object.assign(out, applyPartDone(current ?? { status: 'offen', done: false }, p.done));
  return out;
}

export function getPart(db: DB, id: number): Part {
  const row = db.prepare('SELECT * FROM parts WHERE id = ?').get(id);
  if (!row) throw notFound('Teil');
  return toPart(row as any);
}

export function createPart(db: DB, orderId: number, input: PartInput, opts: { log?: boolean } = {}): Part {
  if (!db.prepare('SELECT 1 FROM orders WHERE id = ?').get(orderId)) throw notFound('Auftrag');
  const p = normalizePart(db, input);
  const done = p.done ?? p.status === 'fertig';
  const sort = (db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM parts WHERE order_id = ?').get(orderId) as any).s;
  const r = db.prepare(`
    INSERT INTO parts (order_id, name, quantity, process_id, machine_id, material_id, material_text, color, dim_w, dim_d, dim_h,
      file_ref, est_minutes, actual_minutes, material_amount, status, done, notes, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    orderId, p.name, p.quantity, p.processId, p.machineId, p.materialId, p.materialText, p.color, p.dimW, p.dimD, p.dimH,
    p.fileRef, p.estMinutes, p.actualMinutes, p.materialAmount, done ? 'fertig' : p.status, done ? 1 : 0, p.notes, sort,
  );
  const id = Number(r.lastInsertRowid);
  if (opts.log !== false) {
    logHistory(db, { entity: 'part', entityId: id, orderId, field: 'created', message: `Teil „${p.name}“ hinzugefügt` });
  }
  return getPart(db, id);
}

export interface PartChangeResult {
  part: Part;
  orderStatus: OrderStatus;
  suggestFinish: boolean;
  allDone: boolean;
}

function afterPartChange(db: DB, part: Part, previousStatus: PartStatus | null): PartChangeResult {
  // Erster Fortschritt an einem Teil setzt einen neuen Auftrag automatisch auf "In Bearbeitung".
  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(part.orderId) as { status: OrderStatus };
  let orderStatus = order.status;
  if (orderStatus === 'neu' && previousStatus !== part.status && (part.status === 'in_arbeit' || part.status === 'fertig')) {
    setOrderStatus(db, part.orderId, 'in_bearbeitung');
    orderStatus = 'in_bearbeitung';
  }
  const parts = db.prepare('SELECT done FROM parts WHERE order_id = ?').all(part.orderId) as { done: number }[];
  const flags = parts.map((x) => ({ done: x.done === 1 }));
  return {
    part,
    orderStatus,
    allDone: flags.length > 0 && flags.every((x) => x.done),
    suggestFinish: shouldSuggestFinish(orderStatus, flags),
  };
}

export function updatePart(db: DB, id: number, patch: Partial<PartInput>): PartChangeResult {
  return tx(db, () => {
    const before = getPart(db, id);
    const p = normalizePart(db, patch, before);
    const { sql, values } = buildUpdate(p, PART_COLUMNS);
    if (sql) db.prepare(`UPDATE parts SET ${sql} WHERE id = ?`).run(...values, id);
    const after = getPart(db, id);
    if (after.status !== before.status) {
      logHistory(db, {
        entity: 'part', entityId: id, orderId: after.orderId, field: 'status', oldValue: before.status, newValue: after.status,
        message: `Teil „${after.name}“: ${PART_STATUS_LABELS[before.status]} → ${PART_STATUS_LABELS[after.status]}`,
      });
    }
    return afterPartChange(db, after, before.status);
  });
}

export function setPartDone(db: DB, id: number, done: boolean) {
  return updatePart(db, id, { done });
}

export function duplicatePart(db: DB, id: number): Part {
  return tx(db, () => {
    const p = getPart(db, id);
    const copy = createPart(db, p.orderId, {
      ...p, name: `${p.name} (Kopie)`, status: 'offen', done: false, actualMinutes: null,
    });
    // Kopie direkt unter das Original setzen
    db.prepare('UPDATE parts SET sort = sort + 1 WHERE order_id = ? AND sort > ? AND id <> ?').run(p.orderId, p.sort, copy.id);
    db.prepare('UPDATE parts SET sort = ? WHERE id = ?').run(p.sort + 1, copy.id);
    return getPart(db, copy.id);
  });
}

export function deletePart(db: DB, id: number) {
  tx(db, () => {
    const p = getPart(db, id);
    db.prepare('DELETE FROM parts WHERE id = ?').run(id);
    logHistory(db, { entity: 'part', entityId: id, orderId: p.orderId, field: 'deleted', message: `Teil „${p.name}“ gelöscht` });
  });
}

/**
 * Warteschlange je Maschine: nicht erledigte Teile aktiver Aufträge, nach Priorität und Deadline.
 * Mit includeDone zusätzlich die erledigten Teile noch nicht abgeholter Aufträge (zum Zurücknehmen).
 */
export function machineQueue(db: DB, machineId?: number, includeDone = false) {
  const rows = db.prepare(`
    SELECT p.*, o.title AS order_title, o.priority AS order_priority, o.due_date AS order_due, o.status AS order_status,
           o.customer_name AS order_customer
    FROM parts p JOIN orders o ON o.id = p.order_id
    WHERE p.machine_id IS NOT NULL AND (
      (p.done = 0 AND o.status IN ('neu','in_bearbeitung'))
      ${includeDone ? "OR (p.done = 1 AND o.status IN ('neu','in_bearbeitung','fertig'))" : ''})
      ${machineId ? 'AND p.machine_id = ?' : ''}
    ORDER BY p.done, CASE p.status WHEN 'in_arbeit' THEN 0 WHEN 'fehlgeschlagen' THEN 1 ELSE 2 END,
             CASE o.priority WHEN 'hoch' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
             COALESCE(o.due_date, '9999-12-31'), o.created_at, p.sort
  `).all(...(machineId ? [machineId] : [])) as any[];
  return rows.map((r) => ({
    ...toPart(r),
    order: { id: r.order_id, title: r.order_title, priority: r.order_priority, dueDate: r.order_due, status: r.order_status, customerName: r.order_customer },
  }));
}
