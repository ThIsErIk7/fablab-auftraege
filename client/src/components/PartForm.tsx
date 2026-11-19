import type { MasterData, Part, PartInput, PartStatus } from '@fablab/shared';
import { MATERIAL_UNIT_LABELS, MAX_BUILD_VOLUME_MM, PART_STATUSES, PART_STATUS_LABELS } from '@fablab/shared';
import { useId } from 'react';
import { Field, Input, NumberInput, Notice, Select, Textarea } from './ui.tsx';

export type PartDraft = Omit<PartInput, 'done'>;

export const emptyPart = (prev?: Partial<PartDraft>): PartDraft => ({
  name: '', quantity: 1,
  // Verfahren/Maschine/Material vom vorherigen Teil übernehmen – spart Klicks beim Serien-Anlegen
  processId: prev?.processId ?? null, machineId: prev?.machineId ?? null, materialId: prev?.materialId ?? null,
  materialText: prev?.materialText ?? null, color: prev?.color ?? null,
  dimW: null, dimD: null, dimH: null, fileRef: null, estMinutes: null, actualMinutes: null, materialAmount: null,
  status: 'offen', notes: null,
});

export const partToDraft = (p: Part): PartDraft => {
  const { id: _i, orderId: _o, sort: _s, done: _d, ...rest } = p;
  return rest;
};

/** Passt das Teil in den größten Bauraum? Drehen ist erlaubt (Maße sortiert vergleichen). */
export function exceedsBuildVolume(p: Pick<PartDraft, 'dimW' | 'dimD' | 'dimH'>): boolean {
  const dims = [p.dimW, p.dimD, p.dimH].map((x) => x ?? 0).sort((a, b) => b - a);
  const vol = [MAX_BUILD_VOLUME_MM.w, MAX_BUILD_VOLUME_MM.d, MAX_BUILD_VOLUME_MM.h].sort((a, b) => b - a);
  return dims.some((d, i) => d > vol[i]);
}

export function validatePart(p: PartDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!p.name.trim()) e.name = 'Bitte eine Bezeichnung angeben.';
  if (!Number.isInteger(p.quantity) || p.quantity < 1) e.quantity = 'Ganze Zahl ≥ 1';
  return e;
}

const fmtDuration = (m: number | null) => (m == null ? '' : m >= 60 ? `= ${Math.floor(m / 60)} h ${m % 60} min` : '');

export function PartForm({ value, onChange, md, errors = {}, compact }: { value: PartDraft; onChange: (p: PartDraft) => void; md: MasterData; errors?: Record<string, string>; compact?: boolean }) {
  const listId = useId();
  const set = <K extends keyof PartDraft>(k: K, v: PartDraft[K]) => onChange({ ...value, [k]: v });
  const nn = (s: string) => (s.trim() === '' ? null : s);

  const processes = md.processes.filter((p) => p.active || p.id === value.processId);
  const machines = md.machines.filter((m) => m.processId === value.processId && (m.active || m.id === value.machineId));
  const materials = md.materials.filter((m) => (value.processId == null || m.processId === value.processId) && (m.active || m.id === value.materialId));
  const material = md.materials.find((m) => m.id === value.materialId);
  const materialLabel = material?.name ?? value.materialText ?? '';
  const selectedMachine = md.machines.find((m) => m.id === value.machineId);
  const tooBig = exceedsBuildVolume(value);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Bezeichnung" required error={errors.name} className="sm:col-span-2 lg:col-span-3">
        <Input value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="z. B. Gehäuse Deckel" />
      </Field>
      <Field label="Anzahl" required error={errors.quantity}>
        <NumberInput integer value={value.quantity} onChange={(v) => set('quantity', v ?? 1)} min={1} />
      </Field>

      <Field label="Verfahren">
        <Select value={value.processId ?? ''} onChange={(e) => {
          const pid = e.target.value ? Number(e.target.value) : null;
          const keepMat = material && material.processId === pid;
          onChange({ ...value, processId: pid, machineId: null, materialId: keepMat ? value.materialId : null, materialText: keepMat ? null : (material?.name ?? value.materialText) });
        }}>
          <option value="">– wählen –</option>
          {processes.map((p) => <option key={p.id} value={p.id}>{p.name}{!p.active ? ' (deaktiviert)' : ''}</option>)}
        </Select>
      </Field>
      <Field label="Maschine" hint={value.processId == null ? 'Erst Verfahren wählen' : selectedMachine?.note ?? undefined}>
        <Select value={value.machineId ?? ''} disabled={value.processId == null} onChange={(e) => set('machineId', e.target.value ? Number(e.target.value) : null)}>
          <option value="">– offen –</option>
          {machines.map((m) => <option key={m.id} value={m.id}>{m.name}{!m.active ? ` (deaktiviert${m.note ? ': ' + m.note : ''})` : ''}</option>)}
        </Select>
      </Field>
      <Field label="Material" hint={material ? `Preisliste: ${material.name}` : value.materialText ? 'Freitext – ohne hinterlegten Preis' : 'Vorschlag wählen oder frei eingeben'}>
        <Input list={listId} value={materialLabel} onChange={(e) => {
          const t = e.target.value;
          const hit = materials.find((m) => m.name.toLowerCase() === t.trim().toLowerCase());
          onChange({ ...value, materialId: hit?.id ?? null, materialText: hit ? null : nn(t) });
        }} />
        <datalist id={listId}>{materials.map((m) => <option key={m.id} value={m.name} />)}</datalist>
      </Field>
      <Field label="Farbe">
        <Input value={value.color ?? ''} onChange={(e) => set('color', nn(e.target.value))} />
      </Field>

      <fieldset className="sm:col-span-2">
        <legend className="label">Maße B × T × H (mm)</legend>
        <div className="grid grid-cols-3 gap-2">
          <NumberInput aria-label="Breite in mm" placeholder="B" value={value.dimW} onChange={(v) => set('dimW', v)} />
          <NumberInput aria-label="Tiefe in mm" placeholder="T" value={value.dimD} onChange={(v) => set('dimD', v)} />
          <NumberInput aria-label="Höhe in mm" placeholder="H" value={value.dimH} onChange={(v) => set('dimH', v)} />
        </div>
      </fieldset>
      <Field label="Datei / Link" className="sm:col-span-2" hint="STL, 3MF, SVG, DXF … oder Link">
        <Input value={value.fileRef ?? ''} onChange={(e) => set('fileRef', nn(e.target.value))} placeholder="dateiname.stl" />
      </Field>
      {tooBig && (
        <Notice tone="warn" className="sm:col-span-2 lg:col-span-4">
          <b>Zu groß:</b> Die Maße überschreiten den größten Bauraum im Lab ({MAX_BUILD_VOLUME_MM.w} × {MAX_BUILD_VOLUME_MM.d} × {MAX_BUILD_VOLUME_MM.h} mm) – auch gedreht. Teil ggf. aufteilen.
        </Notice>
      )}

      <Field label="Geschätzte Dauer (min)" hint={fmtDuration(value.estMinutes)}>
        <NumberInput integer value={value.estMinutes} onChange={(v) => set('estMinutes', v)} />
      </Field>
      <Field label="Tatsächliche Maschinenzeit (min)" hint={fmtDuration(value.actualMinutes) || 'Grundlage für die Rechnung'}>
        <NumberInput integer value={value.actualMinutes} onChange={(v) => set('actualMinutes', v)} />
      </Field>
      <Field label={`Materialverbrauch${material ? ` (${MATERIAL_UNIT_LABELS[material.unit]})` : ''}`} hint={material ? undefined : 'g, m² oder Stück – je nach Material'}>
        <NumberInput value={value.materialAmount} onChange={(v) => set('materialAmount', v)} />
      </Field>
      <Field label="Status">
        <Select value={value.status} onChange={(e) => set('status', e.target.value as PartStatus)}>
          {PART_STATUSES.map((s) => <option key={s} value={s}>{PART_STATUS_LABELS[s]}</option>)}
        </Select>
      </Field>

      {!compact && (
        <Field label="Notizen" className="sm:col-span-2 lg:col-span-4">
          <Textarea value={value.notes ?? ''} onChange={(e) => set('notes', nn(e.target.value))} rows={2} />
        </Field>
      )}
    </div>
  );
}
