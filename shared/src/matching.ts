// Regelbasierte Zuordnung von Tabellen-Einträgen zu Verfahren, Maschinen und Materialien – ohne KI.
//
// Hinweise, die ausgewertet werden:
//   1. Name/Alternativnamen (aus den Stammdaten pflegbar) – exakt, enthalten oder unscharf (Tippfehler)
//   2. Dateiendung (z. B. .svg → Laser, .stl → 3D-Druck FDM, .form → SLA)
//   3. Material (z. B. Resin → SLA, PETG → FDM, Acryl → Laser)
// Ergebnis ist immer ein Vorschlag mit Sicherheit und Begründung; nichts wird ungeprüft gespeichert.
import type { MasterData } from './types.ts';

export type Confidence = 'hoch' | 'mittel' | 'niedrig';

export interface Match<T = number> {
  id: T;
  confidence: Confidence;
  /** Kurze, verständliche Begründung für die Vorschau */
  reason: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Text-Normalisierung

export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Wörter ohne Unterscheidungskraft – sie kommen in vielen Maschinennamen vor. */
const STOP = new Set(['3d', 'drucker', 'druck', 'printer', 'print', 'maschine', 'geraet', 'der', 'die', 'das', 'mit', 'und', 'von', 'fuer', 'the', 'neu', 'alt', 'lab']);

export function tokens(s: string): string[] {
  return norm(s).split(' ').filter((t) => t && !STOP.has(t));
}

export function splitAliases(aliases: string | undefined | null): string[] {
  return (aliases ?? '').split(/[,;\n]/).map((a) => a.trim()).filter(Boolean);
}

/** Levenshtein-Distanz mit frühem Abbruch (für kurze Wörter genügt das völlig). */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Zwei Wörter gelten als gleich bei kleinem Tippfehler (ab 5 Zeichen 1 Fehler, ab 8 Zeichen 2). */
function tokenEq(a: string, b: string): boolean {
  if (a === b) return true;
  const len = Math.min(a.length, b.length);
  if (len < 4) return false;
  // Gleicher Wortanfang (mind. 4 Zeichen und 60 % des kürzeren Worts): "bamboo" ≈ "bambu", "lasercut" ≈ "lasercutter"
  let pre = 0;
  while (pre < len && a[pre] === b[pre]) pre++;
  if (pre >= 4 && pre / len >= 0.6) return true;
  const allowed = len >= 8 ? 2 : len >= 5 ? 1 : 0;
  return allowed > 0 && editDistance(a, b, allowed) <= allowed;
}

interface Candidate { id: number; name: string; aliases: string[]; groupId?: number }

/**
 * Bewertet, wie gut ein Freitext zu einem Kandidaten (Name + Alternativnamen) passt.
 * 1.0 exakt · 0.9 Alternativname exakt · 0.8 Name/Alias als Wortfolge enthalten · darunter Wortüberdeckung.
 */
export function scoreText(input: string, c: Candidate): { score: number; via: string } {
  const n = norm(input);
  if (!n) return { score: 0, via: '' };
  if (n === norm(c.name)) return { score: 1, via: 'Name' };
  let best = { score: 0, via: '' };
  const consider = (score: number, via: string) => { if (score > best.score) best = { score, via }; };
  // Offizieller Name als Wortfolge im Text, z. B. "PETG schwarz" enthält "PETG"
  const nn = norm(c.name);
  if (nn.length >= 3 && (` ${n} `).includes(` ${nn} `)) consider(0.85, `enthält „${c.name}“`);
  for (const a of c.aliases) {
    const na = norm(a);
    if (!na) continue;
    if (n === na) consider(0.95, `Alternativname „${a}“`);
    // Alias als ganze Wortfolge im Text, z. B. "Bambu X1C (Halle)" enthält "x1c"
    else if (na.length >= 2 && (` ${n} `).includes(` ${na} `)) consider(na.length >= 3 ? 0.85 : 0.7, `enthält „${a}“`);
  }
  // Wortüberdeckung über Name + Alternativnamen (tippfehlertolerant)
  const inTok = tokens(input);
  if (inTok.length) {
    const candTok = new Set([...tokens(c.name), ...c.aliases.flatMap(tokens)]);
    let hit = 0;
    const hits: string[] = [];
    for (const t of inTok) {
      const m = [...candTok].find((ct) => tokenEq(t, ct));
      if (m) { hit++; hits.push(m === t ? t : `${t}≈${m}`); }
    }
    if (hit) consider(0.75 * (hit / inTok.length) + (hit === inTok.length ? 0.05 : 0), `Wort ${hits.map((h) => `„${h}“`).join(', ')}`);
  }
  return best;
}

function rank(input: string, cands: Candidate[]) {
  return cands
    .map((c) => ({ c, ...scoreText(input, c) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Bester Treffer mit Abstand zum zweitbesten – sonst kein sicherer Treffer. */
function pick(input: string, cands: Candidate[], what: string): Match | null {
  const r = rank(input, cands);
  if (!r.length || r[0].score < 0.5) return null;
  const margin = r[0].score - (r[1]?.score ?? 0);
  // Mehrdeutig (z. B. "Lasercutter" passt auf Muse und BRM) → nur niedrige Sicherheit
  const confidence: Confidence = margin < 0.1 ? 'niedrig' : r[0].score >= 0.85 ? 'hoch' : r[0].score >= 0.6 ? 'mittel' : 'niedrig';
  return { id: r[0].c.id, confidence, score: r[0].score, reason: `${what}: ${r[0].via}${margin < 0.1 && r[1] ? ` (auch möglich: ${r[1].c.name})` : ''}` };
}

// ---------------------------------------------------------------------------
// Kandidatenlisten aus den Stammdaten

const procCands = (md: MasterData): Candidate[] =>
  md.processes.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, aliases: splitAliases(p.aliases) }));
const machCands = (md: MasterData, processId?: number | null): Candidate[] =>
  md.machines
    .filter((m) => m.active && (processId == null || m.processId === processId))
    .map((m) => ({ id: m.id, name: m.name, aliases: splitAliases(m.aliases), groupId: m.processId }));
const matCands = (md: MasterData, processId?: number | null): Candidate[] =>
  md.materials
    .filter((m) => m.active && (processId == null || m.processId === processId))
    .map((m) => ({ id: m.id, name: m.name, aliases: splitAliases(m.aliases), groupId: m.processId }));

export function matchProcess(text: string, md: MasterData): Match | null {
  return pick(text, procCands(md), 'Verfahren');
}

export function matchMachine(text: string, md: MasterData, processId?: number | null): Match | null {
  const inProc = processId != null ? pick(text, machCands(md, processId), 'Maschine') : null;
  if (inProc) return inProc;
  return pick(text, machCands(md), 'Maschine');
}

export function matchMaterial(text: string, md: MasterData, processId?: number | null): Match | null {
  if (processId != null) return pick(text, matCands(md, processId), 'Material');
  return pick(text, matCands(md), 'Material');
}

// ---------------------------------------------------------------------------
// Verfahren aus Dateiendung / Material ableiten

/** Dateiendung → Stichwort, das über Name/Alternativnamen eines Verfahrens aufgelöst wird. */
export const FILE_HINTS: Record<string, string> = {
  stl: 'fdm', '3mf': 'fdm', obj: 'fdm', step: 'fdm', stp: 'fdm', gcode: 'fdm', bgcode: 'fdm', amf: 'fdm', f3d: 'fdm',
  form: 'sla', fps: 'sls',
  svg: 'laser', dxf: 'laser', ai: 'laser', eps: 'laser', lbrn: 'laser', lbrn2: 'laser', cdr: 'laser', pdf: 'laser',
  studio: 'plotter', studio3: 'plotter', cut: 'plotter',
  nc: 'cnc', tap: 'cnc', ngc: 'cnc',
  ply: 'scan',
};

export function fileExtension(fileRef: string | null | undefined): string | null {
  if (!fileRef) return null;
  const clean = fileRef.split(/[?#]/)[0].trim().toLowerCase();
  if (clean.endsWith('.gcode.3mf')) return 'gcode';
  const m = clean.match(/\.([a-z0-9]{1,6})$/);
  return m ? m[1] : null;
}

function processByKeyword(keyword: string, md: MasterData): number | null {
  const m = pick(keyword, procCands(md), 'Verfahren');
  return m && m.score >= 0.7 ? m.id : null;
}

export interface Inference {
  processId: number | null;
  machineId: number | null;
  materialId: number | null;
  /** Je Feld eine Begründung, z. B. { process: 'Dateiendung .svg' } */
  notes: string[];
  confidence: Confidence | null;
}

/**
 * Leitet für eine Zeile ohne (eindeutige) Maschine das Verfahren und ggf. die Maschine ab.
 * Stimmen aus Dateiendung und Material werden gezählt; nur ein eindeutiges Ergebnis wird vorgeschlagen.
 */
export function inferFromContext(
  row: { fileRef?: string | null; material?: string | null; machineText?: string | null; processText?: string | null },
  md: MasterData,
): Inference {
  const votes = new Map<number, { w: number; why: string[] }>();
  const vote = (pid: number | null, w: number, why: string) => {
    if (pid == null) return;
    const v = votes.get(pid) ?? { w: 0, why: [] };
    v.w += w; v.why.push(why);
    votes.set(pid, v);
  };

  // Unscharfer Verfahrens- oder Maschinentext (z. B. "Lasern", "irgendein Drucker")
  if (row.processText) {
    const p = matchProcess(row.processText, md);
    if (p && p.confidence !== 'niedrig') vote(p.id, 3, `Verfahren „${row.processText}“`);
  }
  if (row.machineText) {
    const m = matchMachine(row.machineText, md);
    if (m) vote(md.machines.find((x) => x.id === m.id)!.processId, m.confidence === 'niedrig' ? 1.5 : 3, `Maschine „${row.machineText}“`);
    const p = matchProcess(row.machineText, md); // "Laser", "Plotter" …
    if (p && p.score >= 0.7) vote(p.id, 2, `„${row.machineText}“ deutet auf ${md.processes.find((x) => x.id === p.id)!.name}`);
  }
  const ext = fileExtension(row.fileRef);
  if (ext && FILE_HINTS[ext]) vote(processByKeyword(FILE_HINTS[ext], md), 1, `Dateiendung .${ext}`);
  let materialId: number | null = null;
  if (row.material) {
    // Material in allen Verfahren suchen; mehrdeutige Namen (Holz: Laser & CNC) stimmen für alle
    const all = rank(row.material, matCands(md)).filter((r) => r.score >= 0.6);
    const top = all.filter((r) => r.score >= (all[0]?.score ?? 1) - 0.05);
    for (const r of top) vote(r.c.groupId!, 2 / top.length, `Material „${row.material}“`);
    if (top.length === 1) materialId = top[0].c.id;
  }

  const ranked = [...votes.entries()].sort((a, b) => b[1].w - a[1].w);
  if (!ranked.length) return { processId: null, machineId: null, materialId: null, notes: [], confidence: null };
  const [best, second] = ranked;
  if (second && best[1].w - second[1].w < 0.5) {
    const names = [best, second].map(([pid]) => md.processes.find((p) => p.id === pid)?.name).join(' oder ');
    return { processId: null, machineId: null, materialId: null, notes: [`Verfahren unklar: ${names}`], confidence: null };
  }
  const processId = best[0];
  const notes = [`Verfahren aus ${best[1].why.join(' + ')}`];
  if (second) notes.push(`${second[1].why.join(' + ')} spricht für ${md.processes.find((p) => p.id === second[0])?.name} – bitte prüfen`);
  let confidence: Confidence = best[1].w >= 3 ? 'hoch' : best[1].w >= 2 ? 'mittel' : 'niedrig';
  if (second && confidence === 'hoch') confidence = 'mittel';

  // Maschine: aus Text innerhalb des Verfahrens, sonst die einzige aktive Maschine des Verfahrens
  let machineId: number | null = null;
  if (row.machineText) {
    const m = matchMachine(row.machineText, md, processId);
    if (m && m.confidence !== 'niedrig' && md.machines.find((x) => x.id === m.id)?.processId === processId) {
      machineId = m.id; notes.push(m.reason);
    }
  }
  if (machineId == null) {
    const active = md.machines.filter((m) => m.processId === processId && m.active);
    if (active.length === 1) { machineId = active[0].id; notes.push(`einzige aktive Maschine für ${md.processes.find((p) => p.id === processId)?.name}`); }
  }
  if (materialId != null && md.materials.find((m) => m.id === materialId)?.processId !== processId) materialId = null;
  return { processId, machineId, materialId, notes, confidence };
}
