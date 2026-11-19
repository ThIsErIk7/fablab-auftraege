import type { ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useTheme, type ThemePref } from '../lib/theme.ts';
import { IconAuto, IconMoon, IconSun } from './icons.tsx';

const I = (d: string) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square" aria-hidden><path d={d} /></svg>
);
const NAV: { to: string; label: string; icon: ReactNode; mobile?: boolean }[] = [
  { to: '/', label: 'Übersicht', icon: I('M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z'), mobile: true },
  { to: '/auftraege', label: 'Aufträge', icon: I('M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01'), mobile: true },
  { to: '/maschinen', label: 'Maschinen', icon: I('M3 6h18v10H3zM7 16v4M17 16v4M7 11h4'), mobile: true },
  { to: '/rechnungen', label: 'Rechnungen', icon: I('M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6'), mobile: true },
  { to: '/import', label: 'Import', icon: I('M12 3v12M7 10l5 5 5-5M4 21h16') },
  { to: '/verlauf', label: 'Verlauf', icon: I('M12 7v5l3 3M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5') },
  { to: '/admin', label: 'Einstellungen', icon: I('M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6'), mobile: true },
];

function ThemeSwitch({ onDark }: { onDark?: boolean }) {
  const [pref, setPref] = useTheme();
  const opts: { v: ThemePref; label: string; icon: ReactNode }[] = [
    { v: 'light', label: 'Hell', icon: <IconSun /> },
    { v: 'system', label: 'Wie System', icon: <IconAuto /> },
    { v: 'dark', label: 'Dunkel', icon: <IconMoon /> },
  ];
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="Farbschema">
      {opts.map((o) => (
        <button key={o.v} role="radio" aria-checked={pref === o.v} title={o.label} aria-label={o.label} onClick={() => setPref(o.v)}
          className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${pref === o.v
            ? 'bg-brand-500 text-zinc-900'
            : onDark ? 'text-zinc-400 hover:text-white' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'}`}>
          {o.icon}
        </button>
      ))}
    </div>
  );
}

export default function Layout() {
  return (
    <div className="min-h-screen lg:flex">
      {/* Seitenleiste: Anthrazit wie der Website-Footer */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-zinc-900 text-white lg:flex dark:border-r dark:border-zinc-800">
        <Link to="/" className="block px-6 pb-8 pt-7" aria-label="FabLab Kiel – Übersicht">
          <img src="/fablab-logo-white.png" alt="FabLab Kiel" className="h-auto w-36" />
          <div className="mt-3 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-zinc-400">Auftragsverwaltung</div>
        </Link>
        <nav className="flex flex-1 flex-col">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}
              className={({ isActive }) => `group flex min-h-12 items-center gap-3 border-l-4 px-5 text-sm font-semibold uppercase tracking-[0.1em] transition-colors ${isActive ? 'border-brand-500 bg-white/5 text-white' : 'border-transparent text-zinc-400 hover:text-white'}`}>
              {({ isActive }) => <><span className={isActive ? 'text-brand-500' : ''}>{n.icon}</span>{n.label}</>}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center justify-between border-t border-white/10 px-5 py-4">
          <span className="text-[0.65rem] uppercase tracking-[0.14em] text-zinc-500">opencampus.sh</span>
          <ThemeSwitch onDark />
        </div>
      </aside>

      {/* Kopfzeile auf schmalen Bildschirmen */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 bg-zinc-900 px-4 py-2 text-white lg:hidden">
        <Link to="/" aria-label="FabLab Kiel – Übersicht"><img src="/fablab-logo-white.png" alt="FabLab Kiel" className="h-9 w-auto" /></Link>
        <div className="flex items-center gap-1">
          <NavLink to="/import" className={({ isActive }) => `px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] ${isActive ? 'text-brand-500' : 'text-zinc-300'}`}>Import</NavLink>
          <NavLink to="/verlauf" className={({ isActive }) => `px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] ${isActive ? 'text-brand-500' : 'text-zinc-300'}`}>Verlauf</NavLink>
          <ThemeSwitch onDark />
        </div>
      </header>

      <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-4 pb-28 pt-8 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
        <Outlet />
      </main>

      {/* Untere Navigation (Tablet hochkant / Smartphone) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-zinc-800 bg-zinc-900 pb-[env(safe-area-inset-bottom)] lg:hidden">
        {NAV.filter((n) => n.mobile).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}
            className={({ isActive }) => `flex min-h-16 flex-col items-center justify-center gap-1 border-t-2 text-[0.65rem] font-semibold uppercase tracking-[0.08em] ${isActive ? 'border-brand-500 text-white' : 'border-transparent text-zinc-400'}`}>
            {n.icon}{n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
