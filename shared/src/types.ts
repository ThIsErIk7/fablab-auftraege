// Zentrale Typen und Enums. Interne Schlüssel sind kurz und stabil,
// Anzeigetexte stehen in den *_LABELS-Objekten.

export const ORDER_STATUSES = ['neu', 'in_bearbeitung', 'fertig', 'abgeholt', 'storniert'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  neu: 'Neu',
  in_bearbeitung: 'In Bearbeitung',
  fertig: 'Fertig',
  abgeholt: 'Abgeholt',
  storniert: 'Storniert',
};

export const PART_STATUSES = ['offen', 'in_arbeit', 'fertig', 'fehlgeschlagen'] as const;
export type PartStatus = (typeof PART_STATUSES)[number];
export const PART_STATUS_LABELS: Record<PartStatus, string> = {
  offen: 'Offen',
  in_arbeit: 'In Arbeit',
  fertig: 'Fertig',
  fehlgeschlagen: 'Fehlgeschlagen',
};

export const INVOICE_STATUSES = ['entwurf', 'gestellt', 'bezahlt', 'storniert'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
/** "ueberfaellig" wird nie gespeichert, sondern aus Fälligkeit + Status abgeleitet. */
export type InvoiceDisplayStatus = InvoiceStatus | 'ueberfaellig';
export const INVOICE_STATUS_LABELS: Record<InvoiceDisplayStatus, string> = {
  entwurf: 'Entwurf',
  gestellt: 'Gestellt',
  bezahlt: 'Bezahlt',
  storniert: 'Storniert',
  ueberfaellig: 'Überfällig',
};

export const INVOICE_TYPES = ['rechnung', 'storno'] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const CUSTOMER_TYPES = ['privat', 'firma', 'hochschule', 'intern'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];
export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  privat: 'Privat',
  firma: 'Firma',
  hochschule: 'Hochschule',
  intern: 'Intern',
};

export const PRIORITIES = ['niedrig', 'normal', 'hoch'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { niedrig: 'Niedrig', normal: 'Normal', hoch: 'Hoch' };

/** Einheit des Materialverbrauchs; der Preis gilt immer pro Einheit (€/g, €/ml, €/m² …). */
export const MATERIAL_UNITS = ['g', 'ml', 'm2', 'platte', 'stueck'] as const;
export type MaterialUnit = (typeof MATERIAL_UNITS)[number];
export const MATERIAL_UNIT_LABELS: Record<MaterialUnit, string> = { g: 'g', ml: 'ml', m2: 'm²', platte: 'Platte', stueck: 'Stück' };
export const MATERIAL_PRICE_UNIT_LABELS: Record<MaterialUnit, string> = {
  g: '€/g',
  ml: '€/ml',
  m2: '€/m²',
  platte: '€/Platte',
  stueck: '€/Stück',
};

/** Größter Bauraum im Lab (mm), für den Warnhinweis im Teil-Formular. */
export const MAX_BUILD_VOLUME_MM = { w: 850, d: 405, h: 395 } as const;

export interface Process {
  id: number;
  name: string;
  active: boolean;
  sort: number;
}

export interface Machine {
  id: number;
  processId: number;
  name: string;
  active: boolean;
  /** Freitext, z. B. "In Wartung bis 30.11." */
  note: string | null;
  hourlyRateCents: number;
  jobFlatCents: number;
  sort: number;
}

export interface Material {
  id: number;
  processId: number;
  name: string;
  unit: MaterialUnit;
  /** Preis pro Einheit in Zehntelcent (1/1000 €), z. B. 0,035 €/g = 35. */
  priceMills: number;
  active: boolean;
  sort: number;
}

export interface CustomerDiscount {
  customerType: CustomerType;
  /** Rabatt in Basispunkten (1000 = 10 %). */
  percentBp: number;
  label: string;
}

export interface Order {
  id: number;
  title: string;
  customerName: string;
  contact: string | null;
  customerType: CustomerType;
  billToName: string | null;
  billToAddress: string | null;
  customerVatId: string | null;
  noBilling: boolean;
  createdAt: string;
  dueDate: string | null;
  priority: Priority;
  status: OrderStatus;
  notes: string | null;
  assignee: string | null;
}

export interface OrderListItem extends Order {
  partsTotal: number;
  partsDone: number;
  processIds: number[];
  machineIds: number[];
  invoiceCount: number;
}

export interface Part {
  id: number;
  orderId: number;
  name: string;
  quantity: number;
  processId: number | null;
  machineId: number | null;
  materialId: number | null;
  /** Freitext-Material, wenn keines aus der Vorschlagsliste passt. */
  materialText: string | null;
  color: string | null;
  dimW: number | null;
  dimD: number | null;
  dimH: number | null;
  fileRef: string | null;
  estMinutes: number | null;
  actualMinutes: number | null;
  /** Verbrauch in der Einheit des Materials (g, m², Platten, Stück). */
  materialAmount: number | null;
  status: PartStatus;
  done: boolean;
  notes: string | null;
  sort: number;
}

export interface OrderDetail extends Order {
  parts: Part[];
}

export interface InvoiceItem {
  id: number;
  invoiceId: number;
  partId: number | null;
  description: string;
  quantity: number;
  unit: string;
  unitPriceMills: number;
  /** Rabatt auf diese Position in Basispunkten. */
  discountBp: number;
  totalCents: number;
  sort: number;
}

export interface Party {
  name: string;
  address: string;
  vatId?: string | null;
  taxNumber?: string | null;
}

export interface Invoice {
  id: number;
  number: string | null;
  orderId: number | null;
  type: InvoiceType;
  cancelsInvoiceId: number | null;
  status: InvoiceStatus;
  invoiceDate: string | null;
  serviceFrom: string | null;
  serviceTo: string | null;
  dueDate: string | null;
  netCents: number;
  taxRateBp: number;
  taxCents: number;
  grossCents: number;
  taxExemptNote: string | null;
  recipient: Party;
  /** Erst beim Stellen eingefroren; im Entwurf null. */
  sender: SenderSnapshot | null;
  notes: string | null;
  createdAt: string;
  issuedAt: string | null;
  paidAt: string | null;
}

export interface InvoiceListItem extends Invoice {
  displayStatus: InvoiceDisplayStatus;
  orderTitle: string | null;
  cancelsNumber: string | null;
}

export interface InvoiceDetail extends InvoiceListItem {
  items: InvoiceItem[];
  cancelledBy: { id: number; number: string | null } | null;
}

export interface SenderSnapshot {
  name: string;
  address: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  taxNumber: string | null;
  vatId: string | null;
  bankName: string | null;
  iban: string | null;
  bic: string | null;
  accountHolder: string | null;
  footer: string | null;
  logoDataUrl: string | null;
}

export interface InvoiceSettings extends SenderSnapshot {
  paymentTermDays: number;
  /** Platzhalter: {YYYY}, {YY}, {#…} (Anzahl # = Stellen). */
  numberFormat: string;
  taxRateBp: number;
  /** Wird bei 0 % gedruckt, z. B. Kleinunternehmerregelung. */
  taxExemptNote: string;
  autoDraftOnFinish: boolean;
  introText: string;
}

export interface HistoryEntry {
  id: number;
  entity: 'order' | 'part' | 'invoice';
  entityId: number;
  orderId: number | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  message: string;
  at: string;
}

export interface MasterData {
  processes: Process[];
  machines: Machine[];
  materials: Material[];
  discounts: CustomerDiscount[];
}
