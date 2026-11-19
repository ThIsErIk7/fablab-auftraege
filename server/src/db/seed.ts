// Startwerte für Stammdaten und Beispielaufträge.
// ALLE PREISE SIND BEISPIELWERTE – bitte unter Admin → Preise an die echte Preisliste anpassen.
import { addDaysIso, todayIso } from '@fablab/shared';
import type { InvoiceSettings, MaterialUnit } from '@fablab/shared';
import type { DB } from './connection.ts';
import { tx } from './connection.ts';
import { createOrder, updatePart } from '../repos/orders.ts';
import { DEFAULT_INVOICE_SETTINGS, saveInvoiceSettings } from '../repos/settings.ts';
import { addItem, createDraftFromOrder, issueInvoice, updateDraft } from '../services/invoices.ts';

type MachineSeed = [name: string, hourlyEuro: number, flatEuro: number];
/** Preis in € pro Einheit (g, ml, m², Platte, Stück) */
type MaterialSeed = [name: string, unit: MaterialUnit, priceEuroPerUnit: number];

const MASTER: { process: string; machines: MachineSeed[]; materials: MaterialSeed[] }[] = [
  {
    process: '3D-Druck FDM',
    machines: [
      ['3D FDM Druck Prusa', 2, 0],
      ['3D Drucker Bambu Lab H2D', 3, 0],
      ['3D Drucker MBL 136', 4, 0],
      ['3D Drucker FDM Karbon', 5, 0],
      ['3D FDM Reinforced Drucker', 5, 0],
    ],
    materials: [
      ['PLA', 'g', 0.03],
      ['PETG', 'g', 0.035],
      ['ABS/ASA', 'g', 0.04],
      ['TPU', 'g', 0.06],
      ['Carbon-/faserverstärkt', 'g', 0.12],
    ],
  },
  {
    process: '3D-Druck SLA',
    machines: [['3D SLA Drucker', 3, 2]],
    materials: [['Standard-Resin', 'ml', 0.15], ['Tough-Resin', 'ml', 0.2]],
  },
  {
    process: '3D-Druck SLS',
    machines: [
      ['3D SLS Drucker Fuse1+ 30W', 8, 10],
      ['3D SLS Drucker', 8, 10],
    ],
    materials: [['Nylon PA12', 'g', 0.15], ['Nylon PA11', 'g', 0.17]],
  },
  {
    process: 'Lasercutten/Gravieren',
    machines: [
      ['Muse Lasercutter', 12, 0],
      ['BRM Lasercutter', 15, 0],
    ],
    materials: [
      ['Holz', 'platte', 4],
      ['Kunststoff/Acryl', 'm2', 60],
      ['Gummi', 'm2', 40],
      ['Leder', 'm2', 50],
      ['Textilien', 'm2', 20],
      ['Metall (Gravur)', 'stueck', 0],
    ],
  },
  {
    process: 'Schneideplotter',
    machines: [['Schneideplotter', 6, 0]],
    materials: [['Folie', 'm2', 15], ['Flexfolie (Textil)', 'm2', 30], ['Papier/Karton', 'stueck', 0.5]],
  },
  {
    process: 'CNC-Fräsen',
    machines: [['CNC Handfräse (Shaper Origin)', 15, 0]],
    materials: [['Holz', 'platte', 12], ['Kunststoff', 'platte', 18]],
  },
  {
    process: '3D-Scannen',
    machines: [
      ['Peel 3D Scanner', 20, 0],
      ['360-3D Scanner', 15, 0],
      ['3D Scanner Kamera', 10, 0],
      ['3D-Handscanner', 15, 0],
    ],
    materials: [],
  },
];

const cents = (euro: number) => Math.round(euro * 100);
const mills = (euro: number) => Math.round(euro * 1000);

export function seedMasterData(db: DB) {
  tx(db, () => {
    MASTER.forEach((group, pi) => {
      const pid = Number(db.prepare('INSERT INTO processes (name, sort) VALUES (?, ?)').run(group.process, pi).lastInsertRowid);
      group.machines.forEach(([name, h, f], i) =>
        db.prepare('INSERT INTO machines (process_id, name, hourly_rate_cents, job_flat_cents, sort) VALUES (?, ?, ?, ?, ?)')
          .run(pid, name, cents(h), cents(f), i));
      group.materials.forEach(([name, unit, price], i) =>
        db.prepare('INSERT INTO materials (process_id, name, unit, price_mills, sort) VALUES (?, ?, ?, ?, ?)')
          .run(pid, name, unit, mills(price), i));
    });
    const disc = db.prepare('INSERT INTO customer_discounts (customer_type, percent_bp, label) VALUES (?, ?, ?)');
    disc.run('privat', 0, '');
    disc.run('firma', 0, '');
    disc.run('hochschule', 2000, 'Hochschulrabatt (Studierende/Lehre)');
    disc.run('intern', 10000, 'Interne Projekte');
  });
}

export const SEED_SETTINGS: InvoiceSettings = {
  ...DEFAULT_INVOICE_SETTINGS,
  name: 'FabLab Kiel – opencampus.sh',
  address: 'Fraunhoferstr. 2–4\n24118 Kiel',
  email: 'fablab@example.org',
  website: 'opencampus.sh',
  // Beispielwerte – vor dem echten Einsatz in den Einstellungen ersetzen!
  taxNumber: '00/000/00000 (Beispiel)',
  bankName: 'Beispielbank',
  iban: 'DE00 0000 0000 0000 0000 00',
  bic: 'XXXXDEXXXXX',
  accountHolder: 'opencampus.sh',
  footer: 'FabLab Kiel – offene Hightech-Werkstatt von opencampus.sh',
  paymentTermDays: 14,
  numberFormat: 'FL-{YYYY}-{####}',
  taxRateBp: 1900,
  taxExemptNote: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
  autoDraftOnFinish: false,
};

const id = (db: DB, table: string, name: string) =>
  (db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name) as { id: number }).id;

export function seedExamples(db: DB) {
  saveInvoiceSettings(db, SEED_SETTINGS);
  const today = todayIso();
  const fdm = id(db, 'processes', '3D-Druck FDM');
  const laser = id(db, 'processes', 'Lasercutten/Gravieren');
  const bambu = id(db, 'machines', '3D Drucker Bambu Lab H2D');
  const prusa = id(db, 'machines', '3D FDM Druck Prusa');
  const muse = id(db, 'machines', 'Muse Lasercutter');
  const mat = (proc: number, name: string) =>
    (db.prepare('SELECT id FROM materials WHERE process_id = ? AND name = ?').get(proc, name) as { id: number }).id;

  // 1) Firma – in Bearbeitung, teilweise erledigt
  createOrder(db, {
    title: 'Gehäuse für Sensor-Prototyp', customerName: 'Lena Beispiel', contact: 'lena@beispiel-sensorik.de',
    customerType: 'firma', billToName: 'Beispiel Sensorik GmbH', billToAddress: 'Musterweg 5\n24103 Kiel',
    customerVatId: 'DE000000000', noBilling: false, dueDate: addDaysIso(today, 3), priority: 'hoch',
    status: 'in_bearbeitung', notes: 'Passgenauigkeit Deckel prüfen.', assignee: 'Alex',
  }, [
    { name: 'Gehäuse Unterteil', quantity: 2, processId: fdm, machineId: bambu, materialId: mat(fdm, 'PETG'), materialText: null, color: 'Schwarz', dimW: 120, dimD: 80, dimH: 35, fileRef: 'gehaeuse_unten.3mf', estMinutes: 180, actualMinutes: 165, materialAmount: 96, status: 'fertig', done: true, notes: null },
    { name: 'Gehäuse Deckel', quantity: 2, processId: fdm, machineId: bambu, materialId: mat(fdm, 'PETG'), materialText: null, color: 'Schwarz', dimW: 120, dimD: 80, dimH: 8, fileRef: 'gehaeuse_deckel.3mf', estMinutes: 70, actualMinutes: null, materialAmount: null, status: 'in_arbeit', done: false, notes: null },
    { name: 'Frontblende Acryl', quantity: 2, processId: laser, machineId: muse, materialId: mat(laser, 'Kunststoff/Acryl'), materialText: null, color: 'Transparent', dimW: 118, dimD: 30, dimH: 3, fileRef: 'blende.svg', estMinutes: 10, actualMinutes: null, materialAmount: 0.01, status: 'offen', done: false, notes: 'Logo gravieren' },
  ]);

  // 2) Hochschule – neu
  createOrder(db, {
    title: 'Namensschilder für Workshop', customerName: 'Dr. Jonas Muster', contact: '0431 000000',
    customerType: 'hochschule', billToName: 'Beispiel-Hochschule, Institut für Gestaltung', billToAddress: 'Campusallee 1\n24098 Kiel',
    customerVatId: null, noBilling: false, dueDate: addDaysIso(today, 10), priority: 'normal', status: 'neu',
    notes: '30 Teilnehmende', assignee: null,
  }, [
    { name: 'Namensschild Holz graviert', quantity: 30, processId: laser, machineId: muse, materialId: mat(laser, 'Holz'), materialText: null, color: null, dimW: 80, dimD: 30, dimH: 3, fileRef: 'schilder.svg', estMinutes: 45, actualMinutes: null, materialAmount: 2, status: 'offen', done: false, notes: null },
    { name: 'Halter für Schilder', quantity: 30, processId: fdm, machineId: prusa, materialId: mat(fdm, 'PLA'), materialText: null, color: 'Weiß', dimW: 40, dimD: 20, dimH: 15, fileRef: 'halter.stl', estMinutes: 240, actualMinutes: null, materialAmount: 180, status: 'offen', done: false, notes: null },
  ]);

  // 3) Privat – abgeholt, mit gestellter Rechnung
  const o3 = createOrder(db, {
    title: 'Ersatzteil Fahrradhalterung', customerName: 'Max Mustermann', contact: 'max@example.org',
    customerType: 'privat', billToName: null, billToAddress: 'Beispielstraße 12\n24114 Kiel', customerVatId: null,
    noBilling: false, dueDate: addDaysIso(today, -7), priority: 'normal', status: 'neu', notes: null, assignee: 'Alex',
  }, [
    { name: 'Lenkerhalterung', quantity: 1, processId: fdm, machineId: prusa, materialId: mat(fdm, 'PETG'), materialText: null, color: 'Grau', dimW: 60, dimD: 40, dimH: 30, fileRef: 'halterung_v3.stl', estMinutes: 120, actualMinutes: 130, materialAmount: 42, status: 'offen', done: false, notes: null },
  ]);
  for (const p of o3.parts) updatePart(db, p.id, { done: true });
  db.prepare("UPDATE orders SET status = 'fertig' WHERE id = ?").run(o3.id);
  const { invoice } = createDraftFromOrder(db, o3.id);
  updateDraft(db, invoice.id, { serviceFrom: addDaysIso(today, -8), serviceTo: addDaysIso(today, -6) });
  addItem(db, invoice.id, { description: 'Betreuung / Druckvorbereitung', quantity: 0.5, unit: 'h', unitPriceMills: 30000, discountBp: 0, partId: null });
  issueInvoice(db, invoice.id, { invoiceDate: addDaysIso(today, -5) });
  db.prepare("UPDATE orders SET status = 'abgeholt' WHERE id = ?").run(o3.id);

  // 4) Intern – nicht abrechnen
  createOrder(db, {
    title: 'Messe-Display opencampus', customerName: 'opencampus.sh Team', contact: null, customerType: 'intern',
    billToName: null, billToAddress: null, customerVatId: null, noBilling: true, dueDate: addDaysIso(today, -1),
    priority: 'niedrig', status: 'in_bearbeitung', notes: 'Internes Projekt – nicht abrechnen.', assignee: null,
  }, [
    { name: 'Logo-Aufsteller', quantity: 1, processId: laser, machineId: id(db, 'machines', 'BRM Lasercutter'), materialId: mat(laser, 'Holz'), materialText: null, color: null, dimW: 600, dimD: 400, dimH: 6, fileRef: 'logo_aufsteller.dxf', estMinutes: 40, actualMinutes: null, materialAmount: 1, status: 'offen', done: false, notes: null },
  ]);

}

export function seedAll(db: DB) {
  seedMasterData(db);
  seedExamples(db);
}

export function isEmpty(db: DB) {
  return (db.prepare('SELECT COUNT(*) AS n FROM processes').get() as { n: number }).n === 0;
}
