// npm run seed      → legt Stammdaten + Beispiele an, falls die DB leer ist
// npm run reset-db  → löscht die Datenbank und legt sie neu an
import { existsSync, rmSync } from 'node:fs';
import { DEFAULT_DB_PATH, openDb } from './connection.ts';
import { isEmpty, seedAll } from './seed.ts';

if (process.argv.includes('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(DEFAULT_DB_PATH + suffix)) rmSync(DEFAULT_DB_PATH + suffix);
  }
  console.log(`Datenbank gelöscht: ${DEFAULT_DB_PATH}`);
}
const db = openDb();
if (isEmpty(db)) {
  seedAll(db);
  console.log('Stammdaten und Beispieldaten angelegt.');
} else {
  console.log('Datenbank enthält bereits Daten – Seed übersprungen. (Neu anlegen: npm run reset-db)');
}
db.close();
