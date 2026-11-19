import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  autoMapColumns, collectUnknowns, decodeBytes, parseCsvBytes, parseCsvText, parseDurationMinutes,
  parseWorkbook, TEMPLATE_HEADERS, TEMPLATE_ROWS, validateRows,
} from './import.ts';
import type { MasterData } from './types.ts';

const md: MasterData = {
  processes: [
    { id: 1, name: '3D-Druck FDM', active: true, aliases: '', sort: 0 },
    { id: 2, name: 'Lasercutten/Gravieren', active: true, aliases: '', sort: 1 },
  ],
  machines: [
    { id: 10, processId: 1, name: '3D Drucker Bambu Lab H2D', active: true, note: null, hourlyRateCents: 800, jobFlatCents: 0, aliases: '', sort: 0 },
    { id: 11, processId: 1, name: '3D FDM Druck Prusa', active: true, note: null, hourlyRateCents: 500, jobFlatCents: 0, aliases: '', sort: 1 },
    { id: 20, processId: 2, name: 'Muse Lasercutter', active: false, note: 'Wartung', hourlyRateCents: 1500, jobFlatCents: 0, aliases: '', sort: 0 },
  ],
  materials: [
    { id: 100, processId: 1, name: 'PLA', unit: 'g', priceMills: 3000, active: true, aliases: '', sort: 0 },
    { id: 101, processId: 1, name: 'PETG', unit: 'g', priceMills: 4000, active: true, aliases: '', sort: 1 },
  ],
  discounts: [],
};

describe('CSV-Parsing', () => {
  it('erkennt Semikolon und Umlaute (UTF-8 mit BOM)', () => {
    const csv = '﻿Bezeichnung;Anzahl;Höhe (mm)\nGrüner Würfel;2;10,5\n';
    const bytes = new TextEncoder().encode(csv);
    const t = parseCsvBytes(bytes);
    expect(t.delimiter).toBe(';');
    expect(t.encoding).toBe('utf-8');
    expect(t.headers).toEqual(['Bezeichnung', 'Anzahl', 'Höhe (mm)']);
    expect(t.rows).toEqual([['Grüner Würfel', '2', '10,5']]);
  });
  it('erkennt Komma und Anführungszeichen', () => {
    const t = parseCsvText('Bezeichnung,Anzahl,Notizen\n"Teil, groß",3,"sagt ""hallo"""\n\n');
    expect(t.delimiter).toBe(',');
    expect(t.rows).toEqual([['Teil, groß', '3', 'sagt "hallo"']]);
  });
  it('fällt bei ungültigem UTF-8 auf Windows-1252 zurück', () => {
    const bytes = new Uint8Array([0x47, 0x72, 0xfc, 0x6e]); // "Grün" in Latin-1
    expect(decodeBytes(bytes)).toEqual({ text: 'Grün', encoding: 'windows-1252' });
  });
});

describe('Excel-Parsing', () => {
  it('liest die Vorlage als XLSX zurück', () => {
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...TEMPLATE_ROWS]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Teile');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const t = parseWorkbook(buf);
    expect(t.headers).toEqual(TEMPLATE_HEADERS);
    expect(t.rows).toHaveLength(TEMPLATE_ROWS.length);
    expect(t.rows[0][1]).toBe(2);
    expect(t.rows[2][14]).toBe('Umlaute-Test: äöü ß');
  });
});

describe('Spalten-Zuordnung', () => {
  it('ordnet Vorlagen-Überschriften vollständig zu', () => {
    const m = autoMapColumns(TEMPLATE_HEADERS);
    expect(m).toEqual(['name', 'quantity', 'process', 'machine', 'material', 'color', 'dimW', 'dimD', 'dimH',
      'fileRef', 'estMinutes', 'actualMinutes', 'materialAmount', 'status', 'notes']);
  });
  it('erkennt Varianten und lässt Unbekanntes leer', () => {
    expect(autoMapColumns(['Menge', 'Teilname', 'Materialverbrauch g', 'Foo'])).toEqual(['quantity', 'name', 'materialAmount', null]);
  });
});

describe('Validierung', () => {
  const mapping = autoMapColumns(TEMPLATE_HEADERS);
  it('akzeptiert die Beispielzeilen und löst Namen auf', () => {
    const res = validateRows(TEMPLATE_ROWS, mapping, md);
    expect(res[0].errors).toEqual([]);
    expect(res[0].part).toMatchObject({ processId: 1, machineId: 10, materialId: 101, quantity: 2, estMinutes: 150 });
    expect(res[1].warnings.join()).toMatch(/deaktiviert/);
    expect(res[1].part.estMinutes).toBe(25);
    expect(res[1].part.materialText).toBe('Kunststoff/Acryl');
    expect(res[2].part.estMinutes).toBe(90);
  });
  it('meldet Pflichtfelder und falsche Zahlen', () => {
    const res = validateRows([['', 'zwei', '', '', '', '', 'x']], mapping, md);
    expect(res[0].errors).toEqual(expect.arrayContaining(['Bezeichnung fehlt.', expect.stringMatching(/Anzahl/), expect.stringMatching(/Breite/)]));
    expect(res[0].line).toBe(2);
  });
  it('markiert unbekannte Maschinen und Verfahren', () => {
    const rows = [['A', 1, 'Wasserstrahl', 'Jet 3000'], ['B', 1, '3D-Druck FDM', 'Neuer Drucker'], ['C', 1, '', 'Jet 3000']];
    const res = validateRows(rows, ['name', 'quantity', 'process', 'machine'], md);
    expect(res[0]).toMatchObject({ unknownProcess: 'Wasserstrahl', unknownMachine: 'Jet 3000' });
    const u = collectUnknowns(res);
    expect(u.processes).toEqual([{ key: 'wasserstrahl', name: 'Wasserstrahl', rows: [2], suggestion: null }]);
    expect(u.machines.map((m) => [m.name, m.rows])).toEqual([['Jet 3000', [2, 4]], ['Neuer Drucker', [3]]]);
  });
  it('erkennt Maschine im falschen Verfahren', () => {
    const res = validateRows([['A', 1, 'Lasercutten/Gravieren', '3D FDM Druck Prusa']], ['name', 'quantity', 'process', 'machine'], md);
    expect(res[0].errors[0]).toMatch(/gehört nicht/);
  });
  it('Dauerformate', () => {
    expect(parseDurationMinutes('1:30')).toBe(90);
    expect(parseDurationMinutes('2 h')).toBe(120);
    expect(parseDurationMinutes('45 min')).toBe(45);
    expect(parseDurationMinutes('bald')).toBeNull();
  });
});
