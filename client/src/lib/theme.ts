import { useEffect, useState } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';

function apply(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => {
    try { return (localStorage.getItem('theme') as ThemePref) ?? 'system'; } catch { return 'system'; }
  });
  useEffect(() => {
    apply(pref);
    try { pref === 'system' ? localStorage.removeItem('theme') : localStorage.setItem('theme', pref); } catch { /* egal */ }
    if (pref !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => apply('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [pref]);
  return [pref, setPref] as const;
}
