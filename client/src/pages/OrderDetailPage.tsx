import type { HistoryEntry, InvoiceListItem, OrderDetail, OrderStatus, Part, PartStatus } from '@fablab/shared';
import {
  CUSTOMER_TYPE_LABELS, formatCents, formatDateDe, formatNumber, isOrderOverdue, MATERIAL_UNIT_LABELS, ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS, PART_STATUSES, PART_STATUS_LABELS, shouldSuggestFinish,
} from '@fablab/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { OrderForm, validateOrder, type OrderDraft } from '../components/OrderForm.tsx';
import { emptyPart, exceedsBuildVolume, PartForm, partToDraft, validatePart, type PartDraft } from '../components/PartForm.tsx';
import { IconAlert, IconArrowLeft, IconCheck, IconCopy, IconDownload, IconEdit, IconPlus, IconTrash, IconUpload } from '../components/icons.tsx';
import { Flag, InvoiceStatusBadge, OrderStatusBadge, PartStatusBadge, PriorityBadge } from '../components/StatusBadge.tsx';
import { useToast } from '../components/Toast.tsx';
import { BigCheckbox, Button, Card, Confirm, EmptyState, ErrorBox, linkCls, Loading, Modal, Notice, ProgressBar, Select } from '../components/ui.tsx';
import { api, download, errorMessage } from '../lib/api.ts';
import { useMasterData } from '../lib/hooks.ts';

interface PartChange { part: Part; orderStatus: OrderStatus; suggestFinish: boolean; allDone: boolean }

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-zinc-500">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

const STATUS_ACTION: Partial<Record<OrderStatus, { label: string; variant: 'primary' | 'secondary' | 'success' | 'danger' | 'accent' }>> = {
  in_bearbeitung: { label: 'In Bearbeitung', variant: 'accent' },
  fertig: { label: 'Fertig', variant: 'success' },
  abgeholt: { label: 'Abgeholt', variant: 'primary' },
  neu: { label: 'Zurück auf Neu', variant: 'secondary' },
  storniert: { label: 'Stornieren', variant: 'danger' },
};

export default function OrderDetailPage() {
  const id = Number(useParams().id);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const mdq = useMasterData();
  const order = useQuery({ queryKey: ['order', id], queryFn: () => api.get<OrderDetail>(`/orders/${id}`) });
  const invoices = useQuery({ queryKey: ['invoices', { orderId: id }], queryFn: () => api.get<InvoiceListItem[]>(`/invoices?orderId=${id}`) });

  const [editOrder, setEditOrder] = useState<OrderDraft | null>(null);
  const [orderErrors, setOrderErrors] = useState<Record<string, string>>({});
  const [partModal, setPartModal] = useState<{ part: PartDraft; id: number | null } | null>(null);
  const [partErrors, setPartErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<null | { kind: 'deleteOrder' } | { kind: 'deletePart'; part: Part } | { kind: 'status'; to: OrderStatus }>(null);
  const [dismissedSuggest, setDismissedSuggest] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['order', id] });
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['history'] });
    qc.invalidateQueries({ queryKey: ['queue'] });
  };
  const onError = (e: unknown) => toast.show('error', errorMessage(e));

  const setStatus = useMutation({
    mutationFn: (status: OrderStatus) => api.post<{ draftInvoiceId: number | null }>(`/orders/${id}/status`, { status }),
    onSuccess: (r, status) => {
      refresh();
      qc.invalidateQueries({ queryKey: ['invoices'] });
      setConfirm(null);
      if (r.draftInvoiceId) toast.show('success', `Status „${ORDER_STATUS_LABELS[status]}“ – Rechnungsentwurf wurde angelegt.`, { label: 'Öffnen', onClick: () => navigate(`/rechnungen/${r.draftInvoiceId}`) });
      else toast.show('success', `Status: ${ORDER_STATUS_LABELS[status]}`);
    },
    onError,
  });

  const saveOrder = useMutation({
    mutationFn: (o: OrderDraft) => api.patch(`/orders/${id}`, o),
    onSuccess: () => { refresh(); setEditOrder(null); toast.show('success', 'Auftrag gespeichert.'); },
    onError,
  });
  const deleteOrder = useMutation({
    mutationFn: () => api.del(`/orders/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); toast.show('success', 'Auftrag gelöscht.'); navigate('/auftraege'); },
    onError: (e) => { setConfirm(null); onError(e); },
  });

  const patchPart = useMutation({
    mutationFn: ({ partId, patch }: { partId: number; patch: Partial<PartDraft> & { done?: boolean } }) => api.patch<PartChange>(`/parts/${partId}`, patch),
    onMutate: async ({ partId, patch }) => {
      // Optimistisches Abhaken – fühlt sich am Tablet sofort an
      await qc.cancelQueries({ queryKey: ['order', id] });
      const prev = qc.getQueryData<OrderDetail>(['order', id]);
      if (prev && patch.done !== undefined) {
        qc.setQueryData<OrderDetail>(['order', id], {
          ...prev,
          parts: prev.parts.map((p) => (p.id === partId ? { ...p, done: patch.done!, status: patch.done ? 'fertig' : p.status === 'fertig' ? 'offen' : p.status } : p)),
        });
      }
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['order', id], ctx.prev); onError(e); },
    onSuccess: (r) => { if (r.suggestFinish) setDismissedSuggest(false); },
    onSettled: refresh,
  });

  const savePart = useMutation({
    mutationFn: ({ draft, partId }: { draft: PartDraft; partId: number | null; next?: boolean }) =>
      partId ? api.patch(`/parts/${partId}`, draft) : api.post(`/orders/${id}/parts`, draft),
    onSuccess: (_r, v) => {
      refresh();
      toast.show('success', v.partId ? 'Teil gespeichert.' : `Teil „${v.draft.name}“ hinzugefügt.`);
      if (v.next) { setPartModal({ part: emptyPart(v.draft), id: null }); setPartErrors({}); }
      else setPartModal(null);
    },
    onError,
  });
  const duplicate = useMutation({
    mutationFn: (partId: number) => api.post<Part>(`/parts/${partId}/duplicate`),
    onSuccess: (p) => { refresh(); toast.show('success', `„${p.name}“ angelegt.`); },
    onError,
  });
  const deletePart = useMutation({
    mutationFn: (partId: number) => api.del(`/parts/${partId}`),
    onSuccess: () => { refresh(); setConfirm(null); toast.show('success', 'Teil gelöscht.'); },
    onError,
  });
  const createInvoice = useMutation({
    mutationFn: () => api.post<{ invoice: { id: number }; warnings: string[] }>(`/orders/${id}/invoice-draft`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      navigate(`/rechnungen/${r.invoice.id}`, { state: { warnings: r.warnings } });
    },
    onError: (e: any) => {
      if (e?.details?.invoiceId) toast.show('info', e.message, { label: 'Zum Entwurf', onClick: () => navigate(`/rechnungen/${e.details.invoiceId}`) });
      else onError(e);
    },
  });

  if (order.isLoading || mdq.isLoading) return <Loading />;
  if (order.error) return <ErrorBox error={order.error} />;
  const o = order.data!;
  const md = mdq.md!;
  const overdue = isOrderOverdue(o);
  const doneCount = o.parts.filter((p) => p.done).length;
  const suggest = shouldSuggestFinish(o.status, o.parts) && !dismissedSuggest;
  const transitions = ORDER_TRANSITIONS[o.status];
  const activeInvoices = invoices.data?.filter((i) => i.type === 'rechnung' && i.status !== 'storniert') ?? [];

  const submitPart = (next: boolean) => {
    if (!partModal) return;
    const errs = validatePart(partModal.part);
    setPartErrors(errs);
    if (Object.keys(errs).length) return;
    savePart.mutate({ draft: partModal.part, partId: partModal.id, next });
  };

  return (
    <>
      <nav className="mb-4"><Link to="/auftraege" className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-zinc-500 hover:text-zinc-900 dark:hover:text-white"><IconArrowLeft />Aufträge</Link></nav>

      {/* Kopf */}
      <header className="mb-8 border-b-2 border-zinc-900 pb-6 dark:border-zinc-100">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="tabular text-xs font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-500">Auftrag {String(o.id).padStart(3, '0')}</span>
              <OrderStatusBadge status={o.status} />
              <PriorityBadge priority={o.priority} hideNormal />
              {o.noBilling && <Flag>nicht abrechnen</Flag>}
            </div>
            <h1 className="text-4xl font-black uppercase leading-none tracking-tight sm:text-5xl">{o.title}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { setEditOrder({ ...o }); setOrderErrors({}); }}><IconEdit />Bearbeiten</Button>
            <Button icon variant="ghost" onClick={() => setConfirm({ kind: 'deleteOrder' })} aria-label="Auftrag löschen" title="Auftrag löschen"><IconTrash /></Button>
          </div>
        </div>
        <dl className="mt-6 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <Meta label="Auftraggeber:in">{o.customerName} <span className="text-zinc-500">· {CUSTOMER_TYPE_LABELS[o.customerType]}</span></Meta>
          {o.contact && <Meta label="Kontakt">{o.contact}</Meta>}
          <Meta label="Deadline"><span className={overdue ? 'font-bold text-bad' : ''}>{o.dueDate ? `${formatDateDe(o.dueDate)}${overdue ? ' · überfällig' : ''}` : '–'}</span></Meta>
          <Meta label="Erstellt">{formatDateDe(o.createdAt)}</Meta>
          {o.assignee && <Meta label="Zuständig">{o.assignee}</Meta>}
          {!o.noBilling && <Meta label="Rechnung an">{o.billToName || o.customerName}{!o.billToAddress && <span className="font-semibold text-bad"> · Adresse fehlt</span>}</Meta>}
        </dl>
        {o.notes && <p className="mt-4 whitespace-pre-line border-l-4 border-brand-500 bg-white px-4 py-2 text-sm dark:bg-zinc-900">{o.notes}</p>}
        <ProgressBar done={doneCount} total={o.parts.length} className="mt-6" />
        <div className="mt-5 flex flex-wrap gap-2">
          {transitions.map((t) => (
            <Button key={t} size="lg" variant={STATUS_ACTION[t]?.variant ?? 'secondary'} loading={setStatus.isPending && setStatus.variables === t}
              onClick={() => (t === 'storniert' || (t === 'fertig' && doneCount < o.parts.length) ? setConfirm({ kind: 'status', to: t }) : setStatus.mutate(t))}>
              {t === 'fertig' && o.status !== 'abgeholt' && <IconCheck />}
              {t === 'fertig' && o.status === 'abgeholt' ? 'Zurück auf Fertig' : t === 'in_bearbeitung' && o.status === 'fertig' ? 'Zurück in Bearbeitung' : STATUS_ACTION[t]?.label ?? ORDER_STATUS_LABELS[t]}
            </Button>
          ))}
        </div>
      </header>

      {suggest && (
        <Notice tone="success" className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <span className="text-lg"><b>Alle Teile erledigt.</b> Auftrag auf „Fertig“ setzen?</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setDismissedSuggest(true)}>Später</Button>
            <Button variant="success" size="lg" onClick={() => setStatus.mutate('fertig')} loading={setStatus.isPending}>Auf Fertig setzen</Button>
          </div>
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Teile */}
        <Card className="xl:col-span-2" flush title={<>Teile <span className="tabular ml-1 text-zinc-500">{doneCount}/{o.parts.length}</span></>} actions={<>
          <Button size="sm" variant="ghost" onClick={() => download(`/export/teile.xlsx?orderId=${o.id}`)}><IconDownload />Export</Button>
          <Button size="sm" variant="ghost" onClick={() => navigate(`/import?auftrag=${o.id}`)}><IconUpload />Import</Button>
          <Button size="sm" variant="primary" onClick={() => { setPartModal({ part: emptyPart(o.parts.at(-1)), id: null }); setPartErrors({}); }}><IconPlus />Teil</Button>
        </>}>
          {o.parts.length === 0 ? (
            <div className="p-5"><EmptyState>Noch keine Teile. <button className={linkCls} onClick={() => setPartModal({ part: emptyPart(), id: null })}>Erstes Teil anlegen</button> oder <Link className={linkCls} to={`/import?auftrag=${o.id}`}>aus Datei importieren</Link>.</EmptyState></div>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {o.parts.map((p) => {
                const mat = mdq.material(p.materialId);
                return (
                  <li key={p.id} className={`flex gap-4 px-5 py-4 transition-colors ${p.done ? 'bg-zinc-50 dark:bg-zinc-950/50' : ''}`}>
                    <BigCheckbox checked={p.done} label={`„${p.name}“ erledigt`} onChange={(v) => patchPart.mutate({ partId: p.id, patch: { done: v } })} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-lg font-semibold ${p.done ? 'text-zinc-400 line-through' : ''}`}>{p.name}</span>
                        <span className="tabular bg-zinc-900 px-1.5 text-sm font-bold text-white dark:bg-white dark:text-zinc-900">{p.quantity}×</span>
                        <PartStatusBadge status={p.status} />
                        {exceedsBuildVolume(p) && <span className="inline-flex items-center gap-1 text-[0.7rem] font-bold uppercase tracking-[0.1em] text-bad" title="Größer als der größte Bauraum"><IconAlert />Bauraum</span>}
                      </div>
                      <div className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                        {[mdq.machineName(p.machineId) || mdq.processName(p.processId) || 'Maschine offen',
                          mat?.name ?? p.materialText, p.color,
                          p.dimW || p.dimD || p.dimH ? `${formatNumber(p.dimW)}×${formatNumber(p.dimD)}×${formatNumber(p.dimH)} mm` : null,
                        ].filter(Boolean).join(' · ')}
                      </div>
                      <div className="text-sm text-zinc-500">
                        {[p.fileRef && `Datei: ${p.fileRef}`,
                          p.estMinutes != null && `geschätzt ${p.estMinutes} min`,
                          p.actualMinutes != null && `Maschinenzeit ${p.actualMinutes} min`,
                          p.materialAmount != null && `Verbrauch ${formatNumber(p.materialAmount, 3)} ${mat ? MATERIAL_UNIT_LABELS[mat.unit] : ''}`,
                        ].filter(Boolean).join(' · ')}
                      </div>
                      {p.notes && <div className="text-sm italic text-zinc-500">{p.notes}</div>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
                      <Select aria-label="Status" className="!min-h-10 w-40 text-sm" value={p.status} onChange={(e) => patchPart.mutate({ partId: p.id, patch: { status: e.target.value as PartStatus } })}>
                        {PART_STATUSES.map((s) => <option key={s} value={s}>{PART_STATUS_LABELS[s]}</option>)}
                      </Select>
                      <div className="flex">
                        <Button icon variant="ghost" onClick={() => { setPartModal({ part: partToDraft(p), id: p.id }); setPartErrors({}); }} aria-label="Bearbeiten" title="Bearbeiten"><IconEdit /></Button>
                        <Button icon variant="ghost" onClick={() => duplicate.mutate(p.id)} aria-label="Duplizieren" title="Duplizieren"><IconCopy /></Button>
                        <Button icon variant="ghost" onClick={() => setConfirm({ kind: 'deletePart', part: p })} aria-label="Löschen" title="Löschen"><IconTrash /></Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          {/* Rechnungen */}
          <Card title="Rechnungen">
            {!o.noBilling && <Button className="mb-4 w-full" variant={activeInvoices.length ? 'secondary' : 'primary'} onClick={() => createInvoice.mutate()} loading={createInvoice.isPending}>Rechnungsentwurf erstellen</Button>}
            {o.noBilling ? <p className="text-zinc-500">Dieser Auftrag wird nicht abgerechnet.</p>
              : !invoices.data?.length ? <p className="text-zinc-500">Noch keine Rechnung.</p>
              : (
                <ul className="space-y-2">
                  {invoices.data.map((i) => (
                    <li key={i.id}>
                      <Link to={`/rechnungen/${i.id}`} className="flex items-center justify-between gap-2 border-b border-zinc-200 py-2 hover:text-brand-700 dark:border-zinc-800 dark:hover:text-brand-500">
                        <span>{i.type === 'storno' ? 'Storno ' : ''}{i.number ?? 'Entwurf'}</span>
                        <span className="flex items-center gap-2"><span className="tabular">{formatCents(i.grossCents)}</span><InvoiceStatusBadge status={i.displayStatus} type={i.type} /></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
          </Card>
          <HistoryCard orderId={id} />
        </div>
      </div>

      {/* Dialoge */}
      <Modal open={!!editOrder} onClose={() => setEditOrder(null)} title="Auftrag bearbeiten" wide
        footer={<><Button onClick={() => setEditOrder(null)}>Abbrechen</Button><Button variant="primary" loading={saveOrder.isPending} onClick={() => {
          const errs = validateOrder(editOrder!);
          setOrderErrors(errs);
          if (!Object.keys(errs).length) { const { status: _s, ...rest } = editOrder!; saveOrder.mutate(rest); }
        }}>Speichern</Button></>}>
        {editOrder && <OrderForm value={editOrder} onChange={setEditOrder} errors={orderErrors} />}
      </Modal>

      <Modal open={!!partModal} onClose={() => setPartModal(null)} title={partModal?.id ? 'Teil bearbeiten' : 'Teil hinzufügen'} wide
        footer={<>
          <Button onClick={() => setPartModal(null)}>Abbrechen</Button>
          {!partModal?.id && <Button onClick={() => submitPart(true)} loading={savePart.isPending && savePart.variables?.next}>Speichern & nächstes Teil</Button>}
          <Button variant="primary" onClick={() => submitPart(false)} loading={savePart.isPending && !savePart.variables?.next}>Speichern</Button>
        </>}>
        {partModal && <PartForm value={partModal.part} onChange={(part) => setPartModal({ ...partModal, part })} md={md} errors={partErrors} />}
      </Modal>

      <Confirm open={confirm?.kind === 'deleteOrder'} title="Auftrag löschen?" danger confirmLabel="Endgültig löschen"
        text={`„${o.title}“ mit ${o.parts.length} Teil(en) wird gelöscht. Das kann nicht rückgängig gemacht werden.${activeInvoices.length ? '\n\nHinweis: Aufträge mit gestellten Rechnungen können nicht gelöscht werden – stattdessen stornieren.' : ''}`}
        onConfirm={() => deleteOrder.mutate()} onClose={() => setConfirm(null)} loading={deleteOrder.isPending} />
      <Confirm open={confirm?.kind === 'deletePart'} title="Teil löschen?" danger confirmLabel="Löschen"
        text={confirm?.kind === 'deletePart' ? `„${confirm.part.name}“ wird gelöscht.` : ''}
        onConfirm={() => confirm?.kind === 'deletePart' && deletePart.mutate(confirm.part.id)} onClose={() => setConfirm(null)} loading={deletePart.isPending} />
      <Confirm open={confirm?.kind === 'status'} title={confirm?.kind === 'status' && confirm.to === 'storniert' ? 'Auftrag stornieren?' : 'Auftrag auf Fertig setzen?'}
        danger={confirm?.kind === 'status' && confirm.to === 'storniert'}
        confirmLabel={confirm?.kind === 'status' && confirm.to === 'storniert' ? 'Stornieren' : 'Trotzdem auf Fertig'}
        text={confirm?.kind === 'status' && confirm.to === 'fertig' ? `Erst ${doneCount} von ${o.parts.length} Teilen sind abgehakt.` : 'Der Auftrag wird als storniert markiert. Er kann später wieder auf „Neu“ gesetzt werden.'}
        onConfirm={() => confirm?.kind === 'status' && setStatus.mutate(confirm.to)} onClose={() => setConfirm(null)} loading={setStatus.isPending} />
    </>
  );
}

function HistoryCard({ orderId }: { orderId: number }) {
  const h = useQuery({ queryKey: ['history', { orderId }], queryFn: () => api.get<HistoryEntry[]>(`/orders/${orderId}/history`) });
  const [all, setAll] = useState(false);
  const list = h.data ?? [];
  return (
    <Card title="Verlauf">
      {!list.length ? <p className="text-zinc-500">Keine Einträge.</p> : (
        <>
          <ol className="space-y-2 text-sm">
            {(all ? list : list.slice(0, 8)).map((e) => (
              <li key={e.id} className="flex gap-2">
                <time className="tabular shrink-0 text-zinc-500" dateTime={e.at}>{new Date(e.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</time>
                <span>{e.message}</span>
              </li>
            ))}
          </ol>
          {list.length > 8 && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAll(!all)}>{all ? 'Weniger' : `Alle ${list.length} anzeigen`}</Button>}
        </>
      )}
    </Card>
  );
}
