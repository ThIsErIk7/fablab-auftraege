import type { HistoryEntry, InvoiceListItem, OrderListItem } from '@fablab/shared';
import { formatCents, formatDateDe, isOrderOverdue } from '@fablab/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { IconAlert, IconArrowRight } from '../components/icons.tsx';
import { OrderStatusBadge, PriorityBadge } from '../components/StatusBadge.tsx';
import { Card, ErrorBox, Loading, PageHeader, ProgressBar } from '../components/ui.tsx';
import { api } from '../lib/api.ts';

interface Dashboard {
  counts: { neu: number; inBearbeitung: number; fertig: number; overdue: number };
  activeOrders: OrderListItem[];
  overdueOrders: OrderListItem[];
  dueSoon: OrderListItem[];
  readyForPickup: OrderListItem[];
  unbilledOrders: OrderListItem[];
  machines: { id: number; name: string; active: boolean; note: string | null; processName: string; openParts: number; runningParts: number; failedParts: number; estMinutes: number }[];
  invoices: { openCount: number; openCents: number; overdueCount: number; overdueCents: number; draftCount: number; overdue: InvoiceListItem[]; drafts: InvoiceListItem[] };
  recent: HistoryEntry[];
}

/** Kennzahl: große Zahl, kleines Versal-Label – wie die Zahlenblöcke auf fablab.sh */
function Stat({ label, value, sub, to, alert }: { label: string; value: ReactNode; sub?: ReactNode; to: string; alert?: boolean }) {
  return (
    <Link to={to} className={`group relative flex flex-col justify-between gap-4 bg-white p-5 transition-colors hover:bg-zinc-900 hover:text-white dark:bg-zinc-900 dark:hover:bg-white dark:hover:text-zinc-900 ${alert ? 'bracket' : ''}`}>
      <span className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-zinc-500 group-hover:text-zinc-400">{label}</span>
      <span>
        <span className={`tabular block text-5xl font-black leading-none ${alert ? 'text-bad group-hover:text-bad' : ''}`}>{value}</span>
        {sub && <span className="tabular mt-1 block text-sm text-zinc-500 group-hover:text-zinc-400">{sub}</span>}
      </span>
    </Link>
  );
}

const more = (to: string, label: string) => (
  <Link to={to} className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.1em] text-brand-700 hover:text-zinc-900 dark:text-brand-500 dark:hover:text-white">{label}<IconArrowRight /></Link>
);

export default function DashboardPage() {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/dashboard'), refetchInterval: 60_000 });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const maxLoad = Math.max(1, ...d.machines.map((m) => m.openParts + m.runningParts));
  const busy = d.machines.filter((m) => m.openParts + m.runningParts + m.failedParts > 0 || !m.active);
  const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <PageHeader kicker={today} title="Übersicht" />

      {/* Kennzahlen als Raster mit 1-px-Fugen */}
      <div className="mb-10 grid grid-cols-2 gap-px border border-zinc-200 bg-zinc-200 md:grid-cols-3 xl:grid-cols-6 dark:border-zinc-800 dark:bg-zinc-800">
        <Stat label="Neu" value={d.counts.neu} to="/auftraege?status=neu" />
        <Stat label="In Bearbeitung" value={d.counts.inBearbeitung} to="/auftraege?status=in_bearbeitung" />
        <Stat label="Abholbereit" value={d.counts.fertig} to="/auftraege?status=fertig" />
        <Stat label="Deadline überfällig" value={d.counts.overdue} to="/auftraege?overdue=1&status=neu,in_bearbeitung" alert={d.counts.overdue > 0} />
        <Stat label="Offene Rechnungen" value={d.invoices.openCount} sub={formatCents(d.invoices.openCents)} to="/rechnungen?status=offen" />
        <Stat label="Überfällig" value={d.invoices.overdueCount} sub={formatCents(d.invoices.overdueCents)} to="/rechnungen?status=ueberfaellig" alert={d.invoices.overdueCount > 0} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Aktive Aufträge" className="xl:col-span-2" actions={more('/auftraege', 'Alle')} flush>
          {d.activeOrders.length === 0 ? <p className="p-5 text-zinc-500">Keine offenen Aufträge.</p> : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {d.activeOrders.slice(0, 12).map((o) => {
                const overdue = isOrderOverdue(o);
                return (
                  <li key={o.id}>
                    <Link to={`/auftraege/${o.id}`} className="grid gap-2 px-5 py-4 transition-colors hover:bg-zinc-50 sm:grid-cols-[1fr_13rem] sm:items-center sm:gap-6 dark:hover:bg-zinc-800/50">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="tabular text-sm text-zinc-400">{String(o.id).padStart(3, '0')}</span>
                          <span className="truncate text-lg font-semibold">{o.title}</span>
                          <PriorityBadge priority={o.priority} hideNormal />
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-zinc-500">
                          <OrderStatusBadge status={o.status} />
                          <span>{o.customerName}</span>
                          {o.dueDate && <span className={`tabular ${overdue ? 'font-bold text-bad' : ''}`}>{overdue ? 'überfällig · ' : 'bis '}{formatDateDe(o.dueDate)}</span>}
                        </div>
                      </div>
                      <ProgressBar done={o.partsDone} total={o.partsTotal} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          {(d.overdueOrders.length > 0 || d.dueSoon.length > 0) && (
            <Card title="Deadlines · 7 Tage" flush>
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {[...d.overdueOrders, ...d.dueSoon].map((o) => {
                  const od = isOrderOverdue(o);
                  return (
                    <li key={o.id}>
                      <Link to={`/auftraege/${o.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                        <span className="flex min-w-0 items-center gap-2">{od && <IconAlert className="shrink-0 text-bad" />}<span className="truncate">{o.title}</span></span>
                        <span className={`tabular shrink-0 text-sm ${od ? 'font-bold text-bad' : 'text-zinc-500'}`}>{formatDateDe(o.dueDate)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {(d.unbilledOrders.length > 0 || d.invoices.draftCount > 0 || d.invoices.overdue.length > 0) && (
            <Card title="Abrechnung" actions={more('/rechnungen', 'Rechnungen')} flush>
              <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                {d.invoices.overdue.map((i) => (
                  <li key={i.id}><Link to={`/rechnungen/${i.id}`} className="flex justify-between gap-2 px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"><span className="font-semibold text-bad">{i.number} · überfällig</span><span className="tabular">{formatCents(i.grossCents)}</span></Link></li>
                ))}
                {d.invoices.drafts.map((i) => (
                  <li key={i.id}><Link to={`/rechnungen/${i.id}`} className="flex justify-between gap-2 px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"><span><span className="mr-2 text-[0.65rem] font-bold uppercase tracking-[0.1em] text-zinc-500">Entwurf</span>{i.orderTitle ?? i.recipient.name}</span><span className="tabular">{formatCents(i.grossCents)}</span></Link></li>
                ))}
                {d.unbilledOrders.map((o) => (
                  <li key={o.id}><Link to={`/auftraege/${o.id}`} className="block px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"><span className="mr-2 text-[0.65rem] font-bold uppercase tracking-[0.1em] text-brand-700 dark:text-brand-500">Abrechnen</span>{o.title}</Link></li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Teile pro Maschine" actions={more('/maschinen', 'Warteschlangen')}>
            {busy.length === 0 ? <p className="text-zinc-500">Alle Maschinen frei.</p> : (
              <ul className="space-y-4">
                {busy.map((m) => (
                  <li key={m.id}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-semibold">{m.name}{!m.active && <span className="ml-2 text-[0.65rem] font-bold uppercase tracking-[0.1em] text-bad">{m.note || 'deaktiviert'}</span>}</span>
                      <span className="tabular shrink-0 text-zinc-500">{m.runningParts > 0 && <span className="font-semibold text-zinc-900 dark:text-white">{m.runningParts} läuft · </span>}{m.openParts} offen{m.failedParts > 0 && <span className="font-semibold text-bad"> · {m.failedParts} Fehldruck</span>}</span>
                    </div>
                    <div className="mt-1.5 flex h-1.5 bg-zinc-200 dark:bg-zinc-800">
                      <div className="bg-zinc-900 dark:bg-white" style={{ width: `${(m.runningParts / maxLoad) * 100}%` }} />
                      <div className="bg-brand-500" style={{ width: `${(m.openParts / maxLoad) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Zuletzt" actions={more('/verlauf', 'Verlauf')} flush>
            <ol className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              {d.recent.map((e) => (
                <li key={e.id} className="flex gap-3 px-5 py-2.5">
                  <time className="tabular w-20 shrink-0 text-zinc-500">{new Date(e.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
                  {e.orderId ? <Link to={`/auftraege/${e.orderId}`} className="hover:underline">{e.message}</Link> : <span>{e.message}</span>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
