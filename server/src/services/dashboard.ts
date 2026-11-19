import { isOrderOverdue, todayIso, addDaysIso } from '@fablab/shared';
import type { DB } from '../db/connection.ts';
import { listOrders } from '../repos/orders.ts';
import { listInvoices } from './invoices.ts';
import { listHistory } from './history.ts';

export function getDashboard(db: DB) {
  const today = todayIso();
  const active = listOrders(db, { status: ['neu', 'in_bearbeitung'], sort: 'due', dir: 'asc' });
  const finished = listOrders(db, { status: ['fertig'], sort: 'due', dir: 'asc' });
  const overdue = active.filter((o) => isOrderOverdue(o, today));
  const dueSoon = active.filter((o) => o.dueDate && o.dueDate >= today && o.dueDate <= addDaysIso(today, 7));

  const machines = db.prepare(`
    SELECT m.id, m.name, m.active, m.note, pr.name AS process_name,
      SUM(CASE WHEN p.status = 'offen' THEN 1 ELSE 0 END) AS open_parts,
      SUM(CASE WHEN p.status = 'in_arbeit' THEN 1 ELSE 0 END) AS running_parts,
      SUM(CASE WHEN p.status = 'fehlgeschlagen' THEN 1 ELSE 0 END) AS failed_parts,
      COALESCE(SUM(p.est_minutes), 0) AS est_minutes
    FROM machines m
    JOIN processes pr ON pr.id = m.process_id
    LEFT JOIN parts p ON p.machine_id = m.id AND p.done = 0
      AND p.order_id IN (SELECT id FROM orders WHERE status IN ('neu','in_bearbeitung'))
    GROUP BY m.id
    ORDER BY pr.sort, m.sort
  `).all() as any[];

  const invoices = listInvoices(db, {}).filter((i) => i.type === 'rechnung');
  const open = invoices.filter((i) => i.displayStatus === 'gestellt' || i.displayStatus === 'ueberfaellig');
  const overdueInv = invoices.filter((i) => i.displayStatus === 'ueberfaellig');
  const drafts = invoices.filter((i) => i.status === 'entwurf');
  const unbilled = finished.concat(listOrders(db, { status: ['abgeholt'] }))
    .filter((o) => !o.noBilling && o.invoiceCount === 0);

  return {
    counts: {
      neu: active.filter((o) => o.status === 'neu').length,
      inBearbeitung: active.filter((o) => o.status === 'in_bearbeitung').length,
      fertig: finished.length,
      overdue: overdue.length,
    },
    activeOrders: active,
    overdueOrders: overdue,
    dueSoon,
    readyForPickup: finished,
    unbilledOrders: unbilled,
    machines: machines.map((m) => ({
      id: m.id, name: m.name, active: m.active === 1, note: m.note, processName: m.process_name,
      openParts: m.open_parts ?? 0, runningParts: m.running_parts ?? 0, failedParts: m.failed_parts ?? 0, estMinutes: m.est_minutes,
    })),
    invoices: {
      openCount: open.length,
      openCents: open.reduce((s, i) => s + i.grossCents, 0),
      overdueCount: overdueInv.length,
      overdueCents: overdueInv.reduce((s, i) => s + i.grossCents, 0),
      draftCount: drafts.length,
      overdue: overdueInv,
      drafts,
    },
    recent: listHistory(db, { limit: 12 }),
  };
}
