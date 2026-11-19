import type { OrderStatus, Part, PartStatus, Priority } from '@fablab/shared';
import { formatDateDe, formatNumber, isOrderOverdue, MATERIAL_UNIT_LABELS, PART_STATUS_LABELS } from '@fablab/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { IconCheck, IconChevron, IconPlay, IconRefresh, IconX } from '../components/icons.tsx';
import { PartStatusBadge, PriorityBadge } from '../components/StatusBadge.tsx';
import { useToast } from '../components/Toast.tsx';
import { BigCheckbox, Button, EmptyState, ErrorBox, Loading, PageHeader, Select } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { useMasterData } from '../lib/hooks.ts';

type QueueItem = Part & { order: { id: number; title: string; priority: Priority; dueDate: string | null; status: OrderStatus; customerName: string } };
type Patch = { done?: boolean; status?: PartStatus };
const QUEUE_KEY = ['queue', { done: true }];

const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

export default function MachinesPage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { md, isLoading } = useMasterData();
  const queue = useQuery({ queryKey: QUEUE_KEY, queryFn: () => api.get<QueueItem[]>('/machines/queue?done=1') });
  const processFilter = params.get('verfahren') ?? '';
  const showEmpty = params.get('leer') === '1';
  // Aufgeklappte "Erledigt"-Bereiche je Maschine
  const [openDone, setOpenDone] = useState<Set<number>>(new Set());
  // Gerade abgehakte Teile bleiben kurz sichtbar an ihrem Platz, bevor sie zu "Erledigt" wandern
  const [justDone, setJustDone] = useState<Set<number>>(new Set());
  const markJustDone = (id: number, on: boolean) => {
    setJustDone((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
    if (on) setTimeout(() => setJustDone((s) => { const n = new Set(s); n.delete(id); return n; }), 4000);
  };

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Patch; name: string }) => api.patch(`/parts/${id}`, body),
    // Sofort sichtbar abhaken – nicht erst nach der Server-Antwort
    onMutate: async ({ id, body }) => {
      if (body.done !== undefined) markJustDone(id, body.done);
      await qc.cancelQueries({ queryKey: QUEUE_KEY });
      const prev = qc.getQueryData<QueueItem[]>(QUEUE_KEY);
      qc.setQueryData<QueueItem[]>(QUEUE_KEY, (old) => old?.map((p) => {
        if (p.id !== id) return p;
        if (body.done !== undefined) return { ...p, done: body.done, status: body.done ? 'fertig' : p.status === 'fertig' ? 'offen' : p.status };
        return { ...p, status: body.status!, done: body.status === 'fertig' };
      }));
      return { prev };
    },
    onSuccess: (_r, { id, body, name }) => {
      if (body.done === true) toast.show('success', `„${name}“ erledigt.`, { label: 'Rückgängig', onClick: () => patch.mutate({ id, body: { done: false }, name }) });
      if (body.done === false) toast.show('info', `„${name}“ wieder offen.`);
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(QUEUE_KEY, ctx.prev); toast.show('error', errorMessage(e)); },
    onSettled: () => ['queue', 'orders', 'order', 'dashboard', 'history'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });

  if (isLoading || queue.isLoading) return <Loading />;
  if (queue.error) return <ErrorBox error={queue.error} />;

  const machines = md!.machines.filter((m) => !processFilter || m.processId === Number(processFilter));
  const byMachine = new Map<number, QueueItem[]>();
  for (const it of queue.data!) byMachine.set(it.machineId!, [...(byMachine.get(it.machineId!) ?? []), it]);
  const visible = machines.filter((m) => showEmpty || (byMachine.get(m.id)?.length ?? 0) > 0);
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  const toggleDone = (id: number) => setOpenDone((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const totalOpen = queue.data!.filter((p) => !p.done).length;
  const amount = (it: QueueItem) => {
    const m = md!.materials.find((x) => x.id === it.materialId);
    const fine = !m || m.unit === 'g' || m.unit === 'ml';
    return `${formatNumber(it.materialAmount, fine ? 1 : 3)} ${m ? MATERIAL_UNIT_LABELS[m.unit] : ''}`.trim();
  };

  const row = (it: QueueItem, idx: number | null) => {
    const overdue = isOrderOverdue(it.order) && !it.done;
    return (
      <li key={it.id} className={`grid grid-cols-[1.75rem_1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3 md:grid-cols-[2rem_1.75rem_1fr_14rem_9rem_9rem] ${it.done ? 'bg-zinc-50 dark:bg-zinc-950/40' : ''}`}>
        <span className="tabular hidden text-sm font-semibold text-zinc-400 md:block">{idx !== null ? String(idx + 1).padStart(2, '0') : ''}</span>
        <BigCheckbox checked={it.done} label={`„${it.name}“ ${it.done ? 'wieder öffnen' : 'erledigt'}`} onChange={(v) => patch.mutate({ id: it.id, body: { done: v }, name: it.name })} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={`font-semibold ${it.done ? 'text-zinc-400 line-through' : ''}`}>{it.name}</span>
            <span className="tabular bg-zinc-900 px-1.5 text-xs font-bold text-white dark:bg-white dark:text-zinc-900">{it.quantity}×</span>
            <PriorityBadge priority={it.order.priority} hideNormal />
          </div>
          <div className="truncate text-sm text-zinc-500">
            {[it.fileRef, it.estMinutes != null && `ca. ${fmtMin(it.estMinutes)}`, it.materialAmount != null && amount(it)].filter(Boolean).join(' · ')}
          </div>
        </div>
        <Link to={`/auftraege/${it.order.id}`} className="col-start-2 col-end-4 min-w-0 truncate text-sm md:col-auto" title={it.order.title}>
          <span className="tabular text-zinc-400">{String(it.order.id).padStart(3, '0')} </span>
          <span className="font-semibold text-brand-700 hover:underline dark:text-brand-500">{it.order.title}</span>
        </Link>
        <span className={`tabular hidden text-sm md:block ${overdue ? 'font-bold text-bad' : 'text-zinc-500'}`}>
          {it.order.dueDate ? `${overdue ? 'überfällig ' : 'bis '}${formatDateDe(it.order.dueDate)}` : '–'}
        </span>
        <div className="col-start-3 row-start-1 flex items-center justify-end gap-1 md:col-auto md:row-auto">
          {it.done ? <PartStatusBadge status="fertig" /> : <>
            {it.status === 'offen' && <Button size="sm" variant="accent" onClick={() => patch.mutate({ id: it.id, body: { status: 'in_arbeit' }, name: it.name })}><IconPlay />Start</Button>}
            {it.status === 'in_arbeit' && <><PartStatusBadge status="in_arbeit" /><Button icon size="sm" variant="ghost" aria-label="Fehldruck melden" title={`${PART_STATUS_LABELS.fehlgeschlagen} melden`} onClick={() => patch.mutate({ id: it.id, body: { status: 'fehlgeschlagen' }, name: it.name })}><IconX /></Button></>}
            {it.status === 'fehlgeschlagen' && <Button size="sm" variant="danger" title="Erneut einreihen" onClick={() => patch.mutate({ id: it.id, body: { status: 'offen' }, name: it.name })}><IconRefresh />Neu</Button>}
          </>}
        </div>
      </li>
    );
  };

  return (
    <>
      <PageHeader kicker={`${totalOpen} offene Teile`} title="Maschinen"
        subtitle="Warteschlange je Maschine – sortiert nach Status, Priorität und Deadline."
        actions={<>
          <Select aria-label="Verfahren" value={processFilter} onChange={(e) => set('verfahren', e.target.value)} className="w-56">
            <option value="">Alle Verfahren</option>
            {md!.processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-brand-500" checked={showEmpty} onChange={(e) => set('leer', e.target.checked ? '1' : '')} /> Freie Maschinen zeigen</label>
        </>} />

      {visible.length === 0 ? <EmptyState>Keine Teile in der Warteschlange – alles gedruckt.</EmptyState> : (
        <div className="card">
          <div className="hidden grid-cols-[2rem_1.75rem_1fr_14rem_9rem_9rem] gap-4 border-b border-zinc-200 px-5 py-3 text-[0.65rem] font-bold uppercase tracking-[0.14em] text-zinc-500 md:grid dark:border-zinc-800">
            <span>#</span><span aria-label="Erledigt"><IconCheck /></span><span>Teil</span><span>Auftrag</span><span>Deadline</span><span className="text-right">Aktion</span>
          </div>
          {visible.map((m) => {
            const items = byMachine.get(m.id) ?? [];
            const open = items.filter((i) => !i.done || justDone.has(i.id));
            const done = items.filter((i) => i.done && !justDone.has(i.id));
            const minutes = open.filter((i) => !i.done).reduce((s, i) => s + (i.estMinutes ?? 0), 0);
            const isOpen = openDone.has(m.id);
            return (
              <section key={m.id} aria-label={m.name} className="border-b-2 border-zinc-900 last:border-b-0 dark:border-zinc-700">
                {/* Maschinen-Kopfzeile */}
                <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 bg-zinc-100 px-5 py-3 dark:bg-zinc-800/60">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <h2 className="text-lg font-black uppercase tracking-tight">{m.name}</h2>
                    <span className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-500">{md!.processes.find((p) => p.id === m.processId)?.name}</span>
                    {!m.active && <span className="text-xs font-bold uppercase tracking-[0.12em] text-bad">Deaktiviert{m.note ? ` · ${m.note}` : ''}</span>}
                  </div>
                  <span className="tabular text-sm text-zinc-600 dark:text-zinc-400">
                    <b className="text-zinc-900 dark:text-white">{open.filter((i) => !i.done).length}</b> offen{minutes > 0 && ` · ca. ${fmtMin(minutes)}`}
                  </span>
                </header>

                {open.length > 0
                  ? <ol className="divide-y divide-zinc-200 dark:divide-zinc-800">{open.map((it, i) => row(it, i))}</ol>
                  : <p className="px-5 py-3 text-sm text-zinc-500">Nichts mehr offen.</p>}

                {done.length > 0 && (
                  <>
                    <button type="button" onClick={() => toggleDone(m.id)} aria-expanded={isOpen}
                      className="flex min-h-11 w-full items-center gap-2 border-t border-zinc-200 px-5 text-xs font-bold uppercase tracking-[0.12em] text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:hover:text-white">
                      <IconChevron className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      Erledigt ({done.length})
                    </button>
                    {isOpen && <ul className="divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">{done.map((it) => row(it, null))}</ul>}
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
