import { IconArrowLeft, IconCopy } from '../components/icons.tsx';
import type { OrderDetail } from '@fablab/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { emptyOrder, OrderForm, validateOrder, type OrderDraft } from '../components/OrderForm.tsx';
import { emptyPart, PartForm, validatePart, type PartDraft } from '../components/PartForm.tsx';
import { useToast } from '../components/Toast.tsx';
import { Button, Card, ErrorBox, Loading, PageHeader } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { useMasterData } from '../lib/hooks.ts';

let key = 1;
type Row = { key: number; part: PartDraft; errors: Record<string, string> };

export default function OrderNewPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { md, isLoading, error } = useMasterData();
  const [order, setOrder] = useState<OrderDraft>(emptyOrder);
  const [orderErrors, setOrderErrors] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Row[]>([{ key: key++, part: emptyPart(), errors: {} }]);

  const save = useMutation({
    mutationFn: (body: { order: OrderDraft; parts: PartDraft[] }) => api.post<OrderDetail>('/orders', body),
    onSuccess: (o) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.show('success', `Auftrag #${o.id} angelegt.`);
      navigate(`/auftraege/${o.id}`);
    },
    onError: (e) => toast.show('error', errorMessage(e)),
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const isBlank = (p: PartDraft) => !p.name.trim() && p.machineId == null && !p.fileRef && p.dimW == null;
  const submit = () => {
    const oe = validateOrder(order);
    setOrderErrors(oe);
    // Komplett leere Teil-Zeilen werden ignoriert
    const filled = rows.filter((r) => !isBlank(r.part));
    const checked = rows.map((r) => ({ ...r, errors: isBlank(r.part) ? {} : validatePart(r.part) }));
    setRows(checked);
    if (Object.keys(oe).length || checked.some((r) => Object.keys(r.errors).length)) {
      toast.show('error', 'Bitte die markierten Felder ausfüllen.');
      return;
    }
    save.mutate({ order, parts: filled.map((r) => r.part) });
  };

  const update = (k: number, part: PartDraft) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, part } : r)));
  const add = (from?: PartDraft) => setRows((rs) => [...rs, { key: key++, part: from ? { ...from, name: from.name ? `${from.name} (Kopie)` : '' } : emptyPart(rs.at(-1)?.part), errors: {} }]);

  return (
    <>
      <nav className="mb-4"><Link to="/auftraege" className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-zinc-500 hover:text-zinc-900 dark:hover:text-white"><IconArrowLeft />Aufträge</Link></nav>
      <PageHeader title="Neuer Auftrag" subtitle={<>Teile lieber aus einer Tabelle übernehmen? <Link to="/import" className="text-brand-700 underline dark:text-brand-500">Import aus Excel/CSV</Link></>} />

      <Card title="Auftrag" className="mb-4">
        <OrderForm value={order} onChange={setOrder} errors={orderErrors} />
      </Card>

      <h2 className="mb-2 mt-6 text-lg font-semibold">Teile ({rows.filter((r) => !isBlank(r.part)).length})</h2>
      <div className="flex flex-col gap-4">
        {rows.map((r, i) => (
          <Card key={r.key} title={`Teil ${i + 1}${r.part.name ? ` – ${r.part.name}` : ''}`} actions={<>
            <Button size="sm" variant="ghost" onClick={() => add(r.part)} title="Duplizieren"><IconCopy />Duplizieren</Button>
            {rows.length > 1 && <Button size="sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>Entfernen</Button>}
          </>}>
            <PartForm value={r.part} onChange={(p) => update(r.key, p)} md={md!} errors={r.errors} />
          </Card>
        ))}
      </div>

      <div className="sticky bottom-16 z-20 mt-4 flex flex-wrap justify-between gap-2 rounded-md border border-zinc-200 bg-white/95 p-3 shadow-lg backdrop-blur lg:bottom-4 dark:border-zinc-800 dark:bg-zinc-900/95">
        <Button onClick={() => add()}>+ Weiteres Teil</Button>
        <div className="flex gap-2">
          <Button onClick={() => navigate(-1)}>Abbrechen</Button>
          <Button variant="primary" size="lg" onClick={submit} loading={save.isPending}>Auftrag anlegen</Button>
        </div>
      </div>
    </>
  );
}
