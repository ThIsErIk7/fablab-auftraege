import { IconEdit } from '../../components/icons.tsx';
import type { CustomerDiscount, InvoiceSettings, Machine, Material, MaterialUnit, Process } from '@fablab/shared';
import {
  CUSTOMER_TYPES, CUSTOMER_TYPE_LABELS, formatInvoiceNumber, formatMills, MATERIAL_PRICE_UNIT_LABELS, MATERIAL_UNITS, MATERIAL_UNIT_LABELS,
  validateNumberFormat,
} from '@fablab/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useToast } from '../../components/Toast.tsx';
import { Button, Card, ErrorBox, Field, Input, Loading, Modal, MoneyInput, Notice, NumberInput, PageHeader, Select, Textarea, Toggle } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { useInvoiceSettings, useMasterData } from '../../lib/hooks.ts';

const TABS = [
  { to: '/admin', label: 'Verfahren & Maschinen', end: true },
  { to: '/admin/materialien', label: 'Materialien' },
  { to: '/admin/preise', label: 'Preise & Rabatte' },
  { to: '/admin/rechnung', label: 'Rechnungseinstellungen' },
];

export default function AdminPage() {
  return (
    <>
      <PageHeader title="Einstellungen" />
      <nav className="-mt-4 mb-8 flex gap-2 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className={({ isActive }) => `flex min-h-12 shrink-0 items-center border-b-2 px-3 text-xs font-bold uppercase tracking-[0.12em] ${isActive ? 'border-brand-500 text-zinc-900 dark:text-white' : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white'}`}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<MachinesTab />} />
        <Route path="materialien" element={<MaterialsTab />} />
        <Route path="preise" element={<PricesTab />} />
        <Route path="rechnung" element={<InvoiceSettingsTab />} />
      </Routes>
    </>
  );
}

function useSave<T>(fn: (v: T) => Promise<unknown>, msg = 'Gespeichert.', after?: () => void) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['masterdata'] }); toast.show('success', msg); after?.(); },
    onError: (e) => toast.show('error', errorMessage(e)),
  });
}

const euro = (c: number) => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

// ---------------------------------------------------------------------------

function MachinesTab() {
  const { md, isLoading, error } = useMasterData();
  const [machine, setMachine] = useState<Partial<Machine> | null>(null);
  const [proc, setProc] = useState<Partial<Process> | null>(null);
  const saveMachine = useSave((m: Partial<Machine>) => (m.id ? api.patch(`/machines/${m.id}`, strip(m)) : api.post('/machines', strip(m))), 'Maschine gespeichert.', () => setMachine(null));
  const saveProc = useSave((p: Partial<Process>) => (p.id ? api.patch(`/processes/${p.id}`, strip(p)) : api.post('/processes', strip(p))), 'Verfahren gespeichert.', () => setProc(null));
  const toggle = useSave((m: Machine) => api.patch(`/machines/${m.id}`, { active: !m.active }), 'Status geändert.');
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  return (
    <>
      <div className="mb-4 flex justify-end"><Button variant="primary" onClick={() => setProc({ name: '', active: true, aliases: '', sort: md!.processes.length })}>+ Verfahren</Button></div>
      <div className="grid gap-4 lg:grid-cols-2">
        {md!.processes.map((p) => (
          <Card key={p.id} title={<span className={p.active ? '' : 'text-zinc-400 line-through'}>{p.name}</span>} actions={<>
            <Button size="sm" variant="ghost" onClick={() => setProc(p)}>Bearbeiten</Button>
            <Button size="sm" onClick={() => setMachine({ processId: p.id, name: '', active: true, note: null, hourlyRateCents: 0, jobFlatCents: 0, aliases: '', sort: 0 })}>+ Maschine</Button>
          </>}>
            <ul className="-my-2 divide-y divide-zinc-200 dark:divide-zinc-800">
              {md!.machines.filter((m) => m.processId === p.id).map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className={m.active ? 'font-medium' : 'font-medium text-zinc-400'}>{m.name}</div>
                    {m.aliases && <div className="truncate text-xs text-zinc-500" title={m.aliases}>auch: {m.aliases}</div>}
                    <div className="text-sm text-zinc-500">{euro(m.hourlyRateCents)}/h{m.jobFlatCents ? ` · ${euro(m.jobFlatCents)} pro Job` : ''}{!m.active && <span className="text-zinc-900 dark:text-white"> · deaktiviert{m.note ? `: ${m.note}` : ''}</span>}</div>
                  </div>
                  <Button size="sm" variant={m.active ? 'secondary' : 'success'} onClick={() => toggle.mutate(m)}>{m.active ? 'Deaktivieren' : 'Aktivieren'}</Button>
                  <Button icon size="sm" variant="ghost" aria-label="Bearbeiten" title="Bearbeiten" onClick={() => setMachine(m)}><IconEdit /></Button>
                </li>
              ))}
              {!md!.machines.some((m) => m.processId === p.id) && <li className="py-2 text-zinc-500">Keine Maschinen.</li>}
            </ul>
          </Card>
        ))}
      </div>

      <Modal open={!!machine} onClose={() => setMachine(null)} title={machine?.id ? 'Maschine bearbeiten' : 'Neue Maschine'}
        footer={<><Button onClick={() => setMachine(null)}>Abbrechen</Button><Button variant="primary" loading={saveMachine.isPending} onClick={() => saveMachine.mutate(machine!)}>Speichern</Button></>}>
        {machine && (
          <div className="grid gap-4">
            <Field label="Name" required><Input value={machine.name ?? ''} onChange={(e) => setMachine({ ...machine, name: e.target.value })} /></Field>
            <Field label="Alternativnamen (Import)" hint="Kommagetrennt. Damit erkennt der Import auch andere Schreibweisen aus Excel/CSV."><Input value={machine.aliases ?? ''} placeholder="z. B. Bambu, X1C, BBL" onChange={(e) => setMachine({ ...machine, aliases: e.target.value })} /></Field>
            <Field label="Verfahren" hint="Jede Maschine gehört zu genau einem Verfahren.">
              <Select value={machine.processId} onChange={(e) => setMachine({ ...machine, processId: Number(e.target.value) })}>
                {md!.processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Stundensatz (netto)"><MoneyInput cents={machine.hourlyRateCents ?? 0} onChange={(c) => setMachine({ ...machine, hourlyRateCents: c ?? 0 })} /></Field>
              <Field label="Pauschale pro Job (netto)"><MoneyInput cents={machine.jobFlatCents ?? 0} onChange={(c) => setMachine({ ...machine, jobFlatCents: c ?? 0 })} /></Field>
            </div>
            <Toggle checked={machine.active ?? true} onChange={(v) => setMachine({ ...machine, active: v })} label="Aktiv" hint="Deaktivierte Maschinen (z. B. in Wartung) erscheinen nicht mehr in der Auswahl für neue Teile." />
            <Field label="Hinweis" hint="z. B. „In Wartung bis 30.11.“"><Input value={machine.note ?? ''} onChange={(e) => setMachine({ ...machine, note: e.target.value || null })} /></Field>
          </div>
        )}
      </Modal>
      <Modal open={!!proc} onClose={() => setProc(null)} title={proc?.id ? 'Verfahren bearbeiten' : 'Neues Verfahren'}
        footer={<><Button onClick={() => setProc(null)}>Abbrechen</Button><Button variant="primary" loading={saveProc.isPending} onClick={() => saveProc.mutate(proc!)}>Speichern</Button></>}>
        {proc && (
          <div className="grid gap-4">
            <Field label="Name" required><Input value={proc.name ?? ''} onChange={(e) => setProc({ ...proc, name: e.target.value })} /></Field>
            <Field label="Alternativnamen (Import)" hint="Kommagetrennt. Damit erkennt der Import auch andere Schreibweisen aus Excel/CSV."><Input value={proc.aliases ?? ''} placeholder="z. B. Laser, Lasern, Gravur" onChange={(e) => setProc({ ...proc, aliases: e.target.value })} /></Field>
            <Field label="Reihenfolge"><NumberInput integer value={proc.sort ?? 0} onChange={(v) => setProc({ ...proc, sort: v ?? 0 })} /></Field>
            <Toggle checked={proc.active ?? true} onChange={(v) => setProc({ ...proc, active: v })} label="Aktiv" />
          </div>
        )}
      </Modal>
    </>
  );
}

const strip = <T extends object>(o: T) => { const { id: _i, ...rest } = o as any; return rest; };

// ---------------------------------------------------------------------------

function MaterialsTab() {
  const { md, isLoading } = useMasterData();
  const [mat, setMat] = useState<Partial<Material> | null>(null);
  const save = useSave((m: Partial<Material>) => (m.id ? api.patch(`/materials/${m.id}`, strip(m)) : api.post('/materials', strip(m))), 'Material gespeichert.', () => setMat(null));
  const toggle = useSave((m: Material) => api.patch(`/materials/${m.id}`, { active: !m.active }), 'Status geändert.');
  if (isLoading) return <Loading />;
  return (
    <>
      <p className="mb-4 text-zinc-600 dark:text-zinc-400">Materialien erscheinen im Teil-Formular als Vorschlagsliste für das jeweilige Verfahren. Freitext bleibt immer möglich (dann ohne automatischen Preis).</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {md!.processes.map((p) => (
          <Card key={p.id} title={p.name} actions={<Button size="sm" onClick={() => setMat({ processId: p.id, name: '', unit: 'g', priceMills: 0, active: true, aliases: '', sort: 0 })}>+ Material</Button>}>
            <ul className="-my-2 divide-y divide-zinc-200 dark:divide-zinc-800">
              {md!.materials.filter((m) => m.processId === p.id).map((m) => (
                <li key={m.id} className="flex items-center gap-2 py-2">
                  <div className="flex-1"><span className={m.active ? '' : 'text-zinc-400 line-through'}>{m.name}</span>
                    <span className="ml-2 text-sm text-zinc-500">{formatMills(m.priceMills)} {MATERIAL_PRICE_UNIT_LABELS[m.unit].replace('€', '')}</span></div>
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate(m)}>{m.active ? 'Deaktivieren' : 'Aktivieren'}</Button>
                  <Button icon size="sm" variant="ghost" aria-label="Bearbeiten" title="Bearbeiten" onClick={() => setMat(m)}><IconEdit /></Button>
                </li>
              ))}
              {!md!.materials.some((m) => m.processId === p.id) && <li className="py-2 text-zinc-500">Keine Materialien.</li>}
            </ul>
          </Card>
        ))}
      </div>
      <Modal open={!!mat} onClose={() => setMat(null)} title={mat?.id ? 'Material bearbeiten' : 'Neues Material'}
        footer={<><Button onClick={() => setMat(null)}>Abbrechen</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(mat!)}>Speichern</Button></>}>
        {mat && (
          <div className="grid gap-4">
            <Field label="Name" required><Input value={mat.name ?? ''} onChange={(e) => setMat({ ...mat, name: e.target.value })} /></Field>
            <Field label="Alternativnamen (Import)" hint="Kommagetrennt. Damit erkennt der Import auch andere Schreibweisen aus Excel/CSV."><Input value={mat.aliases ?? ''} placeholder="z. B. Plexiglas, PMMA" onChange={(e) => setMat({ ...mat, aliases: e.target.value })} /></Field>
            <Field label="Verfahren">
              <Select value={mat.processId} onChange={(e) => setMat({ ...mat, processId: Number(e.target.value) })}>
                {md!.processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Verbrauchseinheit" hint="Preis gilt pro Einheit, z. B. €/g (FDM) oder €/ml (SLA).">
                <Select value={mat.unit} onChange={(e) => setMat({ ...mat, unit: e.target.value as MaterialUnit })}>
                  {MATERIAL_UNITS.map((u) => <option key={u} value={u}>{MATERIAL_UNIT_LABELS[u]}</option>)}
                </Select>
              </Field>
              <Field label={`Preis (netto, ${MATERIAL_PRICE_UNIT_LABELS[mat.unit ?? 'g']})`}><MoneyInput mills cents={mat.priceMills ?? 0} onChange={(c) => setMat({ ...mat, priceMills: c ?? 0 })} /></Field>
            </div>
            <Toggle checked={mat.active ?? true} onChange={(v) => setMat({ ...mat, active: v })} label="Aktiv" />
          </div>
        )}
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------

function PricesTab() {
  const { md, isLoading } = useMasterData();
  const qc = useQueryClient();
  const toast = useToast();
  const [machines, setMachines] = useState<Record<number, { h: number; f: number }>>({});
  const [materials, setMaterials] = useState<Record<number, number>>({});
  const [discounts, setDiscounts] = useState<CustomerDiscount[]>([]);
  useEffect(() => {
    if (!md) return;
    setMachines(Object.fromEntries(md.machines.map((m) => [m.id, { h: m.hourlyRateCents, f: m.jobFlatCents }])));
    setMaterials(Object.fromEntries(md.materials.map((m) => [m.id, m.priceMills])));
    setDiscounts(CUSTOMER_TYPES.map((t) => md.discounts.find((d) => d.customerType === t) ?? { customerType: t, percentBp: 0, label: '' }));
  }, [md]);

  const save = useMutation({
    mutationFn: async () => {
      // Nur geänderte Werte senden
      const jobs: Promise<unknown>[] = [];
      for (const m of md!.machines) {
        const v = machines[m.id];
        if (v && (v.h !== m.hourlyRateCents || v.f !== m.jobFlatCents)) jobs.push(api.patch(`/machines/${m.id}`, { hourlyRateCents: v.h, jobFlatCents: v.f }));
      }
      for (const m of md!.materials) if (materials[m.id] !== undefined && materials[m.id] !== m.priceMills) jobs.push(api.patch(`/materials/${m.id}`, { priceMills: materials[m.id] }));
      jobs.push(api.put('/discounts', discounts));
      await Promise.all(jobs);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['masterdata'] }); toast.show('success', 'Preise gespeichert.'); },
    onError: (e) => toast.show('error', errorMessage(e)),
  });
  if (isLoading || !md) return <Loading />;

  return (
    <>
      <Notice className="mb-4">Alle Preise netto. Gilt für neu erzeugte Rechnungsentwürfe – bestehende Entwürfe lassen sich mit „Aus Teilen neu berechnen“ aktualisieren, gestellte Rechnungen bleiben unverändert.</Notice>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Maschinen">
          <table className="w-full text-sm">
            <thead className="text-left text-[0.65rem] font-bold uppercase tracking-[0.12em] text-zinc-500"><tr><th className="pb-2">Maschine</th><th className="w-32 pb-2">€/Stunde</th><th className="w-32 pb-2">€/Job</th></tr></thead>
            <tbody>
              {md.processes.map((p) => [
                <tr key={`p${p.id}`}><td colSpan={3} className="pb-1 pt-5 text-sm font-bold uppercase tracking-[0.06em]">{p.name}</td></tr>,
                ...md.machines.filter((m) => m.processId === p.id).map((m) => (
                  <tr key={m.id}>
                    <td className="py-1 pr-2">{m.name}</td>
                    <td className="py-1 pr-1"><MoneyInput aria-label={`Stundensatz ${m.name}`} cents={machines[m.id]?.h ?? 0} onChange={(c) => setMachines({ ...machines, [m.id]: { ...machines[m.id], h: c ?? 0 } })} /></td>
                    <td className="py-1"><MoneyInput aria-label={`Pauschale ${m.name}`} cents={machines[m.id]?.f ?? 0} onChange={(c) => setMachines({ ...machines, [m.id]: { ...machines[m.id], f: c ?? 0 } })} /></td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="Materialien">
            <table className="w-full text-sm">
              <thead className="text-left text-[0.65rem] font-bold uppercase tracking-[0.12em] text-zinc-500"><tr><th className="pb-2">Material</th><th className="w-24 pb-2">Einheit</th><th className="w-32 pb-2">Preis</th></tr></thead>
              <tbody>
                {md.processes.filter((p) => md.materials.some((m) => m.processId === p.id)).map((p) => [
                  <tr key={`p${p.id}`}><td colSpan={3} className="pb-1 pt-5 text-sm font-bold uppercase tracking-[0.06em]">{p.name}</td></tr>,
                  ...md.materials.filter((m) => m.processId === p.id).map((m) => (
                    <tr key={m.id}>
                      <td className="py-1 pr-2">{m.name}</td>
                      <td className="py-1 text-zinc-500">{MATERIAL_PRICE_UNIT_LABELS[m.unit]}</td>
                      <td className="py-1"><MoneyInput mills aria-label={`Preis ${m.name}`} cents={materials[m.id] ?? 0} onChange={(c) => setMaterials({ ...materials, [m.id]: c ?? 0 })} /></td>
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </Card>
          <Card title="Rabatte pro Kundentyp">
            <p className="mb-3 text-sm text-zinc-500">Wird automatisch auf alle aus Teilen berechneten Positionen angewendet (z. B. Studierende, Mitglieder, Hochschule).</p>
            <div className="space-y-2">
              {discounts.map((d, i) => (
                <div key={d.customerType} className="grid grid-cols-[7rem_6rem_1fr] items-center gap-2">
                  <span className="font-medium">{CUSTOMER_TYPE_LABELS[d.customerType]}</span>
                  <div className="relative"><NumberInput aria-label={`Rabatt ${CUSTOMER_TYPE_LABELS[d.customerType]} in Prozent`} className="pr-7 text-right" value={d.percentBp / 100}
                    onChange={(v) => setDiscounts(discounts.map((x, j) => (j === i ? { ...x, percentBp: Math.round(Math.min(100, Math.max(0, v ?? 0)) * 100) } : x)))} />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500">%</span></div>
                  <Input aria-label="Bezeichnung" placeholder="Bezeichnung (intern)" value={d.label} onChange={(e) => setDiscounts(discounts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
      <div className="sticky bottom-16 mt-4 flex justify-end lg:bottom-4"><Button variant="primary" size="lg" onClick={() => save.mutate()} loading={save.isPending}>Preise speichern</Button></div>
    </>
  );
}

// ---------------------------------------------------------------------------

function InvoiceSettingsTab() {
  const q = useInvoiceSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const [s, setS] = useState<InvoiceSettings | null>(null);
  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);
  const save = useMutation({
    mutationFn: (v: InvoiceSettings) => api.put<InvoiceSettings>('/settings/invoice', v),
    onSuccess: (v) => { qc.setQueryData(['settings', 'invoice'], v); qc.invalidateQueries({ queryKey: ['invoice'] }); toast.show('success', 'Rechnungseinstellungen gespeichert.'); },
    onError: (e) => toast.show('error', errorMessage(e)),
  });
  if (q.isLoading || !s) return <Loading />;
  const set = <K extends keyof InvoiceSettings>(k: K, v: InvoiceSettings[K]) => setS({ ...s, [k]: v });
  const nn = (v: string) => (v.trim() ? v : null);
  const fmtErr = validateNumberFormat(s.numberFormat);
  const year = new Date().getFullYear();

  const onLogo = (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpe?g)$/.test(f.type)) { toast.show('error', 'Logo bitte als PNG oder JPG.'); return; }
    if (f.size > 1_400_000) { toast.show('error', 'Logo ist zu groß (max. ca. 1,4 MB).'); return; }
    const r = new FileReader();
    r.onload = () => set('logoDataUrl', String(r.result));
    r.readAsDataURL(f);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Absender">
        <div className="grid gap-4">
          <Field label="Name / Organisation" required><Input value={s.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Anschrift" required hint="mehrzeilig: Straße, PLZ Ort"><Textarea value={s.address} onChange={(e) => set('address', e.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="E-Mail"><Input value={s.email ?? ''} onChange={(e) => set('email', nn(e.target.value))} /></Field>
            <Field label="Telefon"><Input value={s.phone ?? ''} onChange={(e) => set('phone', nn(e.target.value))} /></Field>
            <Field label="Website"><Input value={s.website ?? ''} onChange={(e) => set('website', nn(e.target.value))} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Steuernummer"><Input value={s.taxNumber ?? ''} onChange={(e) => set('taxNumber', nn(e.target.value))} /></Field>
            <Field label="USt-IdNr."><Input value={s.vatId ?? ''} onChange={(e) => set('vatId', nn(e.target.value))} /></Field>
          </div>
          {!s.taxNumber && !s.vatId && <Notice tone="warn">Steuernummer oder USt-IdNr. ist Pflichtangabe auf Rechnungen.</Notice>}
          <Field label="Logo (PNG/JPG)">
            <div className="flex items-center gap-3">
              {s.logoDataUrl && <img src={s.logoDataUrl} alt="Logo" className="h-14 max-w-40 rounded border border-zinc-200 bg-white object-contain p-1" />}
              <span className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-zinc-300 px-4 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                {s.logoDataUrl ? 'Anderes Logo wählen' : 'Logo wählen'}
                <input type="file" accept="image/png,image/jpeg" onChange={(e) => onLogo(e.target.files?.[0])} className="sr-only" />
              </span>
              {s.logoDataUrl && <Button size="sm" variant="ghost" onClick={() => set('logoDataUrl', null)}>Entfernen</Button>}
            </div>
          </Field>
        </div>
      </Card>
      <div className="flex flex-col gap-4">
        <Card title="Bankverbindung">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bank"><Input value={s.bankName ?? ''} onChange={(e) => set('bankName', nn(e.target.value))} /></Field>
            <Field label="Kontoinhaber:in"><Input value={s.accountHolder ?? ''} onChange={(e) => set('accountHolder', nn(e.target.value))} /></Field>
            <Field label="IBAN"><Input value={s.iban ?? ''} onChange={(e) => set('iban', nn(e.target.value))} /></Field>
            <Field label="BIC"><Input value={s.bic ?? ''} onChange={(e) => set('bic', nn(e.target.value))} /></Field>
          </div>
        </Card>
        <Card title="Rechnung">
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Rechnungsnummern-Format" error={fmtErr} hint={!fmtErr && <>Platzhalter {'{YYYY} {YY} {MM} {####}'} · Beispiel: <b>{formatInvoiceNumber(s.numberFormat, year, 1, 1)}</b></>}>
                <Input value={s.numberFormat} onChange={(e) => set('numberFormat', e.target.value)} />
              </Field>
              <Field label="Zahlungsziel (Tage)"><NumberInput integer value={s.paymentTermDays} onChange={(v) => set('paymentTermDays', v ?? 0)} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="USt.-Satz (%)" hint="0 = keine Umsatzsteuer"><NumberInput value={s.taxRateBp / 100} onChange={(v) => set('taxRateBp', Math.round((v ?? 0) * 100))} /></Field>
              <Field label="Hinweistext bei 0 %" hint="z. B. Kleinunternehmerregelung § 19 UStG oder Steuerbefreiung" error={s.taxRateBp === 0 && !s.taxExemptNote.trim() ? 'Bei 0 % erforderlich' : null}>
                <Input value={s.taxExemptNote} onChange={(e) => set('taxExemptNote', e.target.value)} />
              </Field>
            </div>
            <Field label="Einleitungstext"><Textarea value={s.introText} onChange={(e) => set('introText', e.target.value)} rows={2} /></Field>
            <Field label="Fußzeile / Schlusstext"><Textarea value={s.footer ?? ''} onChange={(e) => set('footer', nn(e.target.value))} rows={2} /></Field>
            <Toggle checked={s.autoDraftOnFinish} onChange={(v) => set('autoDraftOnFinish', v)} label="Rechnungsentwurf automatisch anlegen"
              hint="Sobald ein Auftrag auf „Fertig“ gesetzt wird (nicht bei „nicht abrechnen“ und nur, wenn noch keine Rechnung existiert)." />
            <p className="text-sm text-zinc-500">Bereits gestellte Rechnungen behalten die Absenderdaten zum Zeitpunkt der Stellung.</p>
          </div>
        </Card>
        <div className="flex justify-end"><Button variant="primary" size="lg" disabled={!!fmtErr} loading={save.isPending} onClick={() => save.mutate(s)}>Einstellungen speichern</Button></div>
      </div>
    </div>
  );
}
