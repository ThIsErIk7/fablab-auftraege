import { describe, expect, it } from 'vitest';
import { autoMapColumns, collectUnknowns, parseCsvText, validateRows } from '@fablab/shared/import';
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

describe('API: Import mit Regel-Erkennung', () => {
  it('speichert eine unsaubere Tabelle mit Vorschlägen + einer manuellen Entscheidung korrekt', async () => {
    const db = openDb(':memory:');
    seedAll(db);
    const app = buildApp(db);
    const csv = [
      'Teil;Menge;Gerät;Werkstoff;Datei;Dauer',
      'Halterung Kamera;4;Bambu;PETG schwarz;halter.3mf;1:30',
      'Türschild;10;;Plexiglas 3mm;schild.svg;0:20',
      'Zahnrad;2;Prusa MK4;PLA+;zahnrad.stl;45',
      'Figur;1;;Grey Resin;figur.stl;3 h',
      'Gehäuse;2;Bamboo X1;PLA;gehaeuse.stl;2:10',
      'Rahmen;1;Lasercutter;Pappelsperrholz;rahmen.dxf;0:15',
      'Aufkleber;50;Cricut;Vinyl;logo.svg;',
    ].join('\n');
    const t = parseCsvText(csv);
    const mapping = autoMapColumns(t.headers);
    const md = (await app.inject({ method: 'GET', url: '/api/masterdata' })).json();
    // Wie die Oberfläche: sichere/wahrscheinliche Vorschläge übernehmen, Unsicheres manuell entscheiden
    const u = collectUnknowns(validateRows(t.rows, mapping, md), md);
    const machines: Record<string, any> = {};
    for (const x of u.machines) if (x.suggestion && x.suggestion.confidence !== 'niedrig') machines[x.key] = { action: 'map', id: x.suggestion.id };
    const brm = md.machines.find((m: any) => m.name === 'BRM Lasercutter').id;
    machines['lasercutter'] = { action: 'map', id: brm };

    const r = await app.inject({ method: 'POST', url: '/api/import/commit', payload: {
      target: { newOrder: { title: 'Import-Test', customerName: 'Kim' } }, mapping, rows: t.rows,
      resolutions: { processes: {}, machines }, skipRows: [],
    } });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().imported).toBe(7);

    const order = (await app.inject({ method: 'GET', url: `/api/orders/${r.json().orderId}` })).json();
    const name = (list: any[], id: number | null) => list.find((x) => x.id === id)?.name ?? null;
    const got = order.parts.map((p: any) => [p.name, name(md.machines, p.machineId), name(md.processes, p.processId), name(md.materials, p.materialId), p.color, p.estMinutes]);
    expect(got).toEqual([
      ['Halterung Kamera', '3D Drucker Bambu Lab H2D', '3D-Druck FDM', 'PETG', 'schwarz', 90],
      ['Türschild', null, 'Lasercutten/Gravieren', 'Kunststoff/Acryl', null, 20],
      ['Zahnrad', '3D FDM Druck Prusa', '3D-Druck FDM', 'PLA', null, 45],
      ['Figur', '3D SLA Drucker', '3D-Druck SLA', 'Standard-Resin', null, 180],
      ['Gehäuse', '3D Drucker Bambu Lab H2D', '3D-Druck FDM', 'PLA', null, 130],
      ['Rahmen', 'BRM Lasercutter', 'Lasercutten/Gravieren', 'Holz', null, 15],
      ['Aufkleber', 'Schneideplotter', 'Schneideplotter', 'Folie', null, null],
    ]);
  });
});
