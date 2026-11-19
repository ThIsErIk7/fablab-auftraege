import { IconPlay, IconX } from '../components/icons.tsx';
import type { Part, PartStatus, Priority } from '@fablab/shared';
import { formatDateDe, isOrderOverdue, PART_STATUS_LABELS } from '@fablab/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { PartStatusBadge, PriorityBadge } from '../components/StatusBadge.tsx';
import { useToast } from '../components/Toast.tsx';
import { BigCheckbox, Button, EmptyState, ErrorBox, Loading, PageHeader, Select } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { useMasterData } from '../lib/hooks.ts';

type QueueItem = Part & { order: { id: number; title: string; priority: Priority; dueDate: string | null; status: any; customerName: string } };

export default function MachinesPage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { md, isLoading } = useMasterData();
  const queue = useQuery({ queryKey: ['queue'], queryFn: () => api.get<QueueItem[]>('/machines/queue') });
  const processFilter = params.get('verfahren') ?? '';
  const showEmpty = params.get('leer') === '1';

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { done?: boolean; status?: PartStatus } }) => api.patch(`/parts/${id}`, body),
    onSuccess: () => ['queue', 'orders', 'order', 'dashboard', 'history'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
    onError: (e) => toast.show('error', errorMessage(e)),
  });

  if (isLoading || queue.isLoading) return <Loading />;
  if (queue.error) return <ErrorBox error={queue.error} />;

  const machines = md!.machines.filter((m) => !processFilter || m.processId === Number(processFilter));
  const byMachine = new Map<number, QueueItem[]>();
  for (const it of queue.data!) byMachine.set(it.machineId!, [...(byMachine.get(it.machineId!) ?? []), it]);
  const visible = machines.filter((m) => showEmpty || (byMachine.get(m.id)?.length ?? 0) > 0);
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };

  return (
    <>
      <PageHeader title="Maschinen" subtitle="Warteschlange: offene Teile aktiver Aufträge – sortiert nach Status, Priorität und Deadline."
        actions={<>
          <Select aria-label="Verfahren" value={processFilter} onChange={(e) => set('verfahren', e.target.value)} className="w-56">
            <option value="">Alle Verfahren</option>
            {md!.processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5 accent-brand-700" checked={showEmpty} onChange={(e) => set('leer', e.target.checked ? '1' : '')} /> Leere zeigen</label>
        </>} />

      {visible.length === 0 ? <EmptyState>Keine Teile in der Warteschlange – alles gedruckt.</EmptyState> : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {visible.map((m) => {
            const items = byMachine.get(m.id) ?? [];
            const minutes = items.reduce((s, i) => s + (i.estMinutes ?? 0), 0);
            return (
              <section key={m.id} className={`card flex flex-col ${!m.active ? 'opacity-70' : ''}`}>
                <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-semibold">{m.name}</h2>
                    <span className="rounded-full bg-zinc-100 px-2 text-sm dark:bg-zinc-800">{items.length}</span>
                  </div>
                  <div className="text-sm text-zinc-500">
                    {md!.processes.find((p) => p.id === m.processId)?.name}
                    {minutes > 0 && ` · ca. ${Math.floor(minutes / 60)} h ${minutes % 60} min geschätzt`}
                  </div>
                  {!m.active && <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-white">Deaktiviert{m.note ? `: ${m.note}` : ''}</div>}
                </header>
                {items.length === 0 ? <p className="p-4 text-zinc-500">Nichts geplant.</p> : (
                  <ol className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {items.map((it, idx) => (
                      <li key={it.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="w-5 text-right text-sm text-zinc-400">{idx + 1}</span>
                        <BigCheckbox checked={it.done} label={`„${it.name}“ erledigt`} onChange={(v) => patch.mutate({ id: it.id, body: { done: v } })} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{it.name}</span><span className="text-sm">× {it.quantity}</span>
                            <PartStatusBadge status={it.status} />
                            <PriorityBadge priority={it.order.priority} hideNormal />
                          </div>
                          <Link to={`/auftraege/${it.order.id}`} className="block truncate text-sm font-semibold text-brand-700 underline-offset-4 hover:underline dark:text-brand-500">#{it.order.id} {it.order.title}</Link>
                          <div className="text-xs text-zinc-500">
                            {[it.fileRef, it.estMinutes != null && `${it.estMinutes} min`, it.order.dueDate && `bis ${formatDateDe(it.order.dueDate)}`].filter(Boolean).join(' · ')}
                            {isOrderOverdue(it.order) && <span className="font-semibold text-bad"> · überfällig</span>}
                          </div>
                        </div>
                        {it.status === 'offen' && <Button size="sm" variant="accent" onClick={() => patch.mutate({ id: it.id, body: { status: 'in_arbeit' } })}><IconPlay />Start</Button>}
                        {it.status === 'in_arbeit' && <Button icon size="sm" variant="ghost" aria-label="Als fehlgeschlagen markieren" title={PART_STATUS_LABELS.fehlgeschlagen} onClick={() => patch.mutate({ id: it.id, body: { status: 'fehlgeschlagen' } })}><IconX /></Button>}
                        {it.status === 'fehlgeschlagen' && <Button size="sm" onClick={() => patch.mutate({ id: it.id, body: { status: 'offen' } })}>Neu einreihen</Button>}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
