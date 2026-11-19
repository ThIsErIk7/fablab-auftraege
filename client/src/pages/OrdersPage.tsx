import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import type { OrderListItem, OrderStatus } from '@fablab/shared';
import { canTransitionOrder, formatDateDe, isOrderOverdue, ORDER_STATUSES, ORDER_STATUS_LABELS, PRIORITIES, PRIORITY_LABELS } from '@fablab/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { IconAlert, IconDown, IconDownload, IconPlus, IconUp } from '../components/icons.tsx';
import { Flag, ORDER_STATUS_COLOR, OrderStatusBadge, PriorityBadge } from '../components/StatusBadge.tsx';
import { useToast } from '../components/Toast.tsx';
import { Button, EmptyState, ErrorBox, Input, linkCls, Loading, PageHeader, ProgressBar, Segmented, Select } from '../components/ui.tsx';
import { api, download, errorMessage, qs } from '../lib/api.ts';
import { useMasterData } from '../lib/hooks.ts';

type View = 'liste' | 'kanban';

export default function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { md, machineName } = useMasterData();
  const view = (params.get('ansicht') as View) ?? (localStorageGet('ordersView') as View) ?? 'liste';
  const [q, setQ] = useState(params.get('q') ?? '');

  const p = (k: string) => params.get(k) ?? '';
  const update = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v); else n.delete(k);
    setParams(n, { replace: true });
  };
  // Suche verzögert in die URL übernehmen
  useEffect(() => {
    const t = setTimeout(() => { if (q !== p('q')) update('q', q); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Standard: aktive Aufträge (ohne Abgeholt/Storniert), außer im Kanban
  const statusParam = params.has('status') ? p('status') : view === 'kanban' ? '' : 'neu,in_bearbeitung,fertig';
  const filter = {
    q: p('q'), status: statusParam === 'alle' ? '' : statusParam, priority: p('priority'), processId: p('processId'), machineId: p('machineId'),
    dueTo: p('dueTo'), overdue: p('overdue') === '1', sort: p('sort') || 'due', dir: p('dir') || 'asc',
  };
  const query = useQuery({
    queryKey: ['orders', filter],
    queryFn: () => api.get<OrderListItem[]>(`/orders${qs(filter)}`),
    placeholderData: keepPreviousData,
  });

  const setView = (v: View) => { localStorageSet('ordersView', v); update('ansicht', v); };
  const activeFilters = ['status', 'priority', 'processId', 'machineId', 'dueTo', 'overdue', 'q'].filter((k) => params.has(k)).length;

  return (
    <>
      <PageHeader
        title="Aufträge"
        actions={<>
          <Segmented value={view} onChange={setView} options={[{ value: 'liste', label: 'Liste' }, { value: 'kanban', label: 'Kanban' }]} />
          <Button variant="ghost" onClick={() => download(`/export/auftraege.xlsx${qs({ ...filter, sort: undefined, dir: undefined })}`)}><IconDownload />XLSX</Button>
          <Button variant="ghost" onClick={() => download(`/export/auftraege.csv${qs({ ...filter, sort: undefined, dir: undefined })}`)}><IconDownload />CSV</Button>
          <Button variant="primary" onClick={() => navigate('/auftraege/neu')}><IconPlus />Neuer Auftrag</Button>
        </>}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Input type="search" placeholder="Suchen (Titel, Kunde, Teil, Datei, #Nr.)" value={q} onChange={(e) => setQ(e.target.value)} className="lg:col-span-2" aria-label="Suche" />
        <Select aria-label="Status" value={statusParam || "alle"} onChange={(e) => update('status', e.target.value || 'alle')}>
          <option value="neu,in_bearbeitung,fertig">Aktive (ohne Abgeholt/Storniert)</option>
          <option value="neu,in_bearbeitung">Offen (Neu + In Bearbeitung)</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
          <option value="alle">Alle Status</option>
        </Select>
        <Select aria-label="Priorität" value={p('priority')} onChange={(e) => update('priority', e.target.value)}>
          <option value="">Alle Prioritäten</option>
          {PRIORITIES.map((s) => <option key={s} value={s}>{PRIORITY_LABELS[s]}</option>)}
        </Select>
        <Select aria-label="Verfahren" value={p('processId')} onChange={(e) => { update('processId', e.target.value); }}>
          <option value="">Alle Verfahren</option>
          {md?.processes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
        <Select aria-label="Maschine" value={p('machineId')} onChange={(e) => update('machineId', e.target.value)}>
          <option value="">Alle Maschinen</option>
          {md?.machines.filter((m) => !p('processId') || m.processId === Number(p('processId'))).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm lg:col-span-2">
          <span className="shrink-0">Deadline bis</span>
          <Input type="date" value={p('dueTo')} onChange={(e) => update('dueTo', e.target.value)} />
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="h-5 w-5 accent-brand-700" checked={filter.overdue} onChange={(e) => update('overdue', e.target.checked ? '1' : '')} />
          Nur überfällige
        </label>
        {view === 'liste' && (
          <div className="flex gap-2 lg:col-span-2">
            <Select aria-label="Sortierung" value={filter.sort} onChange={(e) => update('sort', e.target.value)}>
              <option value="due">Deadline</option>
              <option value="priority">Priorität</option>
              <option value="created">Erstellt am</option>
              <option value="status">Status</option>
              <option value="title">Titel</option>
              <option value="customer">Auftraggeber:in</option>
              <option value="progress">Fortschritt</option>
            </Select>
            <Button icon aria-label="Sortierrichtung umkehren" title={filter.dir === 'asc' ? 'Aufsteigend' : 'Absteigend'} onClick={() => update('dir', filter.dir === 'asc' ? 'desc' : 'asc')}>{filter.dir === 'asc' ? <IconUp /> : <IconDown />}</Button>
          </div>
        )}
        {activeFilters > 0 && (
          <Button variant="ghost" onClick={() => { setQ(''); setParams(view === 'kanban' ? { ansicht: 'kanban' } : {}, { replace: true }); }}>Filter zurücksetzen</Button>
        )}
      </div>

      {query.isLoading ? <Loading /> : query.error ? <ErrorBox error={query.error} /> : view === 'kanban'
        ? <Kanban orders={query.data!} statusFilter={statusParam} />
        : <OrderList orders={query.data!} machineName={machineName} />}
    </>
  );
}

function OrderList({ orders, machineName }: { orders: OrderListItem[]; machineName: (id: number) => string }) {
  if (orders.length === 0) return <EmptyState>Keine Aufträge für diese Filter. <Link to="/auftraege/neu" className={linkCls}>Neuen Auftrag anlegen</Link></EmptyState>;
  return (
    <div className="card">
      <div className="hidden grid-cols-[4rem_1fr_11rem_9rem_12rem] gap-4 border-b border-zinc-200 px-5 py-3 text-[0.65rem] font-bold uppercase tracking-[0.14em] text-zinc-500 lg:grid dark:border-zinc-800">
        <span>Nr.</span><span>Auftrag</span><span>Status</span><span>Deadline</span><span>Fortschritt</span>
      </div>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {orders.map((o) => {
          const overdue = isOrderOverdue(o);
          return (
            <li key={o.id}>
              <Link to={`/auftraege/${o.id}`} className="group grid gap-x-4 gap-y-2 px-5 py-4 transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:bg-brand-50 lg:grid-cols-[4rem_1fr_11rem_9rem_12rem] lg:items-center dark:hover:bg-zinc-800/50">
                <span className="tabular hidden text-sm font-semibold text-zinc-400 lg:block">{String(o.id).padStart(3, '0')}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="text-lg font-semibold leading-tight group-hover:text-brand-700 dark:group-hover:text-brand-500">{o.title}</h3>
                    <PriorityBadge priority={o.priority} hideNormal />
                    {o.noBilling && <Flag>nicht abrechnen</Flag>}
                  </div>
                  <div className="mt-0.5 text-sm text-zinc-500">
                    {o.customerName}{o.assignee && <> · {o.assignee}</>}
                    {o.machineIds.length > 0 && <> · {o.machineIds.slice(0, 2).map(machineName).join(', ')}{o.machineIds.length > 2 && ` +${o.machineIds.length - 2}`}</>}
                  </div>
                </div>
                <div className="flex items-center gap-4 lg:block"><OrderStatusBadge status={o.status} />
                  <span className={`tabular text-sm lg:hidden ${overdue ? 'font-bold text-bad' : 'text-zinc-500'}`}>{o.dueDate && `${overdue ? 'überfällig · ' : 'bis '}${formatDateDe(o.dueDate)}`}</span>
                </div>
                <span className={`tabular hidden text-sm lg:block ${overdue ? 'font-bold text-bad' : 'text-zinc-600 dark:text-zinc-400'}`}>
                  {o.dueDate ? <>{overdue && <IconAlert className="mr-1 inline align-[-3px]" />}{formatDateDe(o.dueDate)}</> : '–'}
                </span>
                <ProgressBar done={o.partsDone} total={o.partsTotal} />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kanban

function Kanban({ orders, statusFilter }: { orders: OrderListItem[]; statusFilter: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [dragging, setDragging] = useState<OrderListItem | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const columns = statusFilter && statusFilter !== 'alle' ? ORDER_STATUSES.filter((s) => statusFilter.split(',').includes(s)) : ORDER_STATUSES;

  const move = useMutation({
    mutationFn: ({ id, status }: { id: number; status: OrderStatus }) => api.post<{ draftInvoiceId: number | null }>(`/orders/${id}/status`, { status }),
    onSuccess: (r, v) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      if (r.draftInvoiceId) toast.show('success', `Auf „${ORDER_STATUS_LABELS[v.status]}“ gesetzt – Rechnungsentwurf angelegt.`, { label: 'Öffnen', onClick: () => navigate(`/rechnungen/${r.draftInvoiceId}`) });
      else toast.show('success', `Auf „${ORDER_STATUS_LABELS[v.status]}“ gesetzt.`);
    },
    onError: (e) => toast.show('error', errorMessage(e)),
  });

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const order = orders.find((o) => o.id === Number(e.active.id));
    const to = e.over?.id as OrderStatus | undefined;
    if (!order || !to || to === order.status) return;
    if (!canTransitionOrder(order.status, to)) {
      toast.show('error', `„${ORDER_STATUS_LABELS[order.status]}“ → „${ORDER_STATUS_LABELS[to]}“ ist nicht erlaubt.`);
      return;
    }
    // Optimistisch verschieben
    qc.setQueriesData<OrderListItem[]>({ queryKey: ['orders'] }, (old) => old?.map((o) => (o.id === order.id ? { ...o, status: to } : o)));
    move.mutate({ id: order.id, status: to });
  };

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setDragging(orders.find((o) => o.id === Number(e.active.id)) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Karten ziehen, um den Status zu ändern · Touch: kurz gedrückt halten</p>
      <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4">
        {columns.map((s) => (
          <Column key={s} status={s} orders={orders.filter((o) => o.status === s)} allowed={dragging ? canTransitionOrder(dragging.status, s) : null} />
        ))}
      </div>
    </DndContext>
  );
}

function Column({ status, orders, allowed }: { status: OrderStatus; orders: OrderListItem[]; allowed: boolean | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const ring = allowed === null ? 'border-zinc-900 dark:border-zinc-300' : allowed ? (isOver ? 'border-brand-500 bg-brand-50 dark:bg-brand-800/20' : 'border-brand-500') : 'border-zinc-300 opacity-40 dark:border-zinc-700';
  return (
    <section ref={setNodeRef} className={`flex w-72 shrink-0 snap-start flex-col border-t-4 bg-zinc-100 p-2 transition-colors dark:bg-zinc-900/60 ${ring}`}>
      <h2 className="flex items-center justify-between px-2 pb-3 pt-2 text-xs font-bold uppercase tracking-[0.14em] text-zinc-900 dark:text-white">
        <span className="flex items-center gap-2"><span className={`h-2.5 w-2.5 ${ORDER_STATUS_COLOR[status]}`} />{ORDER_STATUS_LABELS[status]}</span>
        <span className="tabular text-lg font-black">{orders.length}</span>
      </h2>
      <div className="flex min-h-24 flex-col gap-2">
        {orders.map((o) => <KanbanCard key={o.id} order={o} />)}
      </div>
    </section>
  );
}

function KanbanCard({ order: o }: { order: OrderListItem }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: o.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const overdue = isOrderOverdue(o);
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}
      className={`card touch-manipulation cursor-grab p-3 transition-shadow active:cursor-grabbing ${isDragging ? 'z-50 rotate-1 border-zinc-900 shadow-[6px_6px_0_var(--color-brand-500)] dark:border-white' : 'hover:border-zinc-900 dark:hover:border-zinc-400'}`}>
      <div className="flex items-start justify-between gap-2">
        <Link to={`/auftraege/${o.id}`} className="font-semibold hover:underline" onPointerDown={(e) => e.stopPropagation()}>{o.title}</Link>
        <PriorityBadge priority={o.priority} hideNormal />
      </div>
      <div className="text-sm text-zinc-500"><span className="tabular">{String(o.id).padStart(3, '0')}</span> · {o.customerName}</div>
      {o.dueDate && <div className={`text-sm ${overdue ? 'font-semibold text-bad' : 'text-zinc-500'}`}>{overdue ? 'überfällig · ' : 'bis '}{formatDateDe(o.dueDate)}</div>}
      <ProgressBar done={o.partsDone} total={o.partsTotal} className="mt-2" />
    </div>
  );
}

function localStorageGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* egal */ } }
