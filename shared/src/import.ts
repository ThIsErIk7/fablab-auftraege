// Import von Teilen aus CSV/Excel: Datei lesen → Spalten zuordnen → validieren.
// Läuft im Browser (Vorschau) und auf dem Server (erneute Prüfung beim Speichern).
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { parseLocaleNumber } from './money.ts';
import type { MasterData, PartStatus } from './types.ts';
import { PART_STATUSES, PART_STATUS_LABELS } from './types.ts';

export type Cell = string | number | boolean | null;

export interface ParsedTable {
  headers: string[];
  rows: Cell[][];
  /** Nur CSV: erkanntes Trennzeichen */
  delimiter?: string;
  /** Nur CSV: erkannte Kodierung */
  encoding?: 'utf-8' | 'windows-1252';
  sheetNames?: string[];
  sheetName?: string;
}

/** Bytes → Text. UTF-8 (mit/ohne BOM); falls ungültig, Fallback auf Windows-1252 (alte Excel-CSV). */
export function decodeBytes(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1252' } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    return { text, encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

/** CSV mit Komma, Semikolon oder Tab. Erste nicht-leere Zeile = Überschriften. */
export function parseCsvText(text: string): ParsedTable {
  const clean = text.replace(/^﻿/, '');
  const res = Papa.parse<string[]>(clean, {
    delimitersToGuess: [';', ',', '\t', '|'],
    skipEmptyLines: 'greedy',
  });
  const all = res.data.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  const [headerRow = [], ...rows] = all;
  return {
    headers: headerRow.map((h) => String(h).trim()),
    rows: rows.map((r) => r.map((c) => (typeof c === 'string' ? c.trim() : c))),
    delimiter: res.meta.delimiter,
  };
}

export function parseCsvBytes(bytes: Uint8Array): ParsedTable {
  const { text, encoding } = decodeBytes(bytes);
  return { ...parseCsvText(text), encoding };
}

/** Excel (.xlsx/.xls). Standardmäßig erstes Blatt. */
export function parseWorkbook(data: ArrayBuffer | Uint8Array, sheetName?: string): ParsedTable {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const name = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  const raw = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, defval: null, raw: true, blankrows: false });
  const all = raw
    .map((r) => r.map((c: unknown): Cell => (c instanceof Date ? c.toISOString().slice(0, 10) : typeof c === "string" ? c.trim() : (c as Cell))))
    .filter((r) => r.some((c) => c !== null && String(c).trim() !== ''));
  const [headerRow = [], ...rows] = all;
  return { headers: headerRow.map((h) => String(h ?? '').trim()), rows, sheetNames: wb.SheetNames, sheetName: name };
}

export function parseFile(fileName: string, data: Uint8Array): ParsedTable {
  return /\.(xlsx|xls|xlsm|ods)$/i.test(fileName) ? parseWorkbook(data) : parseCsvBytes(data);
}

// ---------------------------------------------------------------------------
// Felder & automatische Zuordnung

export type ImportFieldKey =
  | 'name'
  | 'quantity'
  | 'process'
  | 'machine'
  | 'material'
  | 'color'
  | 'dimW'
  | 'dimD'
  | 'dimH'
  | 'fileRef'
  | 'estMinutes'
  | 'actualMinutes'
  | 'materialAmount'
  | 'status'
  | 'notes';

export interface ImportField {
  key: ImportFieldKey;
  label: string;
  required: boolean;
  kind: 'text' | 'int' | 'number' | 'duration' | 'status';
  aliases: string[];
}

export const IMPORT_FIELDS: ImportField[] = [
  { key: 'name', label: 'Bezeichnung', required: true, kind: 'text', aliases: ['bezeichnung', 'teil', 'name', 'teilname', 'titel', 'beschreibung', 'part'] },
  { key: 'quantity', label: 'Anzahl', required: true, kind: 'int', aliases: ['anzahl', 'menge', 'stueck', 'stk', 'qty', 'quantity', 'stueckzahl'] },
  { key: 'process', label: 'Verfahren', required: false, kind: 'text', aliases: ['verfahren', 'prozess', 'fertigungsverfahren', 'process', 'technologie'] },
  { key: 'machine', label: 'Maschine', required: false, kind: 'text', aliases: ['maschine', 'geraet', 'drucker', 'machine', 'printer'] },
  { key: 'material', label: 'Material', required: false, kind: 'text', aliases: ['material', 'werkstoff', 'filament'] },
  { key: 'color', label: 'Farbe', required: false, kind: 'text', aliases: ['farbe', 'color', 'colour'] },
  { key: 'dimW', label: 'Breite (mm)', required: false, kind: 'number', aliases: ['breite', 'b', 'breitemm', 'width', 'x'] },
  { key: 'dimD', label: 'Tiefe (mm)', required: false, kind: 'number', aliases: ['tiefe', 't', 'tiefemm', 'laenge', 'depth', 'y'] },
  { key: 'dimH', label: 'Höhe (mm)', required: false, kind: 'number', aliases: ['hoehe', 'h', 'hoehemm', 'height', 'z'] },
  { key: 'fileRef', label: 'Datei / Link', required: false, kind: 'text', aliases: ['datei', 'dateiname', 'link', 'file', 'url', 'pfad'] },
  { key: 'estMinutes', label: 'Geschätzte Dauer (min)', required: false, kind: 'duration', aliases: ['geschaetztedauer', 'geschaetztedauermin', 'dauer', 'schaetzung', 'estimated', 'druckzeit'] },
  { key: 'actualMinutes', label: 'Maschinenzeit (min)', required: false, kind: 'duration', aliases: ['maschinenzeit', 'maschinenzeitmin', 'tatsaechlichezeit', 'istzeit', 'actual'] },
  { key: 'materialAmount', label: 'Materialverbrauch', required: false, kind: 'number', aliases: ['materialverbrauch', 'verbrauch', 'gramm', 'g', 'gewicht', 'flaeche', 'm2'] },
  { key: 'status', label: 'Status', required: false, kind: 'status', aliases: ['status', 'zustand'] },
  { key: 'notes', label: 'Notizen', required: false, kind: 'text', aliases: ['notizen', 'notiz', 'bemerkung', 'bemerkungen', 'kommentar', 'notes'] },
];

export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

/** Mapping: Spaltenindex → Feld (oder null = ignorieren). */
export type ColumnMapping = (ImportFieldKey | null)[];

export function autoMapColumns(headers: string[]): ColumnMapping {
  const used = new Set<ImportFieldKey>();
  const norm = headers.map(normalizeHeader);
  const mapping: ColumnMapping = headers.map(() => null);
  // 1. exakte Treffer (Alias oder Label), 2. Überschrift beginnt mit einem Alias
  //    (z. B. "Materialverbrauch g") – dabei gewinnt der längste passende Alias.
  for (const pass of ['exact', 'prefix'] as const) {
    norm.forEach((h, i) => {
      if (mapping[i] || !h) return;
      let best: { key: ImportFieldKey; len: number } | null = null;
      for (const f of IMPORT_FIELDS) {
        if (used.has(f.key)) continue;
        for (const a of [...f.aliases, normalizeHeader(f.label)]) {
          const hit = pass === 'exact' ? a === h : a.length >= 3 && h.startsWith(a);
          if (hit && (!best || a.length > best.len)) best = { key: f.key, len: a.length };
        }
      }
      if (best) {
        mapping[i] = best.key;
        used.add(best.key);
      }
    });
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// Validierung

/** "90" → 90, "1:30" → 90, "1,5 h" → 90, "45 min" → 45 */
export function parseDurationMinutes(v: Cell): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  const s = String(v).trim().toLowerCase();
  const hm = s.match(/^(\d+):(\d{1,2})(?::\d{1,2})?$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const h = s.match(/^([\d.,]+)\s*(h|std|stunden?)$/);
  if (h) {
    const n = parseLocaleNumber(h[1]);
    return n === null ? null : Math.round(n * 60);
  }
  const m = s.match(/^([\d.,]+)\s*(m|min|minuten?)?$/);
  if (m) {
    const n = parseLocaleNumber(m[1]);
    return n === null || n < 0 ? null : Math.round(n);
  }
  return null;
}

export function parsePartStatus(v: Cell): PartStatus | null {
  if (v === null || v === '') return null;
  const s = normalizeHeader(String(v));
  const hit = PART_STATUSES.find((k) => normalizeHeader(k) === s || normalizeHeader(PART_STATUS_LABELS[k]) === s);
  if (hit) return hit;
  if (['erledigt', 'done', 'ja', 'x', 'fertiggestellt'].includes(s)) return 'fertig';
  return null;
}

export interface ImportedPart {
  name: string;
  quantity: number;
  processId: number | null;
  machineId: number | null;
  materialId: number | null;
  materialText: string | null;
  color: string | null;
  dimW: number | null;
  dimD: number | null;
  dimH: number | null;
  fileRef: string | null;
  estMinutes: number | null;
  actualMinutes: number | null;
  materialAmount: number | null;
  status: PartStatus;
  notes: string | null;
}

export interface RowResult {
  /** 0-basiert, bezogen auf Datenzeilen (ohne Überschrift) */
  index: number;
  /** Zeilennummer wie in Excel (Überschrift = 1) */
  line: number;
  part: ImportedPart;
  /** Rohwerte für die Anzeige */
  raw: Partial<Record<ImportFieldKey, string>>;
  errors: string[];
  warnings: string[];
  unknownProcess: string | null;
  unknownMachine: string | null;
}

export type Resolution =
  | { action: 'map'; id: number }
  | { action: 'create'; processId?: number }
  | { action: 'skip' };

export interface Resolutions {
  /** Schlüssel: Name wie in der Datei (normalisiert über key()) */
  processes: Record<string, Resolution>;
  machines: Record<string, Resolution>;
}

export const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

const str = (v: Cell): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

export function validateRows(rows: Cell[][], mapping: ColumnMapping, md: MasterData): RowResult[] {
  const procByName = new Map(md.processes.map((p) => [nameKey(p.name), p]));
  const machByName = new Map(md.machines.map((m) => [nameKey(m.name), m]));

  return rows.map((row, index) => {
    const raw: Partial<Record<ImportFieldKey, string>> = {};
    const val: Partial<Record<ImportFieldKey, Cell>> = {};
    mapping.forEach((key, col) => {
      if (!key) return;
      val[key] = row[col] ?? null;
      raw[key] = row[col] === null || row[col] === undefined ? '' : String(row[col]);
    });
    const errors: string[] = [];
    const warnings: string[] = [];

    const name = str(val.name ?? null);
    if (!name) errors.push('Bezeichnung fehlt.');

    let quantity = 1;
    if (str(val.quantity ?? null) === null) {
      errors.push('Anzahl fehlt.');
    } else {
      const q = parseLocaleNumber(val.quantity as string | number);
      if (q === null || !Number.isInteger(q) || q < 1) errors.push(`Anzahl „${raw.quantity}“ ist keine ganze Zahl ≥ 1.`);
      else quantity = q;
    }

    const num = (key: ImportFieldKey, label: string): number | null => {
      const v = val[key];
      if (str(v ?? null) === null) return null;
      const n = parseLocaleNumber(v as string | number);
      if (n === null || n < 0) {
        errors.push(`${label} „${raw[key]}“ ist keine gültige Zahl.`);
        return null;
      }
      return n;
    };
    const dur = (key: ImportFieldKey, label: string): number | null => {
      const v = val[key];
      if (str(v ?? null) === null) return null;
      const n = parseDurationMinutes(v ?? null);
      if (n === null) errors.push(`${label} „${raw[key]}“ nicht lesbar (z. B. 90, 1:30 oder 1,5 h).`);
      return n;
    };

    const dimW = num('dimW', 'Breite');
    const dimD = num('dimD', 'Tiefe');
    const dimH = num('dimH', 'Höhe');
    const materialAmount = num('materialAmount', 'Materialverbrauch');
    const estMinutes = dur('estMinutes', 'Geschätzte Dauer');
    const actualMinutes = dur('actualMinutes', 'Maschinenzeit');

    let status: PartStatus = 'offen';
    if (str(val.status ?? null)) {
      const s = parsePartStatus(val.status ?? null);
      if (s) status = s;
      else warnings.push(`Status „${raw.status}“ unbekannt – „Offen“ verwendet.`);
    }

    // Verfahren / Maschine
    const procName = str(val.process ?? null);
    const machName = str(val.machine ?? null);
    let processId: number | null = null;
    let machineId: number | null = null;
    let unknownProcess: string | null = null;
    let unknownMachine: string | null = null;
    if (procName) {
      const p = procByName.get(nameKey(procName));
      if (p) processId = p.id;
      else unknownProcess = procName;
    }
    if (machName) {
      const m = machByName.get(nameKey(machName));
      if (m) {
        machineId = m.id;
        if (processId === null && !unknownProcess) processId = m.processId;
        else if (processId !== null && m.processId !== processId) {
          errors.push(`Maschine „${m.name}“ gehört nicht zum Verfahren „${procName}“.`);
        }
        if (!m.active) warnings.push(`Maschine „${m.name}“ ist deaktiviert.`);
      } else unknownMachine = machName;
    }

    // Material: bekannter Name im Verfahren → ID, sonst Freitext
    const matName = str(val.material ?? null);
    let materialId: number | null = null;
    let materialText: string | null = null;
    if (matName) {
      const m = md.materials.find(
        (x) => nameKey(x.name) === nameKey(matName) && (processId === null || x.processId === processId),
      );
      if (m) materialId = m.id;
      else materialText = matName;
    }

    return {
      index,
      line: index + 2,
      raw,
      errors,
      warnings,
      unknownProcess,
      unknownMachine,
      part: {
        name: name ?? '',
        quantity,
        processId,
        machineId,
        materialId,
        materialText,
        color: str(val.color ?? null),
        dimW,
        dimD,
        dimH,
        fileRef: str(val.fileRef ?? null),
        estMinutes,
        actualMinutes,
        materialAmount,
        status,
        notes: str(val.notes ?? null),
      },
    };
  });
}

/** Liste unbekannter Verfahren/Maschinen (eindeutig), für die Auflösungs-Oberfläche. */
export function collectUnknowns(results: RowResult[]) {
  const processes = new Map<string, { name: string; rows: number[] }>();
  const machines = new Map<string, { name: string; rows: number[]; processName: string | null; processId: number | null }>();
  for (const r of results) {
    if (r.unknownProcess) {
      const k = nameKey(r.unknownProcess);
      const e = processes.get(k) ?? { name: r.unknownProcess, rows: [] };
      e.rows.push(r.line);
      processes.set(k, e);
    }
    if (r.unknownMachine) {
      const k = nameKey(r.unknownMachine);
      const e = machines.get(k) ?? { name: r.unknownMachine, rows: [], processName: r.unknownProcess ?? r.raw.process ?? null, processId: r.part.processId };
      e.rows.push(r.line);
      machines.set(k, e);
    }
  }
  return {
    processes: [...processes.entries()].map(([key, v]) => ({ key, ...v })),
    machines: [...machines.entries()].map(([key, v]) => ({ key, ...v })),
  };
}

// ---------------------------------------------------------------------------
// Import-Vorlage

export const TEMPLATE_HEADERS = [
  'Bezeichnung',
  'Anzahl',
  'Verfahren',
  'Maschine',
  'Material',
  'Farbe',
  'Breite (mm)',
  'Tiefe (mm)',
  'Höhe (mm)',
  'Datei',
  'Geschätzte Dauer (min)',
  'Maschinenzeit (min)',
  'Materialverbrauch',
  'Status',
  'Notizen',
];

export const TEMPLATE_ROWS: (string | number)[][] = [
  ['Gehäuse Unterteil', 2, '3D-Druck FDM', '3D Drucker Bambu Lab H2D', 'PETG', 'Schwarz', 120, 80, 35, 'gehaeuse_unten.3mf', 150, '', 85, 'Offen', 'Infill 20 %'],
  ['Frontplatte graviert', 1, 'Lasercutten/Gravieren', 'Muse Lasercutter', 'Kunststoff/Acryl', 'Transparent', 200, 100, 3, 'front.svg', '0:25', '', 0.02, 'Offen', 'Logo gravieren'],
  ['Halterung Größe Ü', 4, '3D-Druck FDM', '3D FDM Druck Prusa', 'PLA', 'Grün', 40, 25, 15, 'halter.stl', '1,5 h', '', 32, 'Offen', 'Umlaute-Test: äöü ß'],
];
