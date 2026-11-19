// Migrationen werden in Reihenfolge genau einmal ausgeführt (Tabelle schema_migrations).
// Neue Änderungen immer als neuen Eintrag anhängen, bestehende nie verändern.
// Geldbeträge: INTEGER in Cent. Prozentsätze: INTEGER in Basispunkten (1900 = 19 %).

import type { DB } from './connection.ts';
import { applyDefaultAliases } from './aliases.ts';

export const MIGRATIONS: { id: number; name: string; sql: string; foreignKeysOff?: boolean; run?: (db: DB) => void }[] = [
  {
    id: 1,
    name: 'grundschema',
    sql: /* sql */ `
CREATE TABLE processes (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active  INTEGER NOT NULL DEFAULT 1,
  sort    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE machines (
  id                 INTEGER PRIMARY KEY,
  process_id         INTEGER NOT NULL REFERENCES processes(id),
  name               TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active             INTEGER NOT NULL DEFAULT 1,
  note               TEXT,
  hourly_rate_cents  INTEGER NOT NULL DEFAULT 0 CHECK (hourly_rate_cents >= 0),
  job_flat_cents     INTEGER NOT NULL DEFAULT 0 CHECK (job_flat_cents >= 0),
  sort               INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE materials (
  id           INTEGER PRIMARY KEY,
  process_id   INTEGER NOT NULL REFERENCES processes(id),
  name         TEXT NOT NULL COLLATE NOCASE,
  unit         TEXT NOT NULL CHECK (unit IN ('g','m2','platte','stueck')),
  price_cents  INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  active       INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (process_id, name)
);

CREATE TABLE customer_discounts (
  customer_type TEXT PRIMARY KEY CHECK (customer_type IN ('privat','firma','hochschule','intern')),
  percent_bp    INTEGER NOT NULL DEFAULT 0 CHECK (percent_bp BETWEEN 0 AND 10000),
  label         TEXT NOT NULL DEFAULT ''
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL  -- JSON
);

CREATE TABLE orders (
  id               INTEGER PRIMARY KEY,
  title            TEXT NOT NULL,
  customer_name    TEXT NOT NULL,
  contact          TEXT,
  customer_type    TEXT NOT NULL DEFAULT 'privat' CHECK (customer_type IN ('privat','firma','hochschule','intern')),
  bill_to_name     TEXT,
  bill_to_address  TEXT,
  customer_vat_id  TEXT,
  no_billing       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  due_date         TEXT,
  priority         TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('niedrig','normal','hoch')),
  status           TEXT NOT NULL DEFAULT 'neu' CHECK (status IN ('neu','in_bearbeitung','fertig','abgeholt','storniert')),
  notes            TEXT,
  assignee         TEXT
);
CREATE INDEX idx_orders_status ON orders(status);

CREATE TABLE parts (
  id               INTEGER PRIMARY KEY,
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  quantity         INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  process_id       INTEGER REFERENCES processes(id),
  machine_id       INTEGER REFERENCES machines(id),
  material_id      INTEGER REFERENCES materials(id),
  material_text    TEXT,
  color            TEXT,
  dim_w            REAL,
  dim_d            REAL,
  dim_h            REAL,
  file_ref         TEXT,
  est_minutes      INTEGER,
  actual_minutes   INTEGER,
  material_amount  REAL,
  status           TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','in_arbeit','fertig','fehlgeschlagen')),
  done             INTEGER NOT NULL DEFAULT 0,
  notes            TEXT,
  sort             INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_parts_order ON parts(order_id);
CREATE INDEX idx_parts_machine ON parts(machine_id);

CREATE TABLE invoices (
  id                  INTEGER PRIMARY KEY,
  number              TEXT UNIQUE,                 -- erst beim Stellen vergeben
  order_id            INTEGER REFERENCES orders(id) ON DELETE RESTRICT,
  type                TEXT NOT NULL DEFAULT 'rechnung' CHECK (type IN ('rechnung','storno')),
  cancels_invoice_id  INTEGER REFERENCES invoices(id),
  status              TEXT NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','gestellt','bezahlt','storniert')),
  invoice_date        TEXT,
  service_from        TEXT,
  service_to          TEXT,
  due_date            TEXT,
  net_cents           INTEGER NOT NULL DEFAULT 0,
  tax_rate_bp         INTEGER NOT NULL DEFAULT 0,
  tax_cents           INTEGER NOT NULL DEFAULT 0,
  gross_cents         INTEGER NOT NULL DEFAULT 0,
  tax_exempt_note     TEXT,
  recipient_json      TEXT NOT NULL,               -- {name, address, vatId}
  sender_json         TEXT,                        -- Absender-Snapshot beim Stellen
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  issued_at           TEXT,
  paid_at             TEXT,
  CHECK (status = 'entwurf' OR number IS NOT NULL)
);
CREATE INDEX idx_invoices_order ON invoices(order_id);

CREATE TABLE invoice_items (
  id                INTEGER PRIMARY KEY,
  invoice_id        INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  part_id           INTEGER REFERENCES parts(id) ON DELETE SET NULL,
  description       TEXT NOT NULL,
  quantity          REAL NOT NULL,
  unit              TEXT NOT NULL DEFAULT 'Stk.',
  unit_price_cents  INTEGER NOT NULL,
  discount_bp       INTEGER NOT NULL DEFAULT 0,
  total_cents       INTEGER NOT NULL,
  sort              INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_items_invoice ON invoice_items(invoice_id);

-- Lückenlose Nummernkreise: Zähler wird nur beim Stellen (in derselben Transaktion) erhöht.
CREATE TABLE invoice_counters (
  counter_key  INTEGER PRIMARY KEY,   -- Jahr oder 0 für durchgehende Zählung
  last_value   INTEGER NOT NULL
);

CREATE TABLE history (
  id         INTEGER PRIMARY KEY,
  entity     TEXT NOT NULL CHECK (entity IN ('order','part','invoice')),
  entity_id  INTEGER NOT NULL,
  order_id   INTEGER,
  field      TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  message    TEXT NOT NULL,
  at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_history_entity ON history(entity, entity_id);
CREATE INDEX idx_history_order ON history(order_id);

-- Unveränderlichkeit gestellter Rechnungen, unabhängig vom Anwendungscode abgesichert.
CREATE TRIGGER invoices_no_delete_issued BEFORE DELETE ON invoices
WHEN OLD.status <> 'entwurf'
BEGIN SELECT RAISE(ABORT, 'Gestellte Rechnungen können nicht gelöscht werden.'); END;

CREATE TRIGGER invoices_no_edit_issued BEFORE UPDATE ON invoices
WHEN OLD.status <> 'entwurf' AND (
     NEW.number IS NOT OLD.number OR NEW.net_cents <> OLD.net_cents OR NEW.tax_cents <> OLD.tax_cents
  OR NEW.gross_cents <> OLD.gross_cents OR NEW.tax_rate_bp <> OLD.tax_rate_bp
  OR NEW.recipient_json IS NOT OLD.recipient_json OR NEW.sender_json IS NOT OLD.sender_json
  OR NEW.invoice_date IS NOT OLD.invoice_date OR NEW.service_from IS NOT OLD.service_from
  OR NEW.service_to IS NOT OLD.service_to OR NEW.due_date IS NOT OLD.due_date
  OR NEW.type IS NOT OLD.type OR NEW.order_id IS NOT OLD.order_id
  OR NEW.cancels_invoice_id IS NOT OLD.cancels_invoice_id OR NEW.status = 'entwurf')
BEGIN SELECT RAISE(ABORT, 'Gestellte Rechnungen können nicht geändert werden. Bitte Stornorechnung erstellen.'); END;

CREATE TRIGGER items_no_insert_issued BEFORE INSERT ON invoice_items
WHEN (SELECT status FROM invoices WHERE id = NEW.invoice_id) <> 'entwurf'
BEGIN SELECT RAISE(ABORT, 'Positionen gestellter Rechnungen sind gesperrt.'); END;

CREATE TRIGGER items_no_update_issued BEFORE UPDATE ON invoice_items
WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) <> 'entwurf'
  AND NOT (NEW.part_id IS NULL AND OLD.part_id IS NOT NULL
           AND NEW.description = OLD.description AND NEW.quantity = OLD.quantity
           AND NEW.unit_price_cents = OLD.unit_price_cents AND NEW.total_cents = OLD.total_cents
           AND NEW.discount_bp = OLD.discount_bp AND NEW.unit = OLD.unit)
BEGIN SELECT RAISE(ABORT, 'Positionen gestellter Rechnungen sind gesperrt.'); END;

CREATE TRIGGER items_no_delete_issued BEFORE DELETE ON invoice_items
WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) <> 'entwurf'
BEGIN SELECT RAISE(ABORT, 'Positionen gestellter Rechnungen sind gesperrt.'); END;
`,
  },
  {
    id: 2,
    name: 'preise_pro_einheit_in_zehntelcent',
    // Materialpreise gelten jetzt pro Einheit (€/g, €/ml …) und werden – wie Einzelpreise von
    // Rechnungspositionen – in Zehntelcent (1/1000 €) gespeichert. Beträge bleiben in Cent.
    // Bisherige g-Preise waren pro kg: 3000 ct/kg = 0,030 €/g = 30 Zehntelcent → Faktor 1/100.
    // Harz-Materialien von SLA-Verfahren werden auf ml umgestellt (Preis je Einheit bleibt).
    foreignKeysOff: true,
    sql: /* sql */ `
CREATE TABLE materials_new (
  id           INTEGER PRIMARY KEY,
  process_id   INTEGER NOT NULL REFERENCES processes(id),
  name         TEXT NOT NULL COLLATE NOCASE,
  unit         TEXT NOT NULL CHECK (unit IN ('g','ml','m2','platte','stueck')),
  price_mills  INTEGER NOT NULL DEFAULT 0 CHECK (price_mills >= 0),
  active       INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (process_id, name)
);
INSERT INTO materials_new (id, process_id, name, unit, price_mills, active, sort)
SELECT m.id, m.process_id, m.name,
  CASE WHEN m.unit = 'g' AND p.name LIKE '%SLA%' THEN 'ml' ELSE m.unit END,
  CASE WHEN m.unit = 'g' THEN CAST(ROUND(m.price_cents / 100.0) AS INTEGER) ELSE m.price_cents * 10 END,
  m.active, m.sort
FROM materials m JOIN processes p ON p.id = m.process_id;
DROP TABLE materials;
ALTER TABLE materials_new RENAME TO materials;

DROP TRIGGER items_no_insert_issued;
DROP TRIGGER items_no_update_issued;
DROP TRIGGER items_no_delete_issued;
CREATE TABLE invoice_items_new (
  id                INTEGER PRIMARY KEY,
  invoice_id        INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  part_id           INTEGER REFERENCES parts(id) ON DELETE SET NULL,
  description       TEXT NOT NULL,
  quantity          REAL NOT NULL,
  unit              TEXT NOT NULL DEFAULT 'Stk.',
  unit_price_mills  INTEGER NOT NULL,
  discount_bp       INTEGER NOT NULL DEFAULT 0,
  total_cents       INTEGER NOT NULL,
  sort              INTEGER NOT NULL DEFAULT 0
);
INSERT INTO invoice_items_new (id, invoice_id, part_id, description, quantity, unit, unit_price_mills, discount_bp, total_cents, sort)
SELECT id, invoice_id, part_id, description, quantity, unit, unit_price_cents * 10, discount_bp, total_cents, sort FROM invoice_items;
DROP TABLE invoice_items;
ALTER TABLE invoice_items_new RENAME TO invoice_items;
CREATE INDEX idx_items_invoice ON invoice_items(invoice_id);

CREATE TRIGGER items_no_insert_issued BEFORE INSERT ON invoice_items
WHEN (SELECT status FROM invoices WHERE id = NEW.invoice_id) <> 'entwurf'
BEGIN SELECT RAISE(ABORT, 'Positionen gestellter Rechnungen sind gesperrt.'); END;

CREATE TRIGGER items_no_update_issued BEFORE UPDATE ON invoice_items
WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) <> 'entwurf'
  AND NOT (NEW.part_id IS NULL AND OLD.part_id IS NOT NULL
           AND NEW.description = OLD.description AND NEW.quantity = OLD.quantity
           AND NEW.unit_price_mills = OLD.unit_price_mills AND NEW.total_cents = OLD.total_cents
           AND NEW.discount_bp = OLD.discount_bp AND NEW.unit = OLD.unit)
BEGIN SELECT RAISE(ABORT, 'Positionen gestellter Rechnungen sind gesperrt.'); END;

CREATE TRIGGER items_no_delete_issued BEFORE DELETE ON invoice_items
WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) <> 'entwurf'
BEGIN SELECT RAISE(ABORT, 'Positionen gestellter Rechnungen sind gesperrt.'); END;
`,
  },
  {
    id: 3,
    name: 'alternativnamen_fuer_import',
    // Alternative Bezeichnungen (kommagetrennt) für die automatische Zuordnung beim Import.
    sql: /* sql */ `
ALTER TABLE processes ADD COLUMN aliases TEXT NOT NULL DEFAULT '';
ALTER TABLE machines  ADD COLUMN aliases TEXT NOT NULL DEFAULT '';
ALTER TABLE materials ADD COLUMN aliases TEXT NOT NULL DEFAULT '';
`,
    run: applyDefaultAliases,
  },
];
