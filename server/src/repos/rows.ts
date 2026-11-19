// Umwandlung DB-Zeile (snake_case, 0/1) → API-Objekt (camelCase, boolean)
import type { CustomerDiscount, Invoice, InvoiceItem, Machine, Material, Order, Part, Process } from '@fablab/shared';

type Row = Record<string, any>;
const b = (v: unknown) => v === 1 || v === true;

export const toProcess = (r: Row): Process => ({ id: r.id, name: r.name, active: b(r.active), aliases: r.aliases ?? '', sort: r.sort });
export const toMachine = (r: Row): Machine => ({
  id: r.id, processId: r.process_id, name: r.name, active: b(r.active), note: r.note,
  hourlyRateCents: r.hourly_rate_cents, jobFlatCents: r.job_flat_cents, aliases: r.aliases ?? '', sort: r.sort,
});
export const toMaterial = (r: Row): Material => ({
  id: r.id, processId: r.process_id, name: r.name, unit: r.unit, priceMills: r.price_mills, active: b(r.active), aliases: r.aliases ?? '', sort: r.sort,
});
export const toDiscount = (r: Row): CustomerDiscount => ({ customerType: r.customer_type, percentBp: r.percent_bp, label: r.label });
export const toOrder = (r: Row): Order => ({
  id: r.id, title: r.title, customerName: r.customer_name, contact: r.contact, customerType: r.customer_type,
  billToName: r.bill_to_name, billToAddress: r.bill_to_address, customerVatId: r.customer_vat_id, noBilling: b(r.no_billing),
  createdAt: r.created_at, dueDate: r.due_date, priority: r.priority, status: r.status, notes: r.notes, assignee: r.assignee,
});
export const toPart = (r: Row): Part => ({
  id: r.id, orderId: r.order_id, name: r.name, quantity: r.quantity, processId: r.process_id, machineId: r.machine_id,
  materialId: r.material_id, materialText: r.material_text, color: r.color, dimW: r.dim_w, dimD: r.dim_d, dimH: r.dim_h,
  fileRef: r.file_ref, estMinutes: r.est_minutes, actualMinutes: r.actual_minutes, materialAmount: r.material_amount,
  status: r.status, done: b(r.done), notes: r.notes, sort: r.sort,
});
export const toInvoice = (r: Row): Invoice => ({
  id: r.id, number: r.number, orderId: r.order_id, type: r.type, cancelsInvoiceId: r.cancels_invoice_id, status: r.status,
  invoiceDate: r.invoice_date, serviceFrom: r.service_from, serviceTo: r.service_to, dueDate: r.due_date,
  netCents: r.net_cents, taxRateBp: r.tax_rate_bp, taxCents: r.tax_cents, grossCents: r.gross_cents,
  taxExemptNote: r.tax_exempt_note, recipient: JSON.parse(r.recipient_json), sender: r.sender_json ? JSON.parse(r.sender_json) : null,
  notes: r.notes, createdAt: r.created_at, issuedAt: r.issued_at, paidAt: r.paid_at,
});
export const toItem = (r: Row): InvoiceItem => ({
  id: r.id, invoiceId: r.invoice_id, partId: r.part_id, description: r.description, quantity: r.quantity, unit: r.unit,
  unitPriceMills: r.unit_price_mills, discountBp: r.discount_bp, totalCents: r.total_cents, sort: r.sort,
});

/** Baut "SET a = ?, b = ?" aus einem Patch-Objekt und einer Feld-Spalten-Zuordnung. */
export function buildUpdate(patch: Record<string, unknown>, columns: Record<string, string>) {
  const sets: string[] = [];
  const values: any[] = [];
  for (const [key, col] of Object.entries(columns)) {
    if (!(key in patch) || patch[key] === undefined) continue;
    const v = patch[key];
    sets.push(`${col} = ?`);
    values.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
  }
  return { sql: sets.join(', '), values };
}
