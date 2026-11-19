// Regel-Erkennung mit den echten Stammdaten (inkl. Standard-Alternativnamen)
import { beforeAll, describe, expect, it } from 'vitest';
import type { MasterData } from '@fablab/shared';
import { editDistance, fileExtension, inferFromContext, matchMachine, matchMaterial, matchProcess } from '@fablab/shared/matching';
import { autoMapColumns, collectUnknowns, validateRows } from '@fablab/shared/import';
import { openDb } from '../db/connection.ts';
import { seedMasterData } from '../db/seed.ts';
import { getMasterData } from '../repos/masterdata.ts';

let md: MasterData;
const machine = (id: number | null | undefined) => md.machines.find((m) => m.id === id)?.name;
const proc = (id: number | null | undefined) => md.processes.find((p) => p.id === id)?.name;
const mat = (id: number | null | undefined) => md.materials.find((m) => m.id === id)?.name;

beforeAll(() => {
  const db = openDb(':memory:');
  seedMasterData(db);
  md = getMasterData(db);
});

describe('Hilfsfunktionen', () => {
  it('Tippfehler-Distanz und Dateiendung', () => {
    expect(editDistance('bamboo', 'bambu')).toBe(2);
    expect(editDistance('prsua', 'prusa')).toBe(2);
    expect(fileExtension('Teile/gehaeuse_v2.STL')).toBe('stl');
    expect(fileExtension('plate_1.gcode.3mf')).toBe('gcode');
    expect(fileExtension('https://x.de/datei.svg?dl=1')).toBe('svg');
    expect(fileExtension('ohne-endung')).toBeNull();
  });
});

describe('Maschinen erkennen', () => {
  it.each([
    ['Bambu', '3D Drucker Bambu Lab H2D', 'hoch'],
    ['bambulab x1c', '3D Drucker Bambu Lab H2D', 'hoch'],
    ['Prusa MK4', '3D FDM Druck Prusa', 'hoch'],
    ['prusa', '3D FDM Druck Prusa', 'hoch'],
    ['Formlabs Form 4', '3D SLA Drucker', 'hoch'],
    ['Fuse 1+', '3D SLS Drucker Fuse1+ 30W', 'hoch'],
    ['Muse', 'Muse Lasercutter', 'hoch'],
    ['BRM Laser', 'BRM Lasercutter', 'hoch'],
    ['Shaper', 'CNC Handfräse (Shaper Origin)', 'hoch'],
    ['Cricut', 'Schneideplotter', 'hoch'],
    ['Markforged', '3D FDM Reinforced Drucker', 'hoch'],
  ])('„%s“ → %s', (text, expected, conf) => {
    const m = matchMachine(text, md);
    expect(machine(m?.id)).toBe(expected);
    expect(m?.confidence).toBe(conf);
  });
  it('Tippfehler „Bamboo Lab“ wird erkannt', () => {
    expect(machine(matchMachine('Bamboo Lab', md)?.id)).toBe('3D Drucker Bambu Lab H2D');
  });
  it('mehrdeutig „Lasercutter“ → nur niedrige Sicherheit, nennt Alternative', () => {
    const m = matchMachine('Lasercutter', md);
    expect(m?.confidence).toBe('niedrig');
    expect(m?.reason).toMatch(/auch möglich/);
  });
  it('Unsinn ergibt keinen Treffer', () => {
    expect(matchMachine('Kaffeemaschine', md)).toBeNull();
  });
});

describe('Verfahren und Material erkennen', () => {
  it.each([
    ['Lasern', 'Lasercutten/Gravieren'], ['Resin', '3D-Druck SLA'], ['FFF', '3D-Druck FDM'],
    ['Fräsen', 'CNC-Fräsen'], ['Folie plotten', 'Schneideplotter'], ['3D-Scan', '3D-Scannen'],
  ])('Verfahren „%s“ → %s', (t, e) => expect(proc(matchProcess(t, md)?.id)).toBe(e));

  it('Material über Alternativnamen, im richtigen Verfahren', () => {
    const fdm = md.processes.find((p) => p.name === '3D-Druck FDM')!.id;
    const laser = md.processes.find((p) => p.name === 'Lasercutten/Gravieren')!.id;
    expect(mat(matchMaterial('PET-G', md, fdm)?.id)).toBe('PETG');
    expect(mat(matchMaterial('PLA-CF', md, fdm)?.id)).toBe('Carbon-/faserverstärkt');
    expect(mat(matchMaterial('Plexiglas', md, laser)?.id)).toBe('Kunststoff/Acryl');
    expect(mat(matchMaterial('Pappelsperrholz', md, laser)?.id)).toBe('Holz');
  });
});

describe('Ableitung aus Datei und Material (keine Maschine angegeben)', () => {
  it('.svg + Acryl → Laser (Maschine offen, zwei Laser)', () => {
    const r = inferFromContext({ fileRef: 'schild.svg', material: 'Acryl' }, md);
    expect(proc(r.processId)).toBe('Lasercutten/Gravieren');
    expect(r.machineId).toBeNull();
    expect(r.notes[0]).toMatch(/Dateiendung \.svg/);
  });
  it('Resin → SLA, einzige aktive Maschine wird gewählt', () => {
    const r = inferFromContext({ material: 'Clear Resin' }, md);
    expect(proc(r.processId)).toBe('3D-Druck SLA');
    expect(machine(r.machineId)).toBe('3D SLA Drucker');
  });
  it('.stl + PETG → FDM mit Material', () => {
    const r = inferFromContext({ fileRef: 'halter.stl', material: 'PETG' }, md);
    expect(proc(r.processId)).toBe('3D-Druck FDM');
    expect(mat(r.materialId)).toBe('PETG');
  });
  it('Widerspruch (.svg, aber PLA): Material gewinnt, Hinweis zum Prüfen', () => {
    const r = inferFromContext({ fileRef: 'x.svg', material: 'PLA' }, md);
    expect(proc(r.processId)).toBe('3D-Druck FDM');
    expect(r.confidence).toBe('mittel');
    expect(r.notes.join(' ')).toMatch(/Dateiendung \.svg spricht für Lasercutten\/Gravieren – bitte prüfen/);
  });
  it('gleich starke Hinweise bleiben unentschieden', () => {
    const r = inferFromContext({ fileRef: 'a.svg', processText: 'irgendwas' , material: 'Holz' }, md);
    expect(proc(r.processId)).toBe('Lasercutten/Gravieren'); // Holz (Laser+CNC je 1) + .svg (Laser 1)
    const tie = inferFromContext({ material: 'Holz' }, md);  // Laser 1 vs CNC 1
    expect(tie.processId).toBeNull();
    expect(tie.notes[0]).toMatch(/unklar/);
  });
  it('Holz (Laser und CNC) + .dxf → Laser', () => {
    expect(proc(inferFromContext({ fileRef: 'teil.dxf', material: 'Holz' }, md).processId)).toBe('Lasercutten/Gravieren');
  });
  it('nichts bekannt → kein Vorschlag', () => {
    expect(inferFromContext({}, md).processId).toBeNull();
  });
});

describe('Import einer „unsauberen“ Tabelle', () => {
  const headers = ['Teil', 'Menge', 'Gerät', 'Werkstoff', 'Datei'];
  const rows = [
    ['Halter', 4, 'Bambu', 'PETG schwarz', 'halter.3mf'],    // Alias exakt + Material mit Farbe
    ['Schild', 10, '', 'Plexiglas', 'schild.svg'],          // Ableitung → Laser
    ['Figur', 1, '', 'Grey Resin', 'figur.stl'],            // Material sagt SLA, Datei FDM → Material+Datei: SLA? (2 vs 1)
    ['Gehäuse', 2, 'Bamboo X1', 'PLA', 'gehaeuse.stl'],     // Tippfehler → unbekannt mit Vorschlag
    ['Rahmen', 1, 'Lasercutter', 'Pappelsperrholz', 'r.dxf'], // mehrdeutig → unbekannt, niedriger Vorschlag
  ];
  it('ordnet sicher zu, schlägt vor und fragt nur bei Unklarem', () => {
    const mapping = autoMapColumns(headers);
    expect(mapping).toEqual(['name', 'quantity', 'machine', 'material', 'fileRef']);
    const res = validateRows(rows, mapping, md);

    expect(machine(res[0].part.machineId)).toBe('3D Drucker Bambu Lab H2D');
    expect(mat(res[0].part.materialId)).toBe('PETG');
    expect(res[0].part.color).toBe('schwarz');
    expect(res[0].unknownMachine).toBeNull();

    expect(proc(res[1].part.processId)).toBe('Lasercutten/Gravieren');
    expect(mat(res[1].part.materialId)).toBe('Kunststoff/Acryl');

    expect(proc(res[2].part.processId)).toBe('3D-Druck SLA');
    expect(machine(res[2].part.machineId)).toBe('3D SLA Drucker');

    expect(res[3].unknownMachine).toBe('Bamboo X1');
    expect(res[4].unknownMachine).toBe('Lasercutter');

    const u = collectUnknowns(res, md);
    const bamboo = u.machines.find((m) => m.name === 'Bamboo X1')!;
    expect(machine(bamboo.suggestion?.id)).toBe('3D Drucker Bambu Lab H2D');
    expect(bamboo.suggestion?.confidence).not.toBe('niedrig');
    const laser = u.machines.find((m) => m.name === 'Lasercutter')!;
    expect(laser.suggestion?.confidence).toBe('niedrig');
    expect(proc(laser.processId)).toBe('Lasercutten/Gravieren');
    expect(res.every((r) => r.errors.length === 0)).toBe(true);
  });
});
