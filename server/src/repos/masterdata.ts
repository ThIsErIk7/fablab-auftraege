import type { CustomerType, MasterData } from '@fablab/shared';
import { discountInputSchema, machineInputSchema, materialInputSchema, processInputSchema } from '@fablab/shared';
import type { z } from 'zod';
import type { DB } from '../db/connection.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { buildUpdate, toDiscount, toMachine, toMaterial, toProcess } from './rows.ts';

export function getMasterData(db: DB): MasterData {
  return {
    processes: (db.prepare('SELECT * FROM processes ORDER BY sort, name').all() as any[]).map(toProcess),
    machines: (db.prepare('SELECT * FROM machines ORDER BY sort, name').all() as any[]).map(toMachine),
    materials: (db.prepare('SELECT * FROM materials ORDER BY sort, name').all() as any[]).map(toMaterial),
    discounts: (db.prepare('SELECT * FROM customer_discounts').all() as any[]).map(toDiscount),
  };
}

function uniqueGuard(e: unknown, what: string): never {
  if (e instanceof Error && /UNIQUE/.test(e.message)) throw conflict(`${what} mit diesem Namen existiert bereits.`);
  throw e;
}

// --- Verfahren
type ProcessIn = z.infer<typeof processInputSchema>;
export function createProcess(db: DB, p: ProcessIn) {
  try {
    const r = db.prepare('INSERT INTO processes (name, active, sort) VALUES (?, ?, ?)').run(p.name, p.active ? 1 : 0, p.sort);
    return toProcess(db.prepare('SELECT * FROM processes WHERE id = ?').get(r.lastInsertRowid) as any);
  } catch (e) { uniqueGuard(e, 'Ein Verfahren'); }
}
export function updateProcess(db: DB, id: number, p: Partial<ProcessIn>) {
  const { sql, values } = buildUpdate(p, { name: 'name', active: 'active', sort: 'sort' });
  try { if (sql) db.prepare(`UPDATE processes SET ${sql} WHERE id = ?`).run(...values, id); } catch (e) { uniqueGuard(e, 'Ein Verfahren'); }
  const row = db.prepare('SELECT * FROM processes WHERE id = ?').get(id);
  if (!row) throw notFound('Verfahren');
  return toProcess(row as any);
}

// --- Maschinen
type MachineIn = z.infer<typeof machineInputSchema>;
function assertProcess(db: DB, processId: number) {
  if (!db.prepare('SELECT 1 FROM processes WHERE id = ?').get(processId)) throw badRequest('Verfahren existiert nicht.');
}
export function createMachine(db: DB, m: MachineIn) {
  assertProcess(db, m.processId);
  try {
    const r = db.prepare(
      'INSERT INTO machines (process_id, name, active, note, hourly_rate_cents, job_flat_cents, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(m.processId, m.name, m.active ? 1 : 0, m.note, m.hourlyRateCents, m.jobFlatCents, m.sort);
    return toMachine(db.prepare('SELECT * FROM machines WHERE id = ?').get(r.lastInsertRowid) as any);
  } catch (e) { uniqueGuard(e, 'Eine Maschine'); }
}
export function updateMachine(db: DB, id: number, m: Partial<MachineIn>) {
  if (m.processId !== undefined) {
    assertProcess(db, m.processId);
    const used = db.prepare('SELECT COUNT(*) AS n FROM parts WHERE machine_id = ? AND (process_id IS NOT ? )').get(id, m.processId) as any;
    if (used.n > 0) throw conflict(`Die Maschine ist ${used.n} Teil(en) eines anderen Verfahrens zugeordnet – Verfahren kann nicht geändert werden.`);
  }
  const { sql, values } = buildUpdate(m, {
    processId: 'process_id', name: 'name', active: 'active', note: 'note',
    hourlyRateCents: 'hourly_rate_cents', jobFlatCents: 'job_flat_cents', sort: 'sort',
  });
  try { if (sql) db.prepare(`UPDATE machines SET ${sql} WHERE id = ?`).run(...values, id); } catch (e) { uniqueGuard(e, 'Eine Maschine'); }
  const row = db.prepare('SELECT * FROM machines WHERE id = ?').get(id);
  if (!row) throw notFound('Maschine');
  return toMachine(row as any);
}

// --- Materialien
type MaterialIn = z.infer<typeof materialInputSchema>;
export function createMaterial(db: DB, m: MaterialIn) {
  assertProcess(db, m.processId);
  try {
    const r = db.prepare('INSERT INTO materials (process_id, name, unit, price_mills, active, sort) VALUES (?, ?, ?, ?, ?, ?)')
      .run(m.processId, m.name, m.unit, m.priceMills, m.active ? 1 : 0, m.sort);
    return toMaterial(db.prepare('SELECT * FROM materials WHERE id = ?').get(r.lastInsertRowid) as any);
  } catch (e) { uniqueGuard(e, 'Ein Material (in diesem Verfahren)'); }
}
export function updateMaterial(db: DB, id: number, m: Partial<MaterialIn>) {
  if (m.processId !== undefined) assertProcess(db, m.processId);
  const { sql, values } = buildUpdate(m, {
    processId: 'process_id', name: 'name', unit: 'unit', priceMills: 'price_mills', active: 'active', sort: 'sort',
  });
  try { if (sql) db.prepare(`UPDATE materials SET ${sql} WHERE id = ?`).run(...values, id); } catch (e) { uniqueGuard(e, 'Ein Material (in diesem Verfahren)'); }
  const row = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
  if (!row) throw notFound('Material');
  return toMaterial(row as any);
}

// --- Rabatte
export function upsertDiscount(db: DB, d: z.infer<typeof discountInputSchema>) {
  db.prepare(
    `INSERT INTO customer_discounts (customer_type, percent_bp, label) VALUES (?, ?, ?)
     ON CONFLICT(customer_type) DO UPDATE SET percent_bp = excluded.percent_bp, label = excluded.label`,
  ).run(d.customerType, d.percentBp, d.label);
  return toDiscount(db.prepare('SELECT * FROM customer_discounts WHERE customer_type = ?').get(d.customerType) as any);
}

export function discountFor(db: DB, t: CustomerType): number {
  const r = db.prepare('SELECT percent_bp FROM customer_discounts WHERE customer_type = ?').get(t) as any;
  return r?.percent_bp ?? 0;
}
