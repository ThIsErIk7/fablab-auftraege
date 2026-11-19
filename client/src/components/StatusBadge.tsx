import type { CustomerType, InvoiceDisplayStatus, InvoiceType, OrderStatus, PartStatus, Priority } from '@fablab/shared';
import { CUSTOMER_TYPE_LABELS, INVOICE_STATUS_LABELS, ORDER_STATUS_LABELS, PART_STATUS_LABELS, PRIORITY_LABELS } from '@fablab/shared';
import { IconDown, IconUp } from './icons.tsx';

// Status als kompaktes Label mit farbigem Quadrat – ruhig, technisch, ohne Pastell-Pillen.
function Tag({ color, label, strike, title }: { color: string; label: string; strike?: boolean; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[0.7rem] font-bold uppercase tracking-[0.1em] text-zinc-700 dark:text-zinc-300 ${strike ? 'line-through opacity-60' : ''}`}>
      <span className={`h-2.5 w-2.5 shrink-0 ${color}`} aria-hidden />
      {label}
    </span>
  );
}

export const ORDER_STATUS_COLOR: Record<OrderStatus, string> = {
  neu: 'bg-zinc-900 dark:bg-white',
  in_bearbeitung: 'bg-brand-500',
  fertig: 'bg-ok',
  abgeholt: 'bg-zinc-400',
  storniert: 'bg-bad',
};
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Tag color={ORDER_STATUS_COLOR[status]} label={ORDER_STATUS_LABELS[status]} strike={status === 'storniert'} />;
}

const PART_COLOR: Record<PartStatus, string> = {
  offen: 'border-2 border-zinc-500 bg-transparent',
  in_arbeit: 'bg-brand-500',
  fertig: 'bg-ok',
  fehlgeschlagen: 'bg-bad',
};
export function PartStatusBadge({ status }: { status: PartStatus }) {
  return <Tag color={PART_COLOR[status]} label={PART_STATUS_LABELS[status]} />;
}

export function PriorityBadge({ priority, hideNormal }: { priority: Priority; hideNormal?: boolean }) {
  if (hideNormal && priority === 'normal') return null;
  if (priority === 'hoch') {
    return <span className="inline-flex items-center gap-0.5 bg-bad px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-[0.1em] text-white"><IconUp width={12} height={12} strokeWidth={3} />{PRIORITY_LABELS.hoch}</span>;
  }
  if (priority === 'niedrig') {
    return <span className="inline-flex items-center gap-0.5 text-[0.65rem] font-bold uppercase tracking-[0.1em] text-zinc-500"><IconDown width={12} height={12} strokeWidth={3} />{PRIORITY_LABELS.niedrig}</span>;
  }
  return <span className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-zinc-500">{PRIORITY_LABELS.normal}</span>;
}

const INV_COLOR: Record<InvoiceDisplayStatus, string> = {
  entwurf: 'border-2 border-zinc-500 bg-transparent',
  gestellt: 'bg-brand-500',
  bezahlt: 'bg-ok',
  ueberfaellig: 'bg-bad',
  storniert: 'bg-zinc-400',
};
export function InvoiceStatusBadge({ status, type }: { status: InvoiceDisplayStatus; type?: InvoiceType }) {
  if (type === 'storno') {
    const label = status === 'bezahlt' ? 'Storno · ausgeglichen' : status === 'gestellt' ? 'Storno · Erstattung offen' : `Storno · ${INVOICE_STATUS_LABELS[status]}`;
    return <Tag color="bg-zinc-900 dark:bg-white rotate-45 scale-75" label={label} />;
  }
  return <Tag color={INV_COLOR[status]} label={INVOICE_STATUS_LABELS[status]} strike={status === 'storniert'} />;
}

export function CustomerTypeBadge({ type }: { type: CustomerType }) {
  return <span className="text-[0.7rem] font-bold uppercase tracking-[0.1em] text-zinc-500">{CUSTOMER_TYPE_LABELS[type]}</span>;
}

/** Kleines Kennzeichen, z. B. "nicht abrechnen" */
export function Flag({ children }: { children: React.ReactNode }) {
  return <span className="border border-zinc-400 px-1.5 py-px text-[0.65rem] font-bold uppercase tracking-[0.1em] text-zinc-600 dark:border-zinc-600 dark:text-zinc-400">{children}</span>;
}
