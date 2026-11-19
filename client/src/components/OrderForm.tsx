import { IconChevron } from './icons.tsx';
import type { CustomerType, OrderInput, Priority } from '@fablab/shared';
import { CUSTOMER_TYPES, CUSTOMER_TYPE_LABELS, PRIORITIES, PRIORITY_LABELS } from '@fablab/shared';
import { useState } from 'react';
import { Field, Input, Select, Textarea, Toggle } from './ui.tsx';

export type OrderDraft = Omit<OrderInput, 'status'> & { status?: OrderInput['status'] };

export const emptyOrder = (): OrderDraft => ({
  title: '', customerName: '', contact: null, customerType: 'privat', billToName: null, billToAddress: null,
  customerVatId: null, noBilling: false, dueDate: null, priority: 'normal', notes: null, assignee: null,
});

export function validateOrder(o: OrderDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!o.title.trim()) e.title = 'Bitte einen Titel angeben.';
  if (!o.customerName.trim()) e.customerName = 'Bitte Auftraggeber:in angeben.';
  return e;
}

export function OrderForm({ value, onChange, errors = {} }: { value: OrderDraft; onChange: (o: OrderDraft) => void; errors?: Record<string, string> }) {
  const set = <K extends keyof OrderDraft>(k: K, v: OrderDraft[K]) => onChange({ ...value, [k]: v });
  const [showBilling, setShowBilling] = useState(!!(value.billToName || value.billToAddress || value.customerVatId));
  const nn = (s: string) => (s.trim() === '' ? null : s);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Titel" required error={errors.title} className="md:col-span-2">
        <Input value={value.title} onChange={(e) => set('title', e.target.value)} placeholder="z. B. Gehäuse für Sensor" autoFocus />
      </Field>
      <Field label="Auftraggeber:in" required error={errors.customerName}>
        <Input value={value.customerName} onChange={(e) => set('customerName', e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Kontakt (E-Mail / Telefon)">
        <Input value={value.contact ?? ''} onChange={(e) => set('contact', nn(e.target.value))} />
      </Field>
      <Field label="Kundentyp">
        <Select value={value.customerType} onChange={(e) => {
          const t = e.target.value as CustomerType;
          // Interne Projekte sind typischerweise nicht abzurechnen
          onChange({ ...value, customerType: t, noBilling: t === 'intern' ? true : value.customerType === 'intern' ? false : value.noBilling });
        }}>
          {CUSTOMER_TYPES.map((t) => <option key={t} value={t}>{CUSTOMER_TYPE_LABELS[t]}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Deadline">
          <Input type="date" value={value.dueDate ?? ''} onChange={(e) => set('dueDate', e.target.value || null)} />
        </Field>
        <Field label="Priorität">
          <Select value={value.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Zuständig">
        <Input value={value.assignee ?? ''} onChange={(e) => set('assignee', nn(e.target.value))} placeholder="Name" />
      </Field>
      <div className="flex items-end pb-2">
        <Toggle checked={value.noBilling} onChange={(v) => set('noBilling', v)} label="Nicht abrechnen" hint="z. B. interne opencampus-Projekte" />
      </div>
      <Field label="Notizen" className="md:col-span-2">
        <Textarea value={value.notes ?? ''} onChange={(e) => set('notes', nn(e.target.value))} />
      </Field>

      {!value.noBilling && (
        <div className="md:col-span-2">
          <button type="button" className="min-h-11 font-medium text-brand-700 dark:text-brand-500" onClick={() => setShowBilling((s) => !s)} aria-expanded={showBilling}>
            <IconChevron className={`inline transition-transform ${showBilling ? 'rotate-90' : ''}`} /> Rechnungsdaten {!showBilling && !value.billToAddress && <span className="text-sm font-normal text-zinc-500">(Rechnungsadresse wird für die Rechnung benötigt)</span>}
          </button>
          {showBilling && (
            <div className="mt-2 grid gap-4 rounded-md bg-zinc-50 p-4 md:grid-cols-2 dark:bg-zinc-950">
              <Field label="Rechnungsempfänger (Name/Firma)" hint="Leer = Auftraggeber:in">
                <Input value={value.billToName ?? ''} onChange={(e) => set('billToName', nn(e.target.value))} />
              </Field>
              <Field label="USt-IdNr. des Kunden (optional)">
                <Input value={value.customerVatId ?? ''} onChange={(e) => set('customerVatId', nn(e.target.value))} />
              </Field>
              <Field label="Rechnungsadresse" className="md:col-span-2" hint="Straße, PLZ Ort – mehrzeilig">
                <Textarea value={value.billToAddress ?? ''} onChange={(e) => set('billToAddress', nn(e.target.value))} rows={3} />
              </Field>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
