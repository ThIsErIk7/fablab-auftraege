import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../db/connection.ts';
import { SEED_SETTINGS, seedMasterData } from '../db/seed.ts';
import { createOrder, getOrder, setOrderStatus, updatePart } from '../repos/orders.ts';
import { saveInvoiceSettings } from '../repos/settings.ts';
import {
  addItem, cancelInvoice, createDraftFromOrder, deleteDraft, getInvoice, issueInvoice, listInvoices, markPaid,
  onOrderStatusChanged, updateItem,
} from './invoices.ts';

let db: DB;
const baseOrder = {
  title: 'Test', customerName: 'Kim Test', contact: null, customerType: 'privat' as const, billToName: null,
  billToAddress: 'Teststr. 1\n24103 Kiel', customerVatId: null, noBilling: false, dueDate: null,
  priority: 'normal' as const, status: 'neu' as const, notes: null, assignee: null,
};
const machineId = () => (db.prepare("SELECT id FROM machines WHERE name = '3D FDM Druck Prusa'").get() as any).id;
const pla = () => (db.prepare("SELECT id FROM materials WHERE name = 'PLA'").get() as any).id;

function newOrder(extra: Partial<Omit<typeof baseOrder, 'billToAddress'>> & { billToAddress?: string | null } = {}) {
  return createOrder(db, { ...baseOrder, ...extra }, [{
    name: 'Würfel', quantity: 1, processId: null, machineId: machineId(), materialId: pla(), materialText: null, color: null,
    dimW: null, dimD: null, dimH: null, fileRef: null, estMinutes: 60, actualMinutes: 90, materialAmount: 100,
    status: 'offen', notes: null,
  }]);
}
function issuedInvoice(date?: string) {
  const o = newOrder();
  const { invoice } = createDraftFromOrder(db, o.id);
  return issueInvoice(db, invoice.id, date ? { invoiceDate: date } : {});
}

beforeEach(() => {
  db = openDb(':memory:');
  seedMasterData(db);
  saveInvoiceSettings(db, SEED_SETTINGS);
});

describe('Rechnungsentwurf', () => {
  it('berechnet Positionen aus den Teilen (Prusa 2 €/h, PLA 0,03 €/g)', () => {
    const o = newOrder();
    expect(getOrder(db, o.id).parts[0].processId).not.toBeNull(); // Verfahren aus Maschine ergänzt
    const { invoice } = createDraftFromOrder(db, o.id);
    expect(invoice.status).toBe('entwurf');
    expect(invoice.number).toBeNull();
    expect(invoice.items.map((i) => i.totalCents)).toEqual([300, 300]);
    expect(invoice).toMatchObject({ netCents: 600, taxCents: 114, grossCents: 714 });
  });
  it('verweigert "nicht abrechnen" und doppelte Entwürfe', () => {
    expect(() => createDraftFromOrder(db, newOrder({ noBilling: true }).id)).toThrow(/nicht abrechnen/);
    const o = newOrder();
    createDraftFromOrder(db, o.id);
    expect(() => createDraftFromOrder(db, o.id)).toThrow(/bereits/);
  });
  it('Positionen im Entwurf änderbar, Summen werden neu berechnet', () => {
    const { invoice } = createDraftFromOrder(db, newOrder().id);
    const inv = updateItem(db, invoice.items[0].id, { unitPriceMills: 10000, discountBp: 5000 }); // 1,5 h × 10 € − 50 %
    expect(inv.items[0].totalCents).toBe(750);
    expect(inv.netCents).toBe(1050);
  });
});

describe('Rechnungsnummern', () => {
  it('vergibt fortlaufend und lückenlos – Entwürfe verbrauchen keine Nummer', () => {
    const a = issuedInvoice('2026-03-01');
    const draft = createDraftFromOrder(db, newOrder().id).invoice;
    deleteDraft(db, draft.id); // verworfener Entwurf
    const b = issuedInvoice('2026-03-02');
    expect([a.number, b.number]).toEqual(['FL-2026-0001', 'FL-2026-0002']);
  });
  it('fehlgeschlagenes Stellen verbraucht keine Nummer (Rollback)', () => {
    const a = issuedInvoice('2026-03-01');
    const o = newOrder({ billToAddress: null });
    const { invoice } = createDraftFromOrder(db, o.id);
    expect(() => issueInvoice(db, invoice.id, { invoiceDate: '2026-03-02' })).toThrow(/Anschrift/);
    const b = issuedInvoice('2026-03-03');
    expect(a.number).toBe('FL-2026-0001');
    expect(b.number).toBe('FL-2026-0002');
  });
  it('beginnt jedes Jahr neu', () => {
    issuedInvoice('2026-12-30');
    expect(issuedInvoice('2027-01-02').number).toBe('FL-2027-0001');
  });
  it('setzt Fälligkeit aus Zahlungsziel', () => {
    expect(issuedInvoice('2026-03-01').dueDate).toBe('2026-03-15');
  });
  it('verlangt Pflichtangaben vor dem Stellen', () => {
    saveInvoiceSettings(db, { ...SEED_SETTINGS, taxNumber: null, vatId: null });
    const { invoice } = createDraftFromOrder(db, newOrder().id);
    expect(() => issueInvoice(db, invoice.id)).toThrow(/Steuernummer/);
  });
  it('0 % USt. braucht einen Hinweistext', () => {
    saveInvoiceSettings(db, { ...SEED_SETTINGS, taxRateBp: 0, taxExemptNote: '' });
    const { invoice } = createDraftFromOrder(db, newOrder().id);
    expect(() => issueInvoice(db, invoice.id)).toThrow(/Steuerbefreiung/);
  });
});

describe('Gestellte Rechnungen', () => {
  it('sind über Service und Datenbank-Trigger gesperrt', () => {
    const inv = issuedInvoice();
    expect(() => addItem(db, inv.id, { description: 'X', quantity: 1, unit: 'Stk.', unitPriceMills: 1000, discountBp: 0, partId: null })).toThrow(/gesperrt/);
    expect(() => deleteDraft(db, inv.id)).toThrow(/gesperrt/);
    expect(() => db.prepare('UPDATE invoices SET net_cents = 1 WHERE id = ?').run(inv.id)).toThrow(/nicht geändert/);
    expect(() => db.prepare('DELETE FROM invoices WHERE id = ?').run(inv.id)).toThrow(/nicht gelöscht/);
    expect(() => db.prepare('UPDATE invoice_items SET total_cents = 1 WHERE invoice_id = ?').run(inv.id)).toThrow(/gesperrt/);
  });
  it('Storno erzeugt Gegenrechnung mit eigener Nummer und Verweis', () => {
    const inv = issuedInvoice('2026-03-01');
    const st = cancelInvoice(db, inv.id, 'Fehlerhafte Menge');
    expect(st).toMatchObject({ type: 'storno', cancelsInvoiceId: inv.id, cancelsNumber: inv.number, number: 'FL-2026-0002' });
    expect(st.grossCents).toBe(-inv.grossCents);
    expect(st.items.every((i) => i.totalCents <= 0)).toBe(true);
    expect(st.notes).toMatch(/FL-2026-0001/);
    const orig = getInvoice(db, inv.id);
    expect(orig.status).toBe('storniert');
    expect(orig.cancelledBy?.number).toBe('FL-2026-0002');
    expect(orig.grossCents).toBe(inv.grossCents); // Original unverändert
    expect(() => cancelInvoice(db, inv.id)).toThrow(/bereits storniert/);
  });
  it('als bezahlt markieren; überfällig wird abgeleitet', () => {
    const inv = issuedInvoice('2020-01-01');
    expect(getInvoice(db, inv.id).displayStatus).toBe('ueberfaellig');
    expect(listInvoices(db, { status: 'ueberfaellig' }).map((i) => i.id)).toEqual([inv.id]);
    expect(markPaid(db, inv.id).displayStatus).toBe('bezahlt');
  });
});

describe('Auftrag ↔ Teile ↔ Rechnung', () => {
  it('erstes Abhaken setzt Auftrag auf "In Bearbeitung" und schlägt "Fertig" vor', () => {
    const o = newOrder();
    const r = updatePart(db, o.parts[0].id, { done: true });
    expect(r.orderStatus).toBe('in_bearbeitung');
    expect(r.part.status).toBe('fertig');
    expect(r.suggestFinish).toBe(true);
  });
  it('verbietet ungültige Statuswechsel', () => {
    expect(() => setOrderStatus(db, newOrder().id, 'abgeholt')).toThrow(/nicht erlaubt/);
  });
  it('legt bei "Fertig" automatisch einen Entwurf an (wenn aktiviert, nicht bei "nicht abrechnen")', () => {
    saveInvoiceSettings(db, { ...SEED_SETTINGS, autoDraftOnFinish: true });
    const o = newOrder();
    const id = onOrderStatusChanged(db, o.id, setOrderStatus(db, o.id, 'fertig'));
    expect(id).not.toBeNull();
    const o2 = newOrder({ noBilling: true });
    expect(onOrderStatusChanged(db, o2.id, setOrderStatus(db, o2.id, 'fertig'))).toBeNull();
  });
});

describe('Migration 2 (Preise pro Einheit)', () => {
  it('rechnet alte kg-Preise auf €/g um, stellt SLA-Harz auf ml und behält gestellte Rechnungen bei', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const { MIGRATIONS } = await import('../db/migrations.ts');
    const { migrate } = await import('../db/connection.ts');
    const raw = new DatabaseSync(':memory:');
    raw.exec('PRAGMA foreign_keys = ON');
    raw.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)');
    raw.exec(MIGRATIONS[0].sql);
    raw.exec("INSERT INTO schema_migrations VALUES (1, 'grundschema', 'x')");
    raw.exec(`INSERT INTO processes (id, name) VALUES (1, '3D-Druck FDM'), (2, '3D-Druck SLA');
      INSERT INTO materials (id, process_id, name, unit, price_cents) VALUES (1, 1, 'PLA', 'g', 3000), (2, 2, 'Resin', 'g', 12000), (3, 1, 'Platte', 'platte', 400);
      INSERT INTO orders (id, title, customer_name) VALUES (1, 'A', 'B');
      INSERT INTO parts (id, order_id, name, material_id) VALUES (1, 1, 'T', 1);
      INSERT INTO invoices (id, order_id, recipient_json) VALUES (1, 1, '{}');
      INSERT INTO invoice_items (invoice_id, description, quantity, unit_price_cents, total_cents) VALUES (1, 'X', 2, 150, 300);
      UPDATE invoices SET status = 'gestellt', number = 'FL-1' WHERE id = 1;`);
    migrate(raw);
    expect(raw.prepare('SELECT name, unit, price_mills FROM materials ORDER BY id').all().map((r: any) => [r.name, r.unit, r.price_mills]))
      .toEqual([['PLA', 'g', 30], ['Resin', 'ml', 120], ['Platte', 'platte', 4000]]);
    expect((raw.prepare('SELECT unit_price_mills FROM invoice_items').get() as any).unit_price_mills).toBe(1500);
    expect(() => raw.prepare('UPDATE invoice_items SET total_cents = 1').run()).toThrow(/gesperrt/);
    expect((raw.prepare('SELECT material_id FROM parts').get() as any).material_id).toBe(1);
  });
});
