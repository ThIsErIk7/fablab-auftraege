import type { InvoiceListItem } from '@fablab/shared';
import { formatCents, formatDateDe } from '@fablab/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { InvoiceStatusBadge } from '../components/StatusBadge.tsx';
import { Button, EmptyState, ErrorBox, Input, Loading, PageHeader, Segmented } from '../components/ui.tsx';
import { api, download, qs } from '../lib/api.ts';

const FILTERS = [
  { value: '', label: 'Alle' },
  { value: 'entwurf', label: 'Entwürfe' },
  { value: 'offen', label: 'Offen' },
  { value: 'ueberfaellig', label: 'Überfällig' },
  { value: 'bezahlt', label: 'Bezahlt' },
  { value: 'storniert', label: 'Storniert' },
];

export default function InvoicesPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const query = useQuery({
    queryKey: ['invoices', { status, q, from, to }],
    queryFn: () => api.get<InvoiceListItem[]>(`/invoices${qs({ status, q, from, to })}`),
    placeholderData: keepPreviousData,
  });
  const list = query.data ?? [];
  const sum = list.filter((i) => i.status !== 'entwurf').reduce((s, i) => s + i.grossCents, 0);

  return (
    <>
      <PageHeader title="Rechnungen" actions={<>
        <Button onClick={() => download(`/export/rechnungen.xlsx${qs({ from, to })}`)}>Export XLSX (Buchhaltung)</Button>
        <Button onClick={() => download(`/export/rechnungen.csv${qs({ from, to })}`)}>CSV</Button>
      </>} />

      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="overflow-x-auto"><Segmented value={status} onChange={(v) => setParams(v ? { status: v } : {}, { replace: true })} options={FILTERS} /></div>
        <Input type="search" placeholder="Nummer, Empfänger, Auftrag" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" aria-label="Suche" />
        <label className="flex items-center gap-2 text-sm">Von <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></label>
        <label className="flex items-center gap-2 text-sm">Bis <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></label>
      </div>
      <p className="mb-2 text-sm text-zinc-500">Export enthält nur gestellte Rechnungen und Stornos{from || to ? ' im gewählten Zeitraum' : ''}. Rechnungen entstehen aus einem Auftrag (Auftragsdetail → „Rechnungsentwurf erstellen“).</p>

      {query.isLoading ? <Loading /> : query.error ? <ErrorBox error={query.error} /> : list.length === 0 ? <EmptyState>Keine Rechnungen gefunden.</EmptyState> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead className="border-b border-zinc-200 text-sm text-zinc-500 dark:border-zinc-800">
              <tr><th className="p-3">Nummer</th><th className="p-3">Empfänger / Auftrag</th><th className="p-3">Datum</th><th className="p-3">Fällig</th><th className="p-3 text-right">Brutto</th><th className="p-3">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {list.map((i) => (
                <tr key={i.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <td className="p-3"><Link to={`/rechnungen/${i.id}`} className="font-medium font-semibold text-brand-700 underline-offset-4 hover:underline dark:text-brand-500">{i.number ?? `Entwurf #${i.id}`}</Link>
                    {i.type === 'storno' && <div className="text-xs text-zinc-500">storniert {i.cancelsNumber}</div>}</td>
                  <td className="p-3"><div>{i.recipient.name}</div><div className="text-sm text-zinc-500">{i.orderId && `#${i.orderId} `}{i.orderTitle}</div></td>
                  <td className="tabular p-3">{formatDateDe(i.invoiceDate) || '–'}</td>
                  <td className={`tabular p-3 ${i.displayStatus === 'ueberfaellig' ? 'font-semibold text-bad' : ''}`}>{i.type === 'rechnung' ? formatDateDe(i.dueDate) || '–' : ''}</td>
                  <td className="tabular p-3 text-right">{formatCents(i.grossCents)}</td>
                  <td className="p-3"><InvoiceStatusBadge status={i.displayStatus} type={i.type} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-zinc-200 text-sm dark:border-zinc-800">
              <tr><td colSpan={4} className="p-3 text-zinc-500">{list.length} Rechnung(en), Summe ohne Entwürfe</td><td className="tabular p-3 text-right font-semibold">{formatCents(sum)}</td><td /></tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
