// Export als CSV (Semikolon, UTF-8 mit BOM → öffnet korrekt in deutschem Excel) oder XLSX.
import {
  CUSTOMER_TYPE_LABELS, formatDateDe, INVOICE_STATUS_LABELS, MATERIAL_UNIT_LABELS, ORDER_STATUS_LABELS,
  PART_STATUS_LABELS, PRIORITY_LABELS,
} from '@fablab/shared';
import { TEMPLATE_HEADERS, TEMPLATE_ROWS } from '@fablab/shared/import';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { DB } from '../db/connection.ts';
import { getMasterData } from '../repos/masterdata.ts';
import { listOrders, type OrderFilter } from '../repos/orders.ts';
import { toItem, toPart } from '../repos/rows.ts';
import { listInvoices, type InvoiceFilter } from './invoices.ts';

type Value = string | number | null;
interface Column<T> { header: string; value: (r: T) => Value; money?: boolean; unitPrice?: boolean; date?: boolean }
interface Sheet { name: string; headers: string[]; rows: Value[][]; moneyCols: number[]; dateCols: number[]; unitPriceCols?: number[] }

function sheet<T>(name: string, cols: Column<T>[], data: T[]): Sheet {
  return {
    name,
    headers: cols.map((c) => c.header),
    rows: data.map((d) => cols.map((c) => c.value(d))),
    moneyCols: cols.flatMap((c, i) => (c.money ? [i] : [])),
    dateCols: cols.flatMap((c, i) => (c.date ? [i] : [])),
    unitPriceCols: cols.flatMap((c, i) => (c.unitPrice ? [i] : [])),
  };
}

const eur = (cents: number) => cents / 100;

export function ordersSheet(db: DB, f: OrderFilter): Sheet {
  return sheet('Aufträge', [
    { header: 'Auftrag-Nr.', value: (o) => o.id },
    { header: 'Titel', value: (o) => o.title },
    { header: 'Auftraggeber:in', value: (o) => o.customerName },
    { header: 'Kontakt', value: (o) => o.contact },
    { header: 'Kundentyp', value: (o) => CUSTOMER_TYPE_LABELS[o.customerType] },
    { header: 'Rechnungsempfänger', value: (o) => o.billToName },
    { header: 'Rechnungsadresse', value: (o) => o.billToAddress?.replace(/\n/g, ', ') ?? null },
    { header: 'USt-IdNr. Kunde', value: (o) => o.customerVatId },
    { header: 'Nicht abrechnen', value: (o) => (o.noBilling ? 'ja' : 'nein') },
    { header: 'Erstellt am', value: (o) => o.createdAt.slice(0, 10), date: true },
    { header: 'Deadline', value: (o) => o.dueDate, date: true },
    { header: 'Priorität', value: (o) => PRIORITY_LABELS[o.priority] },
    { header: 'Status', value: (o) => ORDER_STATUS_LABELS[o.status] },
    { header: 'Teile gesamt', value: (o) => o.partsTotal },
    { header: 'Teile erledigt', value: (o) => o.partsDone },
    { header: 'Zuständig', value: (o) => o.assignee },
    { header: 'Notizen', value: (o) => o.notes },
  ], listOrders(db, { ...f, sort: f.sort ?? 'created', dir: f.dir ?? 'asc' }));
}

export function partsSheet(db: DB, orderIds?: number[]): Sheet {
  const md = getMasterData(db);
  const rows = (db.prepare(`SELECT p.*, o.title AS order_title FROM parts p JOIN orders o ON o.id = p.order_id ORDER BY p.order_id, p.sort`).all() as any[])
    .filter((r) => !orderIds || orderIds.includes(r.order_id))
    .map((r) => ({ ...toPart(r), orderTitle: r.order_title as string }));
  const name = <T extends { id: number; name: string }>(list: T[], id: number | null) => list.find((x) => x.id === id)?.name ?? null;
  return sheet('Teile', [
    { header: 'Auftrag-Nr.', value: (p) => p.orderId },
    { header: 'Auftrag', value: (p) => p.orderTitle },
    { header: 'Bezeichnung', value: (p) => p.name },
    { header: 'Anzahl', value: (p) => p.quantity },
    { header: 'Verfahren', value: (p) => name(md.processes, p.processId) },
    { header: 'Maschine', value: (p) => name(md.machines, p.machineId) },
    { header: 'Material', value: (p) => name(md.materials, p.materialId) ?? p.materialText },
    { header: 'Farbe', value: (p) => p.color },
    { header: 'Breite (mm)', value: (p) => p.dimW },
    { header: 'Tiefe (mm)', value: (p) => p.dimD },
    { header: 'Höhe (mm)', value: (p) => p.dimH },
    { header: 'Datei', value: (p) => p.fileRef },
    { header: 'Geschätzte Dauer (min)', value: (p) => p.estMinutes },
    { header: 'Maschinenzeit (min)', value: (p) => p.actualMinutes },
    { header: 'Materialverbrauch', value: (p) => p.materialAmount },
    { header: 'Einheit', value: (p) => { const m = md.materials.find((x) => x.id === p.materialId); return m ? MATERIAL_UNIT_LABELS[m.unit] : null; } },
    { header: 'Status', value: (p) => PART_STATUS_LABELS[p.status] },
    { header: 'Erledigt', value: (p) => (p.done ? 'ja' : 'nein') },
    { header: 'Notizen', value: (p) => p.notes },
  ], rows);
}

export function invoiceSheets(db: DB, f: InvoiceFilter): Sheet[] {
  const invoices = listInvoices(db, f).filter((i) => i.status !== 'entwurf');
  const head = sheet('Rechnungen', [
    { header: 'Rechnungsnummer', value: (i) => i.number },
    { header: 'Art', value: (i) => (i.type === 'storno' ? 'Stornorechnung' : 'Rechnung') },
    { header: 'Storniert Rechnung', value: (i) => i.cancelsNumber },
    { header: 'Rechnungsdatum', value: (i) => i.invoiceDate, date: true },
    { header: 'Leistung von', value: (i) => i.serviceFrom, date: true },
    { header: 'Leistung bis', value: (i) => i.serviceTo, date: true },
    { header: 'Fällig am', value: (i) => i.dueDate, date: true },
    { header: 'Empfänger', value: (i) => i.recipient.name },
    { header: 'Anschrift', value: (i) => i.recipient.address.replace(/\n/g, ', ') },
    { header: 'USt-IdNr. Kunde', value: (i) => i.recipient.vatId ?? null },
    { header: 'Auftrag-Nr.', value: (i) => i.orderId },
    { header: 'Auftrag', value: (i) => i.orderTitle },
    { header: 'Netto (EUR)', value: (i) => eur(i.netCents), money: true },
    { header: 'Steuersatz (%)', value: (i) => i.taxRateBp / 100 },
    { header: 'Steuer (EUR)', value: (i) => eur(i.taxCents), money: true },
    { header: 'Brutto (EUR)', value: (i) => eur(i.grossCents), money: true },
    { header: 'Status', value: (i) => INVOICE_STATUS_LABELS[i.displayStatus] },
    { header: 'Bezahlt am', value: (i) => i.paidAt, date: true },
  ], invoices);
  const ids = new Set(invoices.map((i) => i.id));
  const items = (db.prepare(`SELECT it.*, i.number FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id ORDER BY i.invoice_date, i.id, it.sort`).all() as any[])
    .filter((r) => ids.has(r.invoice_id))
    .map((r) => ({ ...toItem(r), number: r.number as string }));
  const pos = sheet('Positionen', [
    { header: 'Rechnungsnummer', value: (r) => r.number },
    { header: 'Beschreibung', value: (r) => r.description },
    { header: 'Menge', value: (r) => r.quantity },
    { header: 'Einheit', value: (r) => r.unit },
    { header: 'Einzelpreis (EUR)', value: (r) => r.unitPriceMills / 1000, unitPrice: true },
    { header: 'Rabatt (%)', value: (r) => r.discountBp / 100 },
    { header: 'Gesamt netto (EUR)', value: (r) => eur(r.totalCents), money: true },
  ], items);
  return [head, pos];
}

export function templateSheet(): Sheet {
  return { name: 'Teile', headers: TEMPLATE_HEADERS, rows: TEMPLATE_ROWS, moneyCols: [], dateCols: [] };
}

// ---------------------------------------------------------------------------

export function toCsv(s: Sheet, opts: { germanNumbers?: boolean } = {}): string {
  const fmt = (v: Value, i: number) => {
    if (v === null) return '';
    if (typeof v === 'number') {
      const str = s.moneyCols.includes(i) ? v.toFixed(2) : s.unitPriceCols?.includes(i) ? v.toFixed(3) : String(v);
      return opts.germanNumbers === false ? str : str.replace('.', ',');
    }
    if (s.dateCols.includes(i) && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDateDe(v);
    return v;
  };
  return '﻿' + Papa.unparse({ fields: s.headers, data: s.rows.map((r) => r.map(fmt)) }, { delimiter: ';', newline: '\r\n' });
}

export function toXlsx(sheets: Sheet[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const data = s.rows.map((r) => r.map((v, i) => (s.dateCols.includes(i) && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00Z') : v)));
    const ws = XLSX.utils.aoa_to_sheet([s.headers, ...data], { cellDates: true });
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
    for (let r = 1; r <= range.e.r; r++) {
      for (const c of s.moneyCols) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell) cell.z = '#,##0.00 "€"'; }
      for (const c of s.unitPriceCols ?? []) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell) cell.z = '#,##0.00# "€"'; }
      for (const c of s.dateCols) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell) cell.z = 'dd.mm.yyyy'; }
    }
    ws['!cols'] = s.headers.map((h, i) => ({ wch: Math.min(50, Math.max(h.length, ...s.rows.map((r) => String(r[i] ?? '').length)) + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
