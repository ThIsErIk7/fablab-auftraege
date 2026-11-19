import { describe, expect, it } from 'vitest';
import {
  addDaysIso, allPartsDone, applyPartDone, applyPartStatus, canTransitionInvoice, canTransitionOrder,
  invoiceDisplayStatus, isInvoiceEditable, isOrderOverdue, shouldSuggestFinish,
} from './status.ts';
import { counterKey, formatInvoiceNumber, validateNumberFormat } from './invoiceNumber.ts';

describe('Auftragsstatus', () => {
  it('erlaubt den normalen Ablauf', () => {
    expect(canTransitionOrder('neu', 'in_bearbeitung')).toBe(true);
    expect(canTransitionOrder('in_bearbeitung', 'fertig')).toBe(true);
    expect(canTransitionOrder('fertig', 'abgeholt')).toBe(true);
  });
  it('verbietet unsinnige Sprünge', () => {
    expect(canTransitionOrder('neu', 'abgeholt')).toBe(false);
    expect(canTransitionOrder('abgeholt', 'storniert')).toBe(false);
    expect(canTransitionOrder('storniert', 'fertig')).toBe(false);
  });
  it('schlägt "Fertig" vor, wenn alle Teile erledigt sind', () => {
    expect(shouldSuggestFinish('in_bearbeitung', [{ done: true }, { done: true }])).toBe(true);
    expect(shouldSuggestFinish('in_bearbeitung', [{ done: true }, { done: false }])).toBe(false);
    expect(shouldSuggestFinish('fertig', [{ done: true }])).toBe(false);
    expect(allPartsDone([])).toBe(false);
  });
  it('überfällige Deadline nur bei offenen Aufträgen', () => {
    expect(isOrderOverdue({ status: 'neu', dueDate: '2026-01-01' }, '2026-02-01')).toBe(true);
    expect(isOrderOverdue({ status: 'fertig', dueDate: '2026-01-01' }, '2026-02-01')).toBe(false);
  });
});

describe('Teilstatus', () => {
  it('Abhaken setzt Status auf Fertig, Zurücknehmen auf Offen', () => {
    expect(applyPartDone({ status: 'in_arbeit', done: false }, true)).toEqual({ status: 'fertig', done: true });
    expect(applyPartDone({ status: 'fertig', done: true }, false)).toEqual({ status: 'offen', done: false });
    expect(applyPartDone({ status: 'fehlgeschlagen', done: true }, false)).toEqual({ status: 'fehlgeschlagen', done: false });
  });
  it('Status Fertig hakt ab', () => {
    expect(applyPartStatus('fertig')).toEqual({ status: 'fertig', done: true });
    expect(applyPartStatus('fehlgeschlagen')).toEqual({ status: 'fehlgeschlagen', done: false });
  });
});

describe('Rechnungsstatus', () => {
  it('nur Entwürfe sind editierbar', () => {
    expect(isInvoiceEditable('entwurf')).toBe(true);
    expect(isInvoiceEditable('gestellt')).toBe(false);
    expect(canTransitionInvoice('entwurf', 'bezahlt')).toBe(false);
    expect(canTransitionInvoice('gestellt', 'bezahlt')).toBe(true);
    expect(canTransitionInvoice('storniert', 'gestellt')).toBe(false);
  });
  it('überfällig wird abgeleitet', () => {
    expect(invoiceDisplayStatus({ status: 'gestellt', dueDate: '2026-01-10' }, '2026-01-11')).toBe('ueberfaellig');
    expect(invoiceDisplayStatus({ status: 'gestellt', dueDate: '2026-01-11' }, '2026-01-11')).toBe('gestellt');
    expect(invoiceDisplayStatus({ status: 'bezahlt', dueDate: '2026-01-10' }, '2026-02-01')).toBe('bezahlt');
  });
  it('Fälligkeit über Monatsgrenzen', () => {
    expect(addDaysIso('2026-12-20', 14)).toBe('2027-01-03');
  });
});

describe('Rechnungsnummern-Format', () => {
  it('formatiert mit Jahr und Zähler', () => {
    expect(formatInvoiceNumber('FL-{YYYY}-{####}', 2026, 1)).toBe('FL-2026-0001');
    expect(formatInvoiceNumber('R{YY}{MM}-{###}', 2026, 42, 3)).toBe('R2603-042');
    expect(formatInvoiceNumber('{##}', 2026, 123)).toBe('123');
  });
  it('validiert', () => {
    expect(validateNumberFormat('FL-{YYYY}-{####}')).toBeNull();
    expect(validateNumberFormat('FL-{YYYY}')).toMatch(/Zähler/);
    expect(validateNumberFormat('FL-{JJJJ}-{###}')).toMatch(/Unbekannter/);
  });
  it('Zähler pro Jahr nur wenn Jahr im Format', () => {
    expect(counterKey('FL-{YYYY}-{####}', 2026)).toBe(2026);
    expect(counterKey('FL-{####}', 2026)).toBe(0);
  });
});
