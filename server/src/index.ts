import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.ts';
import { openDb } from './db/connection.ts';
import { isEmpty, seedAll } from './db/seed.ts';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '127.0.0.1';

const db = openDb();
if (isEmpty(db)) {
  seedAll(db);
  console.log('Neue Datenbank: Stammdaten und Beispieldaten angelegt.');
}

const app = buildApp(db, { logger: process.env.NODE_ENV === 'production' });

// Im Produktivbetrieb liefert der Server auch das gebaute Frontend aus.
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Nicht gefunden.' });
    return reply.sendFile('index.html');
  });
}

const close = () => { app.close().finally(() => { db.close(); process.exit(0); }); };
process.on('SIGINT', close);
process.on('SIGTERM', close);

await app.listen({ port: PORT, host: HOST });
console.log(`API läuft auf http://${HOST}:${PORT}`);
