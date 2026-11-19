import type { InvoiceDetail, InvoiceItem } from '@fablab/shared';
import { formatBp, formatCents, formatDateDe, formatMills, formatNumber, itemTotal, todayIso } from '@fablab/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { IconArrowLeft, IconCheck, IconDownload, IconExternal, IconLock, IconPlus, IconRefresh, IconTrash, IconX } from '../components/icons.tsx';
import { InvoiceStatusBadge } from '../components/StatusBadge.tsx';
import { useToast } from '../components/Toast.tsx';
import { Button, Card, Confirm, ErrorBox, Field, Input, linkCls, Loading, Modal, MoneyInput, Notice, NumberInput, Textarea } from '../components/ui.tsx';
import { api, download, errorMessage } from '../lib/api.ts';

type Detail = InvoiceDetail & { missing: string[] };

const PRESETS: { description: string; unit: string; quantity: number; unitPriceMills: number }[] = [
  { description: 'Betreuung', unit: 'h', quantity: 1, unitPriceMills: 0 },
  { description: 'Designarbeit / Datenaufbereitung', unit: 'h', quantity: 1, unitPriceMills: 0 },
  { description: 'Versand', unit: 'pausch.', quantity: 1, unitPriceMills: 0 },
  { description: 'Rabatt', unit: 'pausch.', quantity: 1, unitPriceMills: -5000 },
];

export default function InvoiceDetailPage() {
  const id = Number(useParams().id);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [warnings, setWarnings] = useState<string[]>((location.state as any)?.warnings ?? []);
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get<Detail>(`/invoices/${id}`) });
  const [dialog, setDialog] = useState<null | 'issue' | 'pay' | 'cancel' | 'delete'>(null);
  const [issueDate, setIssueDate] = useState(todayIso());
  const [payDate, setPayDate] = useState(todayIso());
  const [reason, setReason] = useState('');

  const set = (inv: InvoiceDetail) => {
    qc.setQueryData(['invoice', id], (old: Detail | undefined) => ({ ...inv, missing: old?.missing ?? [] }));
    qc.invalidateQueries({ queryKey: ['invoice', id] });
    qc.invalidateQueries({ queryKey: ['invoices'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const onError = (e: unknown) => toast.show('error', errorMessage(e));
  const useM = <T,>(fn: (v: T) => Promise<InvoiceDetail>, msg?: string) =>
    useMutation({ mutationFn: fn, onSuccess: (inv) => { set(inv); setDialog(null); if (msg) toast.show('success', msg); }, onError });

  const patch = useM((body: object) => api.patch<InvoiceDetail>(`/invoices/${id}`, body), 'Gespeichert.');
  const addItem = useM((body: object) => api.post<InvoiceDetail>(`/invoices/${id}/items`, body));
  const updItem = useM(({ itemId, body }: { itemId: number; body: object }) => api.patch<InvoiceDetail>(`/invoice-items/${itemId}`, body));
  const delItem = useM((itemId: number) => api.del<InvoiceDetail>(`/invoice-items/${itemId}`));
  const issue = useM((d: string) => api.post<InvoiceDetail>(`/invoices/${id}/issue`, { invoiceDate: d }), 'Rechnung gestellt.');
  const pay = useM((d: string) => api.post<InvoiceDetail>(`/invoices/${id}/pay`, { paidAt: d }), 'Als bezahlt markiert.');
  const unpay = useM(() => api.post<InvoiceDetail>(`/invoices/${id}/unpay`), 'Zahlung zurückgenommen.');
  const regen = useMutation({
    mutationFn: () => api.post<{ invoice: InvoiceDetail; warnings: string[] }>(`/invoices/${id}/regenerate`),
    onSuccess: (r) => { set(r.invoice); setWarnings(r.warnings); toast.show('success', 'Positionen aus den Teilen neu berechnet.'); },
    onError,
  });
  const cancel = useMutation({
    mutationFn: () => api.post<InvoiceDetail>(`/invoices/${id}/cancel`, { reason: reason || null }),
    onSuccess: (st) => { qc.invalidateQueries({ queryKey: ['invoice'] }); qc.invalidateQueries({ queryKey: ['invoices'] }); setDialog(null); toast.show('success', `Stornorechnung ${st.number} erstellt.`); navigate(`/rechnungen/${st.id}`); },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/invoices/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invoices'] }); toast.show('success', 'Entwurf verworfen.'); navigate(inv?.orderId ? `/auftraege/${inv.orderId}` : '/rechnungen'); },
    onError,
  });

  const inv = q.data;
  if (q.isLoading) return <Loading />;
  if (q.error || !inv) return <ErrorBox error={q.error} />;
  const draft = inv.status === 'entwurf';
  const isStorno = inv.type === 'storno';

  return (
    <>
      <nav className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold uppercase tracking-[0.12em]">
        <Link to="/rechnungen" className="inline-flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white"><IconArrowLeft />Rechnungen</Link>
        {inv.orderId && <Link to={`/auftraege/${inv.orderId}`} className="text-brand-700 hover:text-zinc-900 dark:text-brand-500 dark:hover:text-white">Auftrag {String(inv.orderId).padStart(3, '0')} · {inv.orderTitle}</Link>}
      </nav>

      <header className="mb-8 border-b-2 border-zinc-900 pb-6 dark:border-zinc-100">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-x-4">
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-500">{isStorno ? 'Stornorechnung' : draft ? 'Rechnungsentwurf' : 'Rechnung'}</span>
              <InvoiceStatusBadge status={inv.displayStatus} type={inv.type} />
            </div>
            <h1 className="tabular text-4xl font-black uppercase leading-none tracking-tight sm:text-5xl">{inv.number ?? 'Entwurf'}</h1>
            <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {!draft && <>Gestellt {formatDateDe(inv.invoiceDate)}{inv.type === 'rechnung' && inv.dueDate && ` · fällig ${formatDateDe(inv.dueDate)}`}{inv.paidAt && ` · bezahlt ${formatDateDe(inv.paidAt)}`}</>}
              {isStorno && inv.cancelsInvoiceId && <> · storniert <Link className={linkCls} to={`/rechnungen/${inv.cancelsInvoiceId}`}>{inv.cancelsNumber}</Link></>}
              {inv.cancelledBy && <> · storniert durch <Link className={linkCls} to={`/rechnungen/${inv.cancelledBy.id}`}>{inv.cancelledBy.number}</Link></>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-zinc-500">Brutto</div>
            <div className="tabular text-4xl font-black leading-none">{formatCents(inv.grossCents)}</div>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          {draft && <Button variant="primary" size="lg" onClick={() => { setIssueDate(inv.invoiceDate ?? todayIso()); setDialog('issue'); }}><IconCheck />Rechnung stellen</Button>}
          {inv.status === 'gestellt' && !isStorno && <Button variant="success" size="lg" onClick={() => setDialog('pay')}><IconCheck />Als bezahlt markieren</Button>}
          {inv.status === 'gestellt' && isStorno && <Button variant="success" onClick={() => setDialog('pay')}>Erstattung erledigt</Button>}
          <Button onClick={() => window.open(`/api/invoices/${id}/pdf?inline=1`, '_blank', 'noopener')}><IconExternal />PDF ansehen</Button>
          <Button variant="ghost" onClick={() => download(`/invoices/${id}/pdf`)}><IconDownload />PDF</Button>
          {draft && <Button variant="ghost" onClick={() => setDialog('delete')}><IconTrash />Entwurf verwerfen</Button>}
          {inv.status === 'bezahlt' && !isStorno && <Button variant="ghost" onClick={() => unpay.mutate(undefined as never)}>Zahlung zurücknehmen</Button>}
          {(inv.status === 'gestellt' || inv.status === 'bezahlt') && !isStorno && <Button variant="danger" onClick={() => setDialog('cancel')}>Stornieren</Button>}
        </div>
      </header>

      {!draft && <Notice className="mb-6 flex items-start gap-3"><IconLock className="mt-0.5 shrink-0" />Gestellte Rechnungen sind gesperrt und können weder geändert noch gelöscht werden. Korrekturen nur über eine Stornorechnung.</Notice>}
      {draft && inv.missing.length > 0 && (
        <Notice tone="warn" className="mb-6">
          <b>Vor dem Stellen fehlt noch:</b>
          <ul className="ml-5 list-disc">{inv.missing.map((x) => <li key={x}>{x}{x.includes('Einstellungen') && <> – <Link to="/admin/rechnung" className="underline">zu den Einstellungen</Link></>}</li>)}</ul>
        </Notice>
      )}
      {draft && warnings.length > 0 && (
        <Notice tone="warn" className="mb-6">
          <div className="flex justify-between gap-2"><b>Hinweise zur Preisberechnung</b><button onClick={() => setWarnings([])} aria-label="Hinweise schließen"><IconX /></button></div>
          <ul className="ml-5 list-disc">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Positionen" className="lg:col-span-2" actions={draft && <>
          <Button size="sm" onClick={() => regen.mutate()} loading={regen.isPending} variant="ghost" title="Teil-Positionen aus aktuellen Teilen und Preisen neu berechnen; freie Positionen bleiben"><IconRefresh />Neu berechnen</Button>
        </>}>
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-zinc-500">
                <tr><th className="px-4 py-2">Beschreibung</th><th className="w-24 py-2 text-right">Menge</th><th className="w-20 py-2 pl-2">Einheit</th><th className="w-32 py-2 text-right">Einzelpreis</th><th className="w-20 py-2 text-right">Rabatt %</th><th className="w-28 px-2 py-2 text-right">Gesamt</th>{draft && <th className="w-10" />}</tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {inv.items.map((it) => draft
                  ? <ItemRow key={it.id} item={it} onSave={(body) => updItem.mutate({ itemId: it.id, body })} onDelete={() => delItem.mutate(it.id)} />
                  : (
                    <tr key={it.id}>
                      <td className="px-4 py-2">{it.description}</td>
                      <td className="tabular py-2 text-right">{formatNumber(it.quantity, 3)}</td>
                      <td className="py-2 pl-2">{it.unit}</td>
                      <td className="tabular py-2 text-right">{formatMills(it.unitPriceMills)}</td>
                      <td className="tabular py-2 text-right">{it.discountBp ? formatBp(it.discountBp) : ''}</td>
                      <td className="tabular px-2 py-2 text-right">{formatCents(it.totalCents)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {draft && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <span className="self-center text-[0.65rem] font-bold uppercase tracking-[0.12em] text-zinc-500">Position hinzufügen</span>
              <Button size="sm" onClick={() => addItem.mutate({ description: 'Neue Position', quantity: 1, unit: 'Stk.', unitPriceMills: 0, discountBp: 0 })}><IconPlus />Frei</Button>
              {PRESETS.map((p) => <Button key={p.description} size="sm" variant="ghost" onClick={() => addItem.mutate({ ...p, discountBp: 0 })}><IconPlus />{p.description}</Button>)}
            </div>
          )}
          <dl className="ml-auto mt-4 w-full max-w-xs space-y-1">
            <div className="flex justify-between"><dt>Summe netto</dt><dd className="tabular">{formatCents(inv.netCents)}</dd></div>
            <div className="flex justify-between"><dt>{inv.taxRateBp ? `zzgl. ${formatBp(inv.taxRateBp)} USt.` : 'Umsatzsteuer'}</dt><dd className="tabular">{formatCents(inv.taxCents)}</dd></div>
            <div className="flex justify-between border-t-2 border-zinc-900 pt-2 text-xl font-black dark:border-zinc-100"><dt className="uppercase">Brutto</dt><dd className="tabular">{formatCents(inv.grossCents)}</dd></div>
          </dl>
        </Card>

        <div className="flex flex-col gap-4">
          {draft ? <DraftMeta inv={inv} onSave={(b) => patch.mutate(b)} saving={patch.isPending} /> : (
            <Card title="Angaben">
              <dl className="space-y-2 text-sm">
                <div><dt className="text-zinc-500">Empfänger</dt><dd className="whitespace-pre-line">{inv.recipient.name}{'\n'}{inv.recipient.address}</dd></div>
                {inv.recipient.vatId && <div><dt className="text-zinc-500">USt-IdNr. Kunde</dt><dd>{inv.recipient.vatId}</dd></div>}
                <div><dt className="text-zinc-500">Leistungszeitraum</dt><dd>{formatDateDe(inv.serviceFrom)}{inv.serviceTo && inv.serviceTo !== inv.serviceFrom && ` – ${formatDateDe(inv.serviceTo)}`}</dd></div>
                {inv.taxRateBp === 0 && inv.taxExemptNote && <div><dt className="text-zinc-500">Steuerhinweis</dt><dd>{inv.taxExemptNote}</dd></div>}
                {inv.notes && <div><dt className="text-zinc-500">Bemerkung</dt><dd className="whitespace-pre-line">{inv.notes}</dd></div>}
              </dl>
            </Card>
          )}
        </div>
      </div>

      {/* Dialoge */}
      <Modal open={dialog === 'issue'} onClose={() => setDialog(null)} title="Rechnung stellen"
        footer={<><Button onClick={() => setDialog(null)}>Abbrechen</Button><Button variant="primary" loading={issue.isPending} onClick={() => issue.mutate(issueDate)}>Verbindlich stellen</Button></>}>
        <p className="mb-3">Die Rechnung erhält die nächste fortlaufende Nummer und ist danach <b>nicht mehr änderbar</b>. Korrekturen sind nur per Stornorechnung möglich.</p>
        <Field label="Rechnungsdatum"><Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></Field>
        <p className="mt-3 text-lg">Betrag: <b className="tabular">{formatCents(inv.grossCents)}</b> an {inv.recipient.name}</p>
      </Modal>
      <Modal open={dialog === 'pay'} onClose={() => setDialog(null)} title={isStorno ? 'Erstattung erledigt' : 'Zahlung erfassen'}
        footer={<><Button onClick={() => setDialog(null)}>Abbrechen</Button><Button variant="success" loading={pay.isPending} onClick={() => pay.mutate(payDate)}>Speichern</Button></>}>
        <Field label={isStorno ? 'Erstattet am' : 'Bezahlt am'}><Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></Field>
      </Modal>
      <Confirm open={dialog === 'cancel'} title={`Rechnung ${inv.number} stornieren?`} danger confirmLabel="Stornorechnung erstellen" loading={cancel.isPending}
        text="Es wird eine Stornorechnung mit eigener Nummer und negativen Beträgen erstellt. Die Originalrechnung bleibt unverändert erhalten und wird als „storniert“ markiert."
        onConfirm={() => cancel.mutate()} onClose={() => setDialog(null)}>
        <Field label="Grund (erscheint auf der Stornorechnung, optional)" className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Confirm>
      <Confirm open={dialog === 'delete'} title="Entwurf verwerfen?" danger confirmLabel="Verwerfen" loading={remove.isPending}
        text="Der Entwurf wird gelöscht. Es wurde noch keine Rechnungsnummer vergeben." onConfirm={() => remove.mutate()} onClose={() => setDialog(null)} />
    </>
  );
}

function ItemRow({ item, onSave, onDelete }: { item: InvoiceItem; onSave: (b: Partial<InvoiceItem>) => void; onDelete: () => void }) {
  const [d, setD] = useState(item);
  useEffect(() => setD(item), [item]);
  const changed = d.description !== item.description || d.quantity !== item.quantity || d.unit !== item.unit || d.unitPriceMills !== item.unitPriceMills || d.discountBp !== item.discountBp;
  // Speichern, sobald der Fokus die Zeile verlässt
  const commit = (e: React.FocusEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    if (changed && d.description.trim() && d.quantity) onSave({ description: d.description, quantity: d.quantity, unit: d.unit, unitPriceMills: d.unitPriceMills, discountBp: d.discountBp });
  };
  return (
    <tr onBlur={commit} className={changed ? 'bg-warn/10' : ''}>
      <td className="px-4 py-1.5"><Input aria-label="Beschreibung" value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
        {item.partId && <span className="text-xs text-zinc-500">aus Teil berechnet</span>}</td>
      <td className="py-1.5 pl-1"><NumberInput aria-label="Menge" className="text-right" value={d.quantity} onChange={(v) => setD({ ...d, quantity: v ?? 0 })} /></td>
      <td className="py-1.5 pl-1"><Input aria-label="Einheit" value={d.unit} onChange={(e) => setD({ ...d, unit: e.target.value })} /></td>
      <td className="py-1.5 pl-1"><MoneyInput mills aria-label="Einzelpreis" allowNegative cents={d.unitPriceMills} onChange={(c) => setD({ ...d, unitPriceMills: c ?? 0 })} /></td>
      <td className="py-1.5 pl-1"><NumberInput aria-label="Rabatt in Prozent" className="text-right" value={d.discountBp / 100} onChange={(v) => setD({ ...d, discountBp: Math.round(Math.min(100, Math.max(0, v ?? 0)) * 100) })} /></td>
      <td className="tabular px-2 py-1.5 text-right">{formatCents(itemTotal(d.quantity, d.unitPriceMills, d.discountBp))}</td>
      <td className="pr-2"><Button icon size="sm" variant="ghost" onClick={onDelete} aria-label="Position löschen" title="Position löschen"><IconTrash /></Button></td>
    </tr>
  );
}

function DraftMeta({ inv, onSave, saving }: { inv: InvoiceDetail; onSave: (b: object) => void; saving: boolean }) {
  const [r, setR] = useState(inv.recipient);
  const [serviceFrom, setFrom] = useState(inv.serviceFrom ?? '');
  const [serviceTo, setTo] = useState(inv.serviceTo ?? '');
  const [taxPct, setTaxPct] = useState<number | null>(inv.taxRateBp / 100);
  const [note, setNote] = useState(inv.taxExemptNote ?? '');
  const [notes, setNotes] = useState(inv.notes ?? '');
  return (
    <Card title="Rechnungsdaten">
      <div className="space-y-3">
        <Field label="Empfänger (Name/Firma)" required><Input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} /></Field>
        <Field label="Anschrift" required><Textarea value={r.address} onChange={(e) => setR({ ...r, address: e.target.value })} rows={3} /></Field>
        <Field label="USt-IdNr. Kunde"><Input value={r.vatId ?? ''} onChange={(e) => setR({ ...r, vatId: e.target.value || null })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Leistung von"><Input type="date" value={serviceFrom} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Leistung bis"><Input type="date" value={serviceTo} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <Field label="USt.-Satz (%)" hint="0 = keine Umsatzsteuer (Hinweistext erforderlich)"><NumberInput value={taxPct} onChange={setTaxPct} /></Field>
        {taxPct === 0 && <Field label="Hinweis Steuerbefreiung" required><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>}
        <Field label="Bemerkung auf der Rechnung"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
        <Button variant="primary" className="w-full" loading={saving} onClick={() => onSave({
          recipient: r, serviceFrom: serviceFrom || null, serviceTo: serviceTo || null,
          taxRateBp: Math.round((taxPct ?? 0) * 100), taxExemptNote: taxPct === 0 ? note : null, notes: notes || null,
        })}>Rechnungsdaten speichern</Button>
      </div>
    </Card>
  );
}
