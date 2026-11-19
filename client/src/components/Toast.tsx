import { IconX } from './icons.tsx';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Kind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: Kind; text: string; action?: { label: string; onClick: () => void } }
interface Ctx { show: (kind: Kind, text: string, action?: Toast['action']) => void }

const ToastCtx = createContext<Ctx>({ show: () => {} });
let next = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const remove = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const show = useCallback((kind: Kind, text: string, action?: Toast['action']) => {
    const id = next++;
    setToasts((t) => [...t.slice(-3), { id, kind, text, action }]);
    setTimeout(() => remove(id), kind === 'error' ? 9000 : action ? 7000 : 3500);
  }, []);
  const styles: Record<Kind, string> = {
    success: 'border-ok',
    error: 'border-bad',
    info: 'border-brand-500',
  };
  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[100] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex max-w-lg items-start gap-3 border-l-4 bg-zinc-900 px-4 py-3 text-white shadow-[0_8px_24px_rgba(0,0,0,0.25)] dark:bg-white dark:text-zinc-900 ${styles[t.kind]}`}>
            <span className="whitespace-pre-line">{t.text}</span>
            {t.action && (
              <button className="shrink-0 text-xs font-bold uppercase tracking-[0.1em] text-brand-500 dark:text-brand-700" onClick={() => { t.action!.onClick(); remove(t.id); }}>{t.action.label}</button>
            )}
            <button aria-label="Schließen" className="shrink-0 opacity-60 hover:opacity-100" onClick={() => remove(t.id)}><IconX /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
