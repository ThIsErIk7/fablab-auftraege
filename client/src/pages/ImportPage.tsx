import { IconCheck, IconFile, IconX } from '../components/icons.tsx';
import type { OrderListItem } from '@fablab/shared';
import { formatNumber, PART_STATUS_LABELS } from '@fablab/shared';
import {
  autoMapColumns, collectUnknowns, IMPORT_FIELDS, nameKey, parseCsvBytes, parseWorkbook, validateRows,
  type ColumnMapping, type ImportFieldKey, type ParsedTable, type Resolution, type Resolutions,
} from '@fablab/shared/import';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { emptyOrder, OrderForm, validateOrder, type OrderDraft } from '../components/OrderForm.tsx';
import { useToast } from '../components/Toast.tsx';
import { Button, Card, ErrorBox, Loading, Notice, PageHeader, Segmented, Select } from '../components/ui.tsx';
import { api, download, errorMessage } from '../lib/api.ts';
import { useMasterData } from '../lib/hooks.ts';

const MAX_PREVIEW = 8;

export default function ImportPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { md, isLoading } = useMasterData();
  const orders = useQuery({ queryKey: ['orders', { importTargets: true }], queryFn: () => api.get<OrderListItem[]>('/orders?status=neu,in_bearbeitung,fertig&sort=created&dir=desc') });

  const presetOrder = params.get('auftrag');
  const [targetMode, setTargetMode] = useState<'bestehend' | 'neu'>(presetOrder ? 'bestehend' : 'neu');
  const [orderId, setOrderId] = useState<string>(presetOrder ?? '');
  const [newOrder, setNewOrder] = useState<OrderDraft>(emptyOrder);
  const [orderErrors, setOrderErrors] = useState<Record<string, string>>({});

  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>([]);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [res, setRes] = useState<Resolutions>({ processes: {}, machines: {} });
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async (f: File) => {
    setParseError(null);
    if (f.size > 15 * 1024 * 1024) { setParseError('Datei ist größer als 15 MB.'); return; }
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const t = /\.(xlsx|xls|xlsm|ods)$/i.test(f.name) ? parseWorkbook(bytes) : parseCsvBytes(bytes);
      if (!t.headers.length) throw new Error('Die Datei enthält keine Überschriftenzeile.');
      if (!t.rows.length) throw new Error('Die Datei enthält keine Datenzeilen.');
      setFile({ name: f.name, bytes });
      applyTable(t);
    } catch (e) {
      setFile(null); setTable(null);
      setParseError(`Datei konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const applyTable = (t: ParsedTable) => {
    setTable(t);
    setMapping(autoMapColumns(t.headers));
    setSkip(new Set());
    setRes({ processes: {}, machines: {} });
  };

  const results = useMemo(() => (table && md ? validateRows(table.rows, mapping, md) : []), [table, mapping, md]);
  const unknowns = useMemo(() => collectUnknowns(results), [results]);
  const mappedRequired = mapping.includes('name') && mapping.includes('quantity');

  // Zeilen, die durch "überspringen" bei unbekannten Namen wegfallen
  const skippedByResolution = (r: (typeof results)[number]) =>
    (r.unknownProcess && res.processes[nameKey(r.unknownProcess)]?.action === 'skip') ||
    (r.unknownMachine && res.machines[nameKey(r.unknownMachine)]?.action === 'skip');
  const unresolved = [...unknowns.processes.filter((u) => !res.processes[u.key]), ...unknowns.machines.filter((u) => !res.machines[u.key])];
  const included = results.filter((r) => !skip.has(r.index) && !skippedByResolution(r));
  const withErrors = included.filter((r) => r.errors.length > 0);
  const canImport = !!table && mappedRequired && unresolved.length === 0 && withErrors.length === 0 && included.length > 0;

  const commit = useMutation({
    mutationFn: () => api.post<{ orderId: number; imported: number; skipped: number }>('/import/commit', {
      target: targetMode === 'bestehend' ? { orderId: Number(orderId) } : { newOrder },
      mapping, rows: table!.rows, resolutions: res, skipRows: [...skip], fileName: file?.name,
    }),
    onSuccess: (r) => {
      ['orders', 'order', 'dashboard', 'masterdata', 'queue', 'history'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.show('success', `${r.imported} Teil(e) importiert${r.skipped ? `, ${r.skipped} übersprungen` : ''}.`);
      navigate(`/auftraege/${r.orderId}`);
    },
    onError: (e) => toast.show('error', errorMessage(e)),
  });

  const submit = () => {
    if (targetMode === 'neu') {
      const errs = validateOrder(newOrder);
      setOrderErrors(errs);
      if (Object.keys(errs).length) { toast.show('error', 'Bitte Titel und Auftraggeber:in für den neuen Auftrag angeben.'); return; }
    } else if (!orderId) { toast.show('error', 'Bitte einen Auftrag wählen.'); return; }
    commit.mutate();
  };

  if (isLoading) return <Loading />;
  const setRes1 = (kind: 'processes' | 'machines', key: string, v: Resolution | null) =>
    setRes((r) => { const n = { ...r[kind] }; if (v) n[key] = v; else delete n[key]; return { ...r, [kind]: n }; });

  return (
    <>
      <PageHeader title="Teile importieren" subtitle="Excel (.xlsx/.xls) oder CSV (Komma oder Semikolon, UTF-8). Gespeichert wird erst nach deiner Bestätigung."
        actions={<>
          <Button onClick={() => download('/import/template.xlsx')}>Vorlage XLSX</Button>
          <Button onClick={() => download('/import/template.csv')}>Vorlage CSV</Button>
        </>} />

      {/* 1. Ziel */}
      <Card title="1 · Ziel" className="mb-4">
        <Segmented value={targetMode} onChange={setTargetMode} options={[{ value: 'neu', label: 'Neuer Auftrag' }, { value: 'bestehend', label: 'In bestehenden Auftrag' }]} />
        <div className="mt-4">
          {targetMode === 'bestehend' ? (
            <Select aria-label="Auftrag" value={orderId} onChange={(e) => setOrderId(e.target.value)} className="max-w-xl">
              <option value="">– Auftrag wählen –</option>
              {orders.data?.map((o) => <option key={o.id} value={o.id}>#{o.id} {o.title} ({o.customerName})</option>)}
              {presetOrder && !orders.data?.some((o) => String(o.id) === presetOrder) && <option value={presetOrder}>#{presetOrder}</option>}
            </Select>
          ) : <OrderForm value={newOrder} onChange={setNewOrder} errors={orderErrors} />}
        </div>
      </Card>

      {/* 2. Datei */}
      <Card title="2 · Datei" className="mb-4">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) load(f); }}
          className={`flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-8 text-center ${dragOver ? 'border-brand-500 bg-brand-50 dark:bg-brand-800/20' : 'border-zinc-300 dark:border-zinc-700'}`}>
          <p className="flex flex-wrap items-center justify-center gap-2">{file ? <><IconFile /><b>{file.name}</b> – {table?.rows.length} Datenzeilen{table?.delimiter && `, Trennzeichen „${table.delimiter === '\t' ? 'Tab' : table.delimiter}“`}{table?.encoding === 'windows-1252' && ', Kodierung Windows-1252 erkannt'}</> : 'Datei hierher ziehen oder auswählen'}</p>
          <Button variant="primary" onClick={() => inputRef.current?.click()}>{file ? 'Andere Datei wählen' : 'Datei auswählen'}</Button>
          <input ref={inputRef} type="file" hidden accept=".csv,.txt,.xlsx,.xls,.xlsm,.ods,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ''; }} />
        </div>
        {parseError && <div className="mt-3"><ErrorBox>{parseError}</ErrorBox></div>}
        {table?.sheetNames && table.sheetNames.length > 1 && (
          <label className="mt-3 flex items-center gap-2">Tabellenblatt
            <Select className="w-60" value={table.sheetName} onChange={(e) => applyTable(parseWorkbook(file!.bytes, e.target.value))}>
              {table.sheetNames.map((s) => <option key={s}>{s}</option>)}
            </Select>
          </label>
        )}
      </Card>

      {table && (
        <>
          {/* 3. Zuordnung */}
          <Card title="3 · Spalten zuordnen" className="mb-4">
            <p className="mb-3 text-sm text-zinc-500">Passende Überschriften wurden automatisch zugeordnet. Vorschau der ersten {Math.min(MAX_PREVIEW, table.rows.length)} Zeilen.</p>
            {!mappedRequired && <Notice tone="warn" className="mb-3">Bitte die Pflichtfelder <b>Bezeichnung</b> und <b>Anzahl</b> einer Spalte zuordnen.</Notice>}
            <div className="-mx-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    {table.headers.map((h, i) => (
                      <th key={i} className="min-w-40 px-2 pb-2 text-left align-bottom">
                        <div className="mb-1 truncate font-medium" title={h}>{h || <i className="text-zinc-400">(ohne Titel)</i>}</div>
                        <Select aria-label={`Feld für Spalte ${h}`} className={`!min-h-9 text-sm ${mapping[i] ? 'border-brand-500' : ''}`} value={mapping[i] ?? ''}
                          onChange={(e) => {
                            const v = (e.target.value || null) as ImportFieldKey | null;
                            setMapping((m) => m.map((x, j) => (j === i ? v : x === v ? null : x)));
                          }}>
                          <option value="">– ignorieren –</option>
                          {IMPORT_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>)}
                        </Select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {table.rows.slice(0, MAX_PREVIEW).map((r, ri) => (
                    <tr key={ri}>{table.headers.map((_, ci) => <td key={ci} className={`max-w-56 truncate px-2 py-1.5 ${mapping[ci] ? '' : 'text-zinc-400'}`}>{r[ci] === null || r[ci] === undefined ? '' : String(r[ci])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* 4. Unbekannte Namen */}
          {mappedRequired && (unknowns.processes.length > 0 || unknowns.machines.length > 0) && (
            <Card title="4 · Unbekannte Verfahren / Maschinen" className="mb-4">
              <div className="space-y-3">
                {unknowns.processes.map((u) => (
                  <ResolveRow key={`p-${u.key}`} label={<>Verfahren <b>„{u.name}“</b></>} rows={u.rows} value={res.processes[u.key]}
                    options={md!.processes.map((p) => ({ id: p.id, name: p.name }))} onChange={(v) => setRes1('processes', u.key, v)} />
                ))}
                {unknowns.machines.map((u) => (
                  <ResolveRow key={`m-${u.key}`} label={<>Maschine <b>„{u.name}“</b>{u.processName && <span className="text-zinc-500"> (Verfahren: {u.processName})</span>}</>} rows={u.rows}
                    value={res.machines[u.key]} options={md!.machines.map((m) => ({ id: m.id, name: m.name }))}
                    processes={md!.processes} defaultProcessId={u.processId}
                    onChange={(v) => setRes1('machines', u.key, v)} />
                ))}
              </div>
            </Card>
          )}

          {/* 5. Prüfung */}
          {mappedRequired && (
            <Card title={`${unknowns.processes.length + unknowns.machines.length ? 5 : 4} · Prüfung & Bestätigung`} className="mb-4">
              <div className="mb-3 flex flex-wrap gap-4 text-sm">
                <span className="inline-flex items-center gap-1 font-semibold"><IconCheck className="text-ok" />{included.length - withErrors.length} bereit</span>
                {withErrors.length > 0 && <span className="inline-flex items-center gap-1 font-semibold text-bad"><IconX />{withErrors.length} mit Fehlern</span>}
                <span className="text-zinc-500">{results.length - included.length} übersprungen</span>
                {withErrors.length > 0 && <Button size="sm" onClick={() => setSkip(new Set([...skip, ...withErrors.map((r) => r.index)]))}>Fehlerhafte Zeilen überspringen</Button>}
              </div>
              <div className="-mx-4 max-h-[28rem] overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-white text-left text-zinc-500 dark:bg-zinc-900">
                    <tr><th className="px-3 py-2">Import</th><th className="px-2">Zeile</th><th className="px-2">Bezeichnung</th><th className="px-2">Anz.</th><th className="px-2">Maschine / Verfahren</th><th className="px-2">Material</th><th className="px-2">Status</th><th className="px-2">Hinweise</th></tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {results.map((r) => {
                      const resolvedSkip = skippedByResolution(r);
                      const on = !skip.has(r.index) && !resolvedSkip;
                      const machineLabel = md!.machines.find((m) => m.id === r.part.machineId)?.name ?? r.unknownMachine ?? '';
                      const procLabel = md!.processes.find((p) => p.id === r.part.processId)?.name ?? r.unknownProcess ?? '';
                      return (
                        <tr key={r.index} className={!on ? 'opacity-40' : r.errors.length ? 'bg-bad/10' : r.warnings.length ? 'bg-warn/10' : ''}>
                          <td className="px-3 py-1.5">
                            <input type="checkbox" className="h-6 w-6 accent-brand-700" checked={on} disabled={!!resolvedSkip} aria-label={`Zeile ${r.line} importieren`}
                              onChange={(e) => { const n = new Set(skip); if (e.target.checked) n.delete(r.index); else n.add(r.index); setSkip(n); }} />
                          </td>
                          <td className="tabular px-2">{r.line}</td>
                          <td className="px-2">{r.part.name || <i className="text-bad">fehlt</i>}</td>
                          <td className="tabular px-2">{r.raw.quantity ?? ''}</td>
                          <td className="px-2">{machineLabel || procLabel ? <>{machineLabel}{machineLabel && procLabel && <span className="text-zinc-500"> · </span>}<span className="text-zinc-500">{procLabel}</span></> : '–'}</td>
                          <td className="px-2">{md!.materials.find((m) => m.id === r.part.materialId)?.name ?? r.part.materialText ?? ''}{r.part.materialAmount != null && <span className="text-zinc-500"> ({formatNumber(r.part.materialAmount, 3)})</span>}</td>
                          <td className="px-2">{PART_STATUS_LABELS[r.part.status]}</td>
                          <td className="px-2 text-xs">
                            {r.errors.map((e) => <div key={e} className="font-semibold text-bad">{e}</div>)}
                            {r.warnings.map((w) => <div key={w} className="text-zinc-600 dark:text-zinc-400">Hinweis: {w}</div>)}
                            {r.unknownProcess && !res.processes[nameKey(r.unknownProcess)] && <div className="text-zinc-900 dark:text-white">? Verfahren unbekannt</div>}
                            {r.unknownMachine && !res.machines[nameKey(r.unknownMachine)] && <div className="text-zinc-900 dark:text-white">? Maschine unbekannt</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
                {unresolved.length > 0 && <span className="text-sm text-zinc-900 dark:text-white">Bitte erst alle unbekannten Namen auflösen.</span>}
                {withErrors.length > 0 && <span className="text-sm text-bad">Fehlerhafte Zeilen korrigieren oder abwählen.</span>}
                <Button variant="ghost" onClick={() => navigate(-1)}>Abbrechen</Button>
                <Button variant="primary" size="lg" disabled={!canImport} loading={commit.isPending} onClick={submit}>
                  {included.length} Teil(e) importieren
                </Button>
              </div>
            </Card>
          )}
        </>
      )}
    </>
  );
}

function ResolveRow({ label, rows, value, options, onChange, processes, defaultProcessId }: {
  label: React.ReactNode; rows: number[]; value: Resolution | undefined; options: { id: number; name: string }[];
  onChange: (v: Resolution | null) => void; processes?: { id: number; name: string }[]; defaultProcessId?: number | null;
}) {
  const action = value?.action ?? '';
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-md border p-3 ${value ? 'border-ok' : 'border-warn'}`}>
      <div className="min-w-56 flex-1">{label}<div className="text-xs text-zinc-500">Zeile {rows.slice(0, 10).join(', ')}{rows.length > 10 ? ' …' : ''}</div></div>
      <Select aria-label="Aktion" className="w-52" value={action} onChange={(e) => {
        const a = e.target.value;
        if (a === 'map') onChange({ action: 'map', id: options[0]?.id });
        else if (a === 'create') onChange({ action: 'create', processId: defaultProcessId ?? processes?.[0]?.id });
        else if (a === 'skip') onChange({ action: 'skip' });
        else onChange(null);
      }}>
        <option value="">– bitte wählen –</option>
        <option value="map">Vorhandenem zuordnen</option>
        <option value="create">Neu anlegen</option>
        <option value="skip">Zeilen überspringen</option>
      </Select>
      {value?.action === 'map' && (
        <Select aria-label="Zuordnen zu" className="w-72" value={value.id} onChange={(e) => onChange({ action: 'map', id: Number(e.target.value) })}>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
      )}
      {value?.action === 'create' && processes && (
        <label className="flex items-center gap-2 text-sm">im Verfahren
          <Select className="w-60" value={value.processId ?? ''} onChange={(e) => onChange({ action: 'create', processId: Number(e.target.value) })}>
            {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </label>
      )}
    </div>
  );
}
