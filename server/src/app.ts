import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import {
  discountInputSchema, invoiceItemInputSchema, invoicePatchSchema, invoiceSettingsSchema, machineInputSchema,
  materialInputSchema, orderInputSchema, orderPatchSchema, ORDER_STATUSES, partInputSchema, partPatchSchema,
  processInputSchema, validateNumberFormat, processPatchSchema, machinePatchSchema, materialPatchSchema, invoiceItemPatchSchema,
} from '@fablab/shared';
import type { DB } from './db/connection.ts';
import { tx } from './db/connection.ts';
import { AppError, badRequest } from './errors.ts';
import { renderInvoicePdf } from './pdf/invoicePdf.ts';
import {
  createMachine, createMaterial, createProcess, getMasterData, updateMachine, updateMaterial, updateProcess, upsertDiscount,
} from './repos/masterdata.ts';
import {
  createOrder, createPart, deleteOrder, deletePart, duplicatePart, getOrder, listOrders, machineQueue, setOrderStatus,
  updateOrder, updatePart, type OrderFilter,
} from './repos/orders.ts';
import { getInvoiceSettings, saveInvoiceSettings } from './repos/settings.ts';
import { getDashboard } from './services/dashboard.ts';
import { invoiceSheets, ordersSheet, partsSheet, templateSheet, toCsv, toXlsx } from './services/exportService.ts';
import { listHistory } from './services/history.ts';
import { commitImport, importCommitSchema } from './services/importService.ts';
import {
  addItem, cancelInvoice, createDraftFromOrder, deleteDraft, deleteItem, getInvoice, issueInvoice, listInvoices, markPaid,
  markUnpaid, missingMandatoryFields, onOrderStatusChanged, regenerateDraftItems, updateDraft, updateItem,
} from './services/invoices.ts';

const idParam = (req: FastifyRequest) => {
  const id = Number((req.params as any).id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Ungültige ID.');
  return id;
};
const list = (v: unknown) => (typeof v === 'string' && v ? v.split(',') : undefined);
const num = (v: unknown) => (v ? Number(v) : undefined);

function sendFile(reply: FastifyReply, name: string, type: string, body: string | Buffer, inline = false) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_');
  return reply
    .header('Content-Type', type)
    .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`)
    .send(body);
}
const CSV = 'text/csv; charset=utf-8';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function buildApp(db: DB, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 20 * 1024 * 1024 });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message));
      return reply.status(400).send({ error: `Ungültige Eingabe – ${issues.join('; ')}`, details: err.issues });
    }
    if (err instanceof AppError) return reply.status(err.status).send({ error: err.message, details: err.details });
    const msg = err instanceof Error ? err.message : String(err);
    // Meldungen der Datenbank-Trigger sind bereits verständlich formuliert
    if (/gesperrt|nicht geändert|nicht gelöscht/.test(msg)) return reply.status(409).send({ error: msg });
    if (/FOREIGN KEY/.test(msg)) return reply.status(409).send({ error: 'Datensatz wird noch verwendet und kann nicht gelöscht werden.' });
    if ((err as any).statusCode && (err as any).statusCode < 500) return reply.status((err as any).statusCode).send({ error: msg });
    app.log.error(err);
    return reply.status(500).send({ error: 'Interner Fehler. Bitte erneut versuchen oder Administrator:in informieren.' });
  });

  // --- Stammdaten -----------------------------------------------------------
  app.get('/api/masterdata', () => getMasterData(db));
  app.post('/api/processes', (req) => createProcess(db, processInputSchema.parse(req.body)));
  app.patch('/api/processes/:id', (req) => updateProcess(db, idParam(req), processPatchSchema.parse(req.body)));
  app.post('/api/machines', (req) => createMachine(db, machineInputSchema.parse(req.body)));
  app.patch('/api/machines/:id', (req) => updateMachine(db, idParam(req), machinePatchSchema.parse(req.body)));
  app.post('/api/materials', (req) => createMaterial(db, materialInputSchema.parse(req.body)));
  app.patch('/api/materials/:id', (req) => updateMaterial(db, idParam(req), materialPatchSchema.parse(req.body)));
  app.put('/api/discounts', (req) => z.array(discountInputSchema).parse(req.body).map((d) => upsertDiscount(db, d)));

  app.get('/api/settings/invoice', () => getInvoiceSettings(db));
  app.put('/api/settings/invoice', (req) => {
    const s = invoiceSettingsSchema.parse(req.body);
    const fmtErr = validateNumberFormat(s.numberFormat);
    if (fmtErr) throw badRequest(fmtErr);
    return saveInvoiceSettings(db, s);
  });

  // --- Aufträge -------------------------------------------------------------
  app.get('/api/orders', (req) => {
    const q = req.query as Record<string, string>;
    const f: OrderFilter = {
      q: q.q, status: list(q.status), priority: list(q.priority), processId: num(q.processId), machineId: num(q.machineId),
      dueFrom: q.dueFrom, dueTo: q.dueTo, overdue: q.overdue === '1', sort: q.sort as OrderFilter['sort'], dir: q.dir as 'asc' | 'desc',
    };
    return listOrders(db, f);
  });
  app.post('/api/orders', (req, reply) => {
    const body = z.object({ order: orderInputSchema, parts: z.array(partInputSchema).default([]) }).parse(req.body);
    reply.status(201);
    return createOrder(db, body.order, body.parts);
  });
  app.get('/api/orders/:id', (req) => getOrder(db, idParam(req)));
  app.patch('/api/orders/:id', (req) => {
    const id = idParam(req);
    const patch = orderPatchSchema.parse(req.body);
    // Status separat behandeln, damit der Auto-Rechnungsentwurf greift
    const { status, ...rest } = patch;
    return tx(db, () => {
      updateOrder(db, id, rest);
      let draftInvoiceId: number | null = null;
      if (status) draftInvoiceId = onOrderStatusChanged(db, id, setOrderStatus(db, id, status));
      return { ...getOrder(db, id), draftInvoiceId };
    });
  });
  app.post('/api/orders/:id/status', (req) => {
    const id = idParam(req);
    const { status } = z.object({ status: z.enum(ORDER_STATUSES) }).parse(req.body);
    return tx(db, () => {
      const change = setOrderStatus(db, id, status);
      const draftInvoiceId = onOrderStatusChanged(db, id, change);
      return { order: getOrder(db, id), draftInvoiceId };
    });
  });
  app.delete('/api/orders/:id', (req, reply) => { deleteOrder(db, idParam(req)); reply.status(204).send(); });
  app.get('/api/orders/:id/history', (req) => listHistory(db, { orderId: idParam(req) }));

  // --- Teile ----------------------------------------------------------------
  app.post('/api/orders/:id/parts', (req, reply) => {
    const id = idParam(req);
    const body = req.body;
    const inputs = Array.isArray(body) ? z.array(partInputSchema).parse(body) : [partInputSchema.parse(body)];
    reply.status(201);
    return tx(db, () => inputs.map((p) => createPart(db, id, p)));
  });
  app.patch('/api/parts/:id', (req) => updatePart(db, idParam(req), partPatchSchema.parse(req.body)));
  app.post('/api/parts/:id/duplicate', (req, reply) => { reply.status(201); return duplicatePart(db, idParam(req)); });
  app.delete('/api/parts/:id', (req, reply) => { deletePart(db, idParam(req)); reply.status(204).send(); });
  app.post('/api/orders/:id/parts/reorder', (req) => {
    const id = idParam(req);
    const ids = z.array(z.number().int()).parse(req.body);
    tx(db, () => ids.forEach((pid, i) => db.prepare('UPDATE parts SET sort = ? WHERE id = ? AND order_id = ?').run(i + 1, pid, id)));
    return getOrder(db, id);
  });

  app.get('/api/machines/queue', (req) => machineQueue(db, num((req.query as any).machineId)));
  app.get('/api/dashboard', () => getDashboard(db));
  app.get('/api/history', (req) => {
    const q = req.query as Record<string, string>;
    return listHistory(db, { entity: q.entity, entityId: num(q.entityId), limit: num(q.limit) ?? 200 });
  });

  // --- Rechnungen -----------------------------------------------------------
  app.get('/api/invoices', (req) => {
    const q = req.query as Record<string, string>;
    return listInvoices(db, { status: q.status, type: q.type as any, orderId: num(q.orderId), q: q.q, from: q.from, to: q.to });
  });
  app.post('/api/orders/:id/invoice-draft', (req, reply) => {
    const { allowNoBilling } = z.object({ allowNoBilling: z.boolean().optional() }).parse(req.body ?? {});
    reply.status(201);
    return createDraftFromOrder(db, idParam(req), { allowNoBilling });
  });
  app.get('/api/invoices/:id', (req) => {
    const inv = getInvoice(db, idParam(req));
    return { ...inv, missing: inv.status === 'entwurf' ? missingMandatoryFields(db, inv) : [] };
  });
  app.patch('/api/invoices/:id', (req) => updateDraft(db, idParam(req), invoicePatchSchema.parse(req.body)));
  app.delete('/api/invoices/:id', (req, reply) => { deleteDraft(db, idParam(req)); reply.status(204).send(); });
  app.post('/api/invoices/:id/regenerate', (req) => regenerateDraftItems(db, idParam(req)));
  app.post('/api/invoices/:id/items', (req) => addItem(db, idParam(req), invoiceItemInputSchema.parse(req.body)));
  app.patch('/api/invoice-items/:id', (req) => updateItem(db, idParam(req), invoiceItemPatchSchema.parse(req.body)));
  app.delete('/api/invoice-items/:id', (req) => deleteItem(db, idParam(req)));
  app.post('/api/invoices/:id/issue', (req) => {
    const { invoiceDate } = z.object({ invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.body ?? {});
    return issueInvoice(db, idParam(req), { invoiceDate });
  });
  app.post('/api/invoices/:id/pay', (req) => {
    const { paidAt } = z.object({ paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.body ?? {});
    return markPaid(db, idParam(req), paidAt);
  });
  app.post('/api/invoices/:id/unpay', (req) => markUnpaid(db, idParam(req)));
  app.post('/api/invoices/:id/cancel', (req) => {
    const { reason } = z.object({ reason: z.string().trim().max(500).nullish() }).parse(req.body ?? {});
    return cancelInvoice(db, idParam(req), reason);
  });
  app.get('/api/invoices/:id/pdf', async (req, reply) => {
    const inv = getInvoice(db, idParam(req));
    const s = getInvoiceSettings(db);
    const pdf = await renderInvoicePdf(inv, s, { paymentTermDays: s.paymentTermDays, introText: s.introText });
    const name = inv.number ? `${inv.type === 'storno' ? 'Stornorechnung' : 'Rechnung'}_${inv.number}.pdf` : `Rechnungsentwurf_${inv.id}.pdf`;
    return sendFile(reply, name, 'application/pdf', pdf, (req.query as any).inline === '1');
  });

  // --- Import / Export ------------------------------------------------------
  app.post('/api/import/commit', (req, reply) => {
    reply.status(201);
    return commitImport(db, importCommitSchema.parse(req.body));
  });
  app.get('/api/import/template.:fmt', (req, reply) => {
    const fmt = (req.params as any).fmt;
    if (fmt === 'csv') return sendFile(reply, 'Import-Vorlage_Teile.csv', CSV, toCsv(templateSheet()));
    if (fmt === 'xlsx') return sendFile(reply, 'Import-Vorlage_Teile.xlsx', XLSX_TYPE, toXlsx([templateSheet()]));
    throw badRequest('Format muss csv oder xlsx sein.');
  });
  app.get('/api/export/:what.:fmt', (req, reply) => {
    const { what, fmt } = req.params as { what: string; fmt: string };
    const q = req.query as Record<string, string>;
    const stamp = new Date().toISOString().slice(0, 10);
    let sheets;
    if (what === 'auftraege') sheets = [ordersSheet(db, { q: q.q, status: list(q.status), priority: list(q.priority), processId: num(q.processId), machineId: num(q.machineId) })];
    else if (what === 'teile') sheets = [partsSheet(db, q.orderId ? [Number(q.orderId)] : undefined)];
    else if (what === 'rechnungen') sheets = invoiceSheets(db, { from: q.from, to: q.to, status: q.status });
    else throw badRequest('Unbekannter Export.');
    const base = `${what === 'auftraege' ? 'Auftraege' : what === 'teile' ? 'Teile' : 'Rechnungen'}_${stamp}`;
    if (fmt === 'csv') return sendFile(reply, `${base}.csv`, CSV, toCsv(sheets[0]));
    if (fmt === 'xlsx') return sendFile(reply, `${base}.xlsx`, XLSX_TYPE, toXlsx(sheets));
    throw badRequest('Format muss csv oder xlsx sein.');
  });

  app.get('/api/health', () => ({ ok: true }));
  return app;
}
