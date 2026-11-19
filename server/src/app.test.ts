import { describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { openDb } from './db/connection.ts';
import { seedAll } from './db/seed.ts';

describe('API: Teil-Updates verändern nur gesendete Felder', () => {
  it('Abhaken behält Anzahl, setzt Status Fertig; Maschine deaktivieren behält Preise', async () => {
    const db = openDb(':memory:');
    seedAll(db);
    const app = buildApp(db);
    const order = (await app.inject({ method: 'GET', url: '/api/orders/1' })).json();
    const part = order.parts.find((p: any) => p.quantity === 2 && !p.done);

    const r = await app.inject({ method: 'PATCH', url: `/api/parts/${part.id}`, payload: { done: true } });
    expect(r.statusCode).toBe(200);
    expect(r.json().part).toMatchObject({ quantity: 2, done: true, status: 'fertig', machineId: part.machineId });

    const m = (await app.inject({ method: 'GET', url: '/api/masterdata' })).json().machines[1];
    const r2 = await app.inject({ method: 'PATCH', url: `/api/machines/${m.id}`, payload: { active: false } });
    expect(r2.json()).toMatchObject({ active: false, hourlyRateCents: m.hourlyRateCents, jobFlatCents: m.jobFlatCents });

    const r3 = await app.inject({ method: 'PATCH', url: '/api/orders/1', payload: { notes: 'neu' } });
    expect(r3.json()).toMatchObject({ notes: 'neu', priority: 'hoch', customerType: 'firma', status: 'in_bearbeitung' });
  });
});
