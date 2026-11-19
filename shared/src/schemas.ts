// Eingabe-Schemas (zod) – gemeinsam für API-Validierung und Formulare.
import { z } from 'zod';
import { CUSTOMER_TYPES, MATERIAL_UNITS, ORDER_STATUSES, PART_STATUSES, PRIORITIES } from './types.ts';

/**
 * Patch-Schema: alle Felder optional, aber OHNE Standardwerte.
 * (zod 4 wendet .default() auch in .partial() an – das würde bei Teil-Updates Werte überschreiben.)
 */
export function patchOf<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape: Record<string, z.ZodType> = {};
  for (const [k, field] of Object.entries(schema.shape)) {
    const f = field as z.ZodType;
    shape[k] = (f instanceof z.ZodDefault ? (f.unwrap() as z.ZodType) : f).optional();
  }
  return z.object(shape) as unknown as ReturnType<z.ZodObject<T>['partial']>;
}

const optText = z.string().trim().max(5000).nullish().transform((v) => (v ? v : null));
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT erwartet')
  .nullish()
  .or(z.literal('').transform(() => null))
  .transform((v) => v ?? null);
const optNum = z.number().min(0, 'Darf nicht negativ sein').nullish().transform((v) => v ?? null);
const optInt = z.number().int().min(0).nullish().transform((v) => v ?? null);
const cents = z.number().int('Betrag muss in ganzen Cent angegeben sein');

export const orderInputSchema = z.object({
  title: z.string().trim().min(1, 'Titel fehlt').max(300),
  customerName: z.string().trim().min(1, 'Auftraggeber:in fehlt').max(300),
  contact: optText,
  customerType: z.enum(CUSTOMER_TYPES).default('privat'),
  billToName: optText,
  billToAddress: optText,
  customerVatId: optText,
  noBilling: z.boolean().default(false),
  dueDate: isoDate,
  priority: z.enum(PRIORITIES).default('normal'),
  status: z.enum(ORDER_STATUSES).default('neu'),
  notes: optText,
  assignee: optText,
});
export type OrderInput = z.infer<typeof orderInputSchema>;
export const orderPatchSchema = patchOf(orderInputSchema);

export const partInputSchema = z.object({
  name: z.string().trim().min(1, 'Bezeichnung fehlt').max(300),
  quantity: z.number().int('Anzahl muss ganzzahlig sein').min(1, 'Anzahl mindestens 1').default(1),
  processId: z.number().int().nullish().transform((v) => v ?? null),
  machineId: z.number().int().nullish().transform((v) => v ?? null),
  materialId: z.number().int().nullish().transform((v) => v ?? null),
  materialText: optText,
  color: optText,
  dimW: optNum,
  dimD: optNum,
  dimH: optNum,
  fileRef: optText,
  estMinutes: optInt,
  actualMinutes: optInt,
  materialAmount: optNum,
  status: z.enum(PART_STATUSES).default('offen'),
  done: z.boolean().optional(),
  notes: optText,
});
export type PartInput = z.infer<typeof partInputSchema>;
export const partPatchSchema = patchOf(partInputSchema);

export const processInputSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt'),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
});
export const processPatchSchema = patchOf(processInputSchema);

export const machineInputSchema = z.object({
  processId: z.number().int(),
  name: z.string().trim().min(1, 'Name fehlt'),
  active: z.boolean().default(true),
  note: optText,
  hourlyRateCents: cents.min(0).default(0),
  jobFlatCents: cents.min(0).default(0),
  sort: z.number().int().default(0),
});
export const machinePatchSchema = patchOf(machineInputSchema);

export const materialInputSchema = z.object({
  processId: z.number().int(),
  name: z.string().trim().min(1, 'Name fehlt'),
  unit: z.enum(MATERIAL_UNITS),
  priceMills: cents.min(0).default(0),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
});
export const materialPatchSchema = patchOf(materialInputSchema);

export const discountInputSchema = z.object({
  customerType: z.enum(CUSTOMER_TYPES),
  percentBp: z.number().int().min(0).max(10000),
  label: z.string().trim().default(''),
});

export const invoiceSettingsSchema = z.object({
  name: z.string().trim().min(1, 'Absendername fehlt'),
  address: z.string().trim().min(1, 'Anschrift fehlt'),
  email: optText,
  phone: optText,
  website: optText,
  taxNumber: optText,
  vatId: optText,
  bankName: optText,
  iban: optText,
  bic: optText,
  accountHolder: optText,
  footer: optText,
  logoDataUrl: z
    .string()
    .regex(/^data:image\/(png|jpe?g);base64,/, 'Logo muss PNG oder JPG sein')
    .max(2_000_000, 'Logo ist zu groß (max. ca. 1,5 MB)')
    .nullish()
    .transform((v) => v ?? null),
  paymentTermDays: z.number().int().min(0).max(365),
  numberFormat: z.string().trim().min(1),
  taxRateBp: z.number().int().min(0).max(10000),
  taxExemptNote: z.string().trim().default(''),
  autoDraftOnFinish: z.boolean(),
  introText: z.string().default(''),
});

export const invoiceItemInputSchema = z.object({
  description: z.string().trim().min(1, 'Beschreibung fehlt'),
  quantity: z.number().refine((n) => n !== 0, 'Menge darf nicht 0 sein'),
  unit: z.string().trim().default('Stk.'),
  unitPriceMills: cents,
  discountBp: z.number().int().min(0).max(10000).default(0),
  partId: z.number().int().nullish().transform((v) => v ?? null),
});
export const invoiceItemPatchSchema = patchOf(invoiceItemInputSchema);

export const invoicePatchSchema = z.object({
  invoiceDate: isoDate.optional(),
  serviceFrom: isoDate.optional(),
  serviceTo: isoDate.optional(),
  taxRateBp: z.number().int().min(0).max(10000).optional(),
  taxExemptNote: optText.optional(),
  notes: optText.optional(),
  recipient: z
    .object({ name: z.string().trim().min(1, 'Empfänger fehlt'), address: z.string().trim(), vatId: optText })
    .optional(),
});
