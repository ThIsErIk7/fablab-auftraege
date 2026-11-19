import type { HistoryEntry } from '@fablab/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorBox, Loading, PageHeader, Segmented } from '../components/ui.tsx';
import { api, qs } from '../lib/api.ts';

export default function HistoryPage() {
  const [entity, setEntity] = useState<'' | 'order' | 'part' | 'invoice'>('');
  const q = useQuery({ queryKey: ['history', { entity }], queryFn: () => api.get<HistoryEntry[]>(`/history${qs({ entity, limit: 500 })}`) });
  return (
    <>
      <PageHeader title="Verlauf" subtitle="Protokoll aller Statusänderungen mit Zeitstempel (neueste zuerst)."
        actions={<Segmented value={entity} onChange={setEntity} options={[{ value: '', label: 'Alle' }, { value: 'order', label: 'Aufträge' }, { value: 'part', label: 'Teile' }, { value: 'invoice', label: 'Rechnungen' }]} />} />
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : !q.data!.length ? <EmptyState>Keine Einträge.</EmptyState> : (
        <div className="card divide-y divide-zinc-200 dark:divide-zinc-800">
          {q.data!.map((e) => (
            <div key={e.id} className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3">
              <time className="tabular w-40 shrink-0 text-zinc-500" dateTime={e.at}>{new Date(e.at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</time>
              <span className="flex-1">{e.message}</span>
              {e.entity === 'invoice' ? <Link className="text-sm font-semibold text-brand-700 underline-offset-4 hover:underline dark:text-brand-500" to={`/rechnungen/${e.entityId}`}>Rechnung</Link>
                : e.orderId ? <Link className="text-sm font-semibold text-brand-700 underline-offset-4 hover:underline dark:text-brand-500" to={`/auftraege/${e.orderId}`}>Auftrag #{e.orderId}</Link> : null}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
