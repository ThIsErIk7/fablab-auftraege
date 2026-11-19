import type { HistoryEntry } from '@fablab/shared';
import type { DB } from '../db/connection.ts';

export function logHistory(
  db: DB,
  e: { entity: HistoryEntry['entity']; entityId: number; orderId: number | null; field: string; oldValue?: unknown; newValue?: unknown; message: string },
) {
  const s = (v: unknown) => (v === undefined || v === null ? null : String(v));
  db.prepare(
    'INSERT INTO history (entity, entity_id, order_id, field, old_value, new_value, message, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(e.entity, e.entityId, e.orderId, e.field, s(e.oldValue), s(e.newValue), e.message, new Date().toISOString());
}

export function listHistory(db: DB, f: { orderId?: number; entity?: string; entityId?: number; limit?: number }): HistoryEntry[] {
  const where: string[] = [];
  const args: any[] = [];
  if (f.orderId) { where.push('order_id = ?'); args.push(f.orderId); }
  if (f.entity) { where.push('entity = ?'); args.push(f.entity); }
  if (f.entityId) { where.push('entity_id = ?'); args.push(f.entityId); }
  const sql = `SELECT * FROM history ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY at DESC, id DESC LIMIT ?`;
  return (db.prepare(sql).all(...args, f.limit ?? 200) as any[]).map((r) => ({
    id: r.id, entity: r.entity, entityId: r.entity_id, orderId: r.order_id, field: r.field,
    oldValue: r.old_value, newValue: r.new_value, message: r.message, at: r.at,
  }));
}
