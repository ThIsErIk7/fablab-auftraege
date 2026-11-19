// Speichert importierte Teile – erst nach Bestätigung im Browser, in einer einzigen Transaktion.
import type { MasterData } from '@fablab/shared';
import { orderInputSchema } from '@fablab/shared';
import {
  nameKey, validateRows, type Cell, type ColumnMapping, type Resolutions,
} from '@fablab/shared/import';
import { z } from 'zod';
import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { badRequest } from '../errors.ts';
import { createMachine, createProcess, getMasterData } from '../repos/masterdata.ts';
import { createOrder, createPart, getOrder } from '../repos/orders.ts';
import { logHistory } from './history.ts';

const resolution = z.discriminatedUnion('action', [
  z.object({ action: z.literal('map'), id: z.number().int() }),
  z.object({ action: z.literal('create'), processId: z.number().int().optional() }),
  z.object({ action: z.literal('skip') }),
]);

export const importCommitSchema = z.object({
  target: z.union([
    z.object({ orderId: z.number().int() }),
    z.object({ newOrder: orderInputSchema }),
  ]),
  mapping: z.array(z.string().nullable()),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(5000, 'Maximal 5000 Zeilen pro Import'),
  resolutions: z.object({ processes: z.record(z.string(), resolution), machines: z.record(z.string(), resolution) }),
  /** Vom Nutzer ausgeschlossene Zeilen (0-basiert). */
  skipRows: z.array(z.number().int()).default([]),
  fileName: z.string().optional(),
});
export type ImportCommit = z.infer<typeof importCommitSchema>;

/** Stammdaten um Zuordnungen (Alias-Namen) und neu angelegte Einträge ergänzen. */
function applyResolutions(db: DB, rows: Cell[][], mapping: ColumnMapping, res: Resolutions): MasterData {
  let md = getMasterData(db);
  const first = validateRows(rows, mapping, md);

  for (const r of first) {
    if (!r.unknownProcess) continue;
    const key = nameKey(r.unknownProcess);
    const rs = res.processes[key];
    if (rs?.action === 'create' && !md.processes.some((p) => nameKey(p.name) === key)) {
      createProcess(db, { name: r.unknownProcess, active: true, aliases: '', sort: md.processes.length });
      md = getMasterData(db);
    }
  }
  const procAlias = (m: MasterData) => {
    for (const [key, rs] of Object.entries(res.processes)) {
      if (rs.action !== 'map') continue;
      const target = m.processes.find((p) => p.id === rs.id);
      if (!target) throw badRequest('Zugeordnetes Verfahren existiert nicht.');
      m.processes.push({ ...target, name: key, aliases: '' });
    }
    return m;
  };
  md = procAlias(md);

  // Maschinen: erneut validieren, damit Verfahren der Zeile bekannt ist
  const second = validateRows(rows, mapping, md);
  for (const r of second) {
    if (!r.unknownMachine) continue;
    const key = nameKey(r.unknownMachine);
    const rs = res.machines[key];
    if (rs?.action === 'create' && !md.machines.some((m) => nameKey(m.name) === key)) {
      const processId = rs.processId ?? r.part.processId;
      if (!processId) throw badRequest(`Für die neue Maschine „${r.unknownMachine}“ muss ein Verfahren gewählt werden.`);
      createMachine(db, { processId, name: r.unknownMachine, active: true, note: null, hourlyRateCents: 0, jobFlatCents: 0, aliases: '', sort: 99 });
      md = procAlias(getMasterData(db));
    }
  }
  for (const [key, rs] of Object.entries(res.machines)) {
    if (rs.action !== 'map') continue;
    const target = md.machines.find((m) => m.id === rs.id);
    if (!target) throw badRequest('Zugeordnete Maschine existiert nicht.');
    md.machines.push({ ...target, name: key, aliases: '' });
  }
  return md;
}

export function commitImport(db: DB, input: ImportCommit) {
  return tx(db, () => {
    const mapping = input.mapping as ColumnMapping;
    if (!mapping.includes('name') || !mapping.includes('quantity')) {
      throw badRequest('Die Pflichtfelder „Bezeichnung“ und „Anzahl“ müssen einer Spalte zugeordnet sein.');
    }
    const md = applyResolutions(db, input.rows, mapping, input.resolutions);
    const results = validateRows(input.rows, mapping, md);
    const skip = new Set(input.skipRows);
    const toImport = [];
    let skipped = 0;
    const problems: string[] = [];
    for (const r of results) {
      const procSkip = r.unknownProcess && input.resolutions.processes[nameKey(r.unknownProcess)]?.action === 'skip';
      const machSkip = r.unknownMachine && input.resolutions.machines[nameKey(r.unknownMachine)]?.action === 'skip';
      if (skip.has(r.index) || procSkip || machSkip) { skipped++; continue; }
      if (r.unknownProcess) problems.push(`Zeile ${r.line}: Verfahren „${r.unknownProcess}“ nicht aufgelöst.`);
      if (r.unknownMachine) problems.push(`Zeile ${r.line}: Maschine „${r.unknownMachine}“ nicht aufgelöst.`);
      problems.push(...r.errors.map((e) => `Zeile ${r.line}: ${e}`));
      toImport.push(r);
    }
    if (problems.length) throw badRequest('Import nicht möglich – bitte Fehler beheben oder Zeilen überspringen.', { problems });
    if (toImport.length === 0) throw badRequest('Keine Zeilen zum Importieren.');

    let orderId: number;
    if ('orderId' in input.target) {
      orderId = getOrder(db, input.target.orderId).id;
    } else {
      orderId = createOrder(db, input.target.newOrder).id;
    }
    for (const r of toImport) createPart(db, orderId, { ...r.part, done: r.part.status === 'fertig' }, { log: false });
    logHistory(db, {
      entity: 'order', entityId: orderId, orderId, field: 'import', newValue: toImport.length,
      message: `${toImport.length} Teil(e) importiert${input.fileName ? ` aus „${input.fileName}“` : ''}${skipped ? `, ${skipped} übersprungen` : ''}`,
    });
    return { orderId, imported: toImport.length, skipped };
  });
}

