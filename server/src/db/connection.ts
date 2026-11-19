import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations.ts';

export type DB = DatabaseSync;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEFAULT_DB_PATH = process.env.DB_PATH ?? resolve(ROOT, 'data/fablab.db');

export function openDb(path: string = DEFAULT_DB_PATH): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db: DB) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)');
  const done = new Set((db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    // Tabellen-Umbauten (neu anlegen, kopieren, umbenennen) brauchen foreign_keys=OFF außerhalb der Transaktion.
    if (m.foreignKeysOff) db.exec('PRAGMA foreign_keys = OFF');
    try {
      tx(db, () => {
        db.exec(m.sql);
        if (m.foreignKeysOff) {
          const broken = db.prepare('PRAGMA foreign_key_check').all();
          if (broken.length) throw new Error(`Migration ${m.id}: Fremdschlüssel verletzt (${broken.length})`);
        }
        db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, datetime('now'))").run(m.id, m.name);
      });
    } finally {
      if (m.foreignKeysOff) db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

let depth = 0;
/** Transaktion (verschachtelbar über Savepoints). Bei Fehler wird alles zurückgerollt. */
export function tx<T>(db: DB, fn: () => T): T {
  const sp = `sp${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth++;
  try {
    const result = fn();
    depth--;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return result;
  } catch (e) {
    depth--;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}

export const nowIso = () => new Date().toISOString();
