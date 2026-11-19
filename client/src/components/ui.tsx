import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { centsToEuroInput, millsToEuroInput, parseEuroToCents, parseEuroToMills, parseLocaleNumber } from '@fablab/shared';
import { IconAlert, IconCheck, IconX } from './icons.tsx';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success' | 'accent';
const VARIANTS: Record<Variant, string> = {
  // Primär wie das Logo: Anthrazit, im Dunkelmodus Cyan
  primary: 'bg-zinc-900 text-white hover:bg-brand-500 hover:text-zinc-900 dark:bg-brand-500 dark:text-zinc-900 dark:hover:bg-white',
  accent: 'bg-brand-500 text-zinc-900 hover:bg-zinc-900 hover:text-white dark:hover:bg-white dark:hover:text-zinc-900',
  secondary: 'border border-zinc-900 text-zinc-900 hover:bg-zinc-900 hover:text-white dark:border-zinc-300 dark:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900',
  danger: 'border border-bad text-bad hover:bg-bad hover:text-white',
  success: 'bg-ok text-zinc-900 hover:bg-zinc-900 hover:text-white dark:hover:bg-white dark:hover:text-zinc-900',
  ghost: 'text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800',
};

export function Button({ variant = 'secondary', size = 'md', className = '', loading, icon, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: boolean }) {
  const sizes = icon
    ? { sm: 'h-9 w-9', md: 'h-11 w-11', lg: 'h-14 w-14' }
    : { sm: 'min-h-9 px-4 text-xs', md: 'min-h-11 px-5 text-[0.8rem]', lg: 'min-h-14 px-7 text-sm' };
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold uppercase tracking-[0.08em] transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-40 ${sizes[size]} ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${small ? 'h-3.5 w-3.5' : 'h-7 w-7'}`} aria-label="Lädt" />;
}

export function Loading() {
  return <div className="flex justify-center p-16 text-brand-500"><Spinner /></div>;
}

export function ErrorBox({ error, children }: { error?: unknown; children?: ReactNode }) {
  const msg = children ?? (error instanceof Error ? error.message : String(error));
  return (
    <div role="alert" className="flex gap-3 border-l-4 border-bad bg-white p-4 whitespace-pre-line dark:bg-zinc-900">
      <IconAlert className="mt-0.5 shrink-0 text-bad" />{msg}
    </div>
  );
}

export function Notice({ tone = 'info', children, className = '' }: { tone?: 'info' | 'warn' | 'success'; children: ReactNode; className?: string }) {
  const bar = { info: 'border-brand-500', warn: 'border-warn', success: 'border-ok' }[tone];
  return <div className={`border-l-4 ${bar} bg-white px-4 py-3 dark:bg-zinc-900 ${className}`}>{children}</div>;
}

/** Abschnittsüberschrift im Stil der Website: klein, Versalien, gesperrt. */
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <h2 className={`text-xs font-bold uppercase tracking-[0.14em] text-zinc-900 dark:text-zinc-100 ${className}`}>{children}</h2>;
}

export function Card({ title, actions, children, className = '', flush }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-5 py-2 dark:border-zinc-800">
          <Eyebrow>{title}</Eyebrow>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, kicker }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; kicker?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b-2 border-zinc-900 pb-4 dark:border-zinc-100">
      <div className="min-w-0">
        {kicker && <div className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-500">{kicker}</div>}
        <h1 className="text-4xl font-black uppercase leading-none tracking-tight sm:text-5xl">{title}</h1>
        {subtitle && <div className="mt-2 text-zinc-600 dark:text-zinc-400">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, error, hint, children, className = '', required }: { label: string; error?: string | null; hint?: ReactNode; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}{required && <span className="text-brand-700 dark:text-brand-500"> *</span>}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
      {error && <span className="mt-1 block text-sm font-semibold text-bad">{error}</span>}
    </label>
  );
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`input ${p.className ?? ''}`} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...p} className={`input ${p.className ?? ''}`} />;
export const Select = ({ children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={`input ${p.className ?? ''}`}>{children}</select>
);

/** Zahlenfeld mit deutscher Eingabe ("1,5"). Gibt null bei leer zurück. */
export function NumberInput({ value, onChange, integer, ...rest }: { value: number | null; onChange: (v: number | null) => void; integer?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const fmt = (v: number | null) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
  const [text, setText] = useState(fmt(value));
  const [invalid, setInvalid] = useState(false);
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { setText(fmt(value)); last.current = value; } }, [value]);
  return (
    <input
      inputMode={integer ? 'numeric' : 'decimal'}
      {...rest}
      className={`input tabular ${rest.className ?? ''}`}
      aria-invalid={invalid || undefined}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseLocaleNumber(e.target.value);
        const ok = e.target.value.trim() === '' || (n !== null && (!integer || Number.isInteger(n)));
        setInvalid(!ok);
        if (ok) { last.current = e.target.value.trim() === '' ? null : n; onChange(last.current); }
      }}
    />
  );
}

/**
 * Euro-Eingabe. Standard: Wert in Cent. Mit `mills`: Wert in Zehntelcent (1/1000 €),
 * für Einzelpreise wie 0,035 €/g.
 */
export function MoneyInput({ cents, onChange, allowNegative, mills, ...rest }: { cents: number | null; onChange: (c: number | null) => void; allowNegative?: boolean; mills?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const toText = mills ? millsToEuroInput : centsToEuroInput;
  const parse = mills ? parseEuroToMills : parseEuroToCents;
  const [text, setText] = useState(toText(cents));
  const [invalid, setInvalid] = useState(false);
  const last = useRef(cents);
  useEffect(() => { if (cents !== last.current) { setText(toText(cents)); last.current = cents; } }, [cents]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative">
      <input
        inputMode="decimal"
        {...rest}
        className={`input tabular pr-8 text-right ${rest.className ?? ''}`}
        aria-invalid={invalid || undefined}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const c = parse(e.target.value);
          const ok = e.target.value.trim() === '' || (c !== null && (allowNegative || c >= 0));
          setInvalid(!ok);
          if (ok) { last.current = c; onChange(c); }
        }}
        onBlur={() => !invalid && setText(toText(last.current))}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500">€</span>
    </div>
  );
}

/** Große, eckige Checkbox zum Abhaken – für Finger am Tablet. */
export function BigCheckbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex h-12 w-12 shrink-0 items-center justify-center border-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-40 ${
        checked ? 'border-brand-500 bg-brand-500 text-zinc-900' : 'border-zinc-900 bg-white hover:bg-brand-50 dark:border-zinc-400 dark:bg-zinc-900 dark:hover:bg-zinc-800'
      }`}
    >
      {checked && <IconCheck width={28} height={28} strokeWidth={3} />}
    </button>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full border-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${checked ? 'border-brand-500 bg-brand-500' : 'border-zinc-900 bg-white dark:border-zinc-400 dark:bg-zinc-900'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${checked ? 'left-[1.4rem] bg-zinc-900' : 'left-0.5 bg-zinc-900 dark:bg-zinc-400'}`} />
      </button>
      <label htmlFor={id} className="cursor-pointer select-none">
        <span className="font-semibold">{label}</span>
        {hint && <span className="block text-sm text-zinc-500 dark:text-zinc-400">{hint}</span>}
      </label>
    </div>
  );
}

/** Fortschritt als Segmentleiste (ein Segment je Teil, bis 24), sonst durchgehend. */
export function ProgressBar({ done, total, className = '' }: { done: number; total: number; className?: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const full = total > 0 && done === total;
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="flex h-1.5 flex-1 gap-[2px]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${done} von ${total} Teilen erledigt`}>
        {total > 0 && total <= 24
          ? Array.from({ length: total }, (_, i) => (
              <span key={i} className={`flex-1 ${i < done ? (full ? 'bg-ok' : 'bg-brand-500') : 'bg-zinc-200 dark:bg-zinc-700'}`} />
            ))
          : (
            <span className="relative flex-1 bg-zinc-200 dark:bg-zinc-700">
              <span className={`absolute inset-y-0 left-0 ${full ? 'bg-ok' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
            </span>
          )}
      </div>
      <span className="tabular w-12 shrink-0 text-right text-sm font-semibold">{done}<span className="font-normal text-zinc-500">/{total}</span></span>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      className={`m-auto w-[calc(100%-1.5rem)] ${wide ? 'max-w-4xl' : 'max-w-lg'} border-t-4 border-brand-500 bg-white p-0 text-zinc-900 backdrop:bg-zinc-950/70 dark:bg-zinc-900 dark:text-zinc-100`}
    >
      {open && (
        <div className="flex max-h-[90vh] flex-col">
          <header className="flex items-center justify-between px-6 pb-2 pt-5">
            <h2 className="text-2xl font-black uppercase tracking-tight">{title}</h2>
            <Button icon variant="ghost" onClick={onClose} aria-label="Schließen"><IconX /></Button>
          </header>
          <div className="overflow-y-auto px-6 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 px-6 py-4 dark:border-zinc-800">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function Confirm({ open, title, text, confirmLabel = 'Bestätigen', danger, onConfirm, onClose, loading, children }:
  { open: boolean; title: string; text?: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void; loading?: boolean; children?: ReactNode }) {
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button></>}>
      {text && <p className="whitespace-pre-line">{text}</p>}
      {children}
    </Modal>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="border border-dashed border-zinc-400 p-10 text-center text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">{children}</div>;
}

/** Umschalter als Reiter mit Unterstrich (wie die Website-Navigation). */
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex gap-1" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={`min-h-10 border-b-2 px-3 text-xs font-bold uppercase tracking-[0.1em] transition-colors ${value === o.value ? 'border-brand-500 text-zinc-900 dark:text-white' : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Kleiner Textlink in Akzentfarbe. */
export const linkCls = 'font-semibold text-brand-700 underline-offset-4 hover:underline dark:text-brand-500';
