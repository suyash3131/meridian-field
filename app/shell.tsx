'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import Companion from './companion';

/* The companion's open state is shared so any page header can open it on a
   screen too narrow to show it permanently. */
const CompanionCtx = createContext<{ open: boolean; setOpen: (v: boolean) => void }>({
  open: false, setOpen: () => {},
});
export const useCompanion = () => useContext(CompanionCtx);

const Icon = {
  today: <path d="M3 11l9-7 9 7M5 10v10h14V10" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  pulse: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  phone: <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18h2" /></>,
};

function Glyph({ d }: { d: React.ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d}
    </svg>
  );
}

const MANAGER = [
  { href: '/', label: 'Today', icon: Icon.today },
  { href: '/ask', label: 'Eight o’clock', icon: Icon.clock },
  { href: '/health', label: 'Agent health', icon: Icon.pulse },
];
const FIELD = [{ href: '/rep', label: 'At the counter', icon: Icon.phone }];

function NavLink({ href, label, icon, active, badge }:
  { href: string; label: string; icon: React.ReactNode; active: boolean; badge?: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2.5 h-10 px-3 rounded-[9px] text-[0.875rem] transition-colors ${
        active
          ? 'bg-surface text-ink font-medium shadow-[0_0_0_1px_var(--color-line)]'
          : 'text-ink-2 hover:text-ink hover:bg-track/60'
      }`}
    >
      <Glyph d={icon} />
      {label}
      {!!badge && (
        <span className="pill fig ml-auto bg-danger-soft text-danger">{badge}</span>
      )}
    </Link>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [waiting, setWaiting] = useState(0);
  const isManager = path !== '/rep';

  useEffect(() => {
    fetch('/api/manager/pulse').then((r) => r.json())
      .then((d) => setWaiting(d.approvals?.length ?? 0)).catch(() => {});
  }, [path]);

  useEffect(() => { setOpen(false); }, [path]);

  return (
    <CompanionCtx.Provider value={{ open, setOpen }}>
      <div className="flex h-full">

        {/* ---------------------------------------------------- sidebar */}
        <aside className="hidden md:flex w-[232px] shrink-0 flex-col px-3.5 py-5 border-r border-line">
          <Link href="/" className="flex items-center gap-2.5 px-2 pb-6">
            <span className="h-[30px] w-[30px] rounded-lg bg-accent text-white grid place-items-center
                             font-semibold text-[0.9375rem]">M</span>
            <span className="leading-tight">
              <span className="block text-[0.875rem] font-semibold tracking-[-0.01em]">Meridian Field</span>
              <span className="block text-[0.75rem] text-ink-3">Meridian Healthcare</span>
            </span>
          </Link>

          <nav className="flex flex-col gap-0.5" aria-label="Main">
            {MANAGER.map((n) => (
              <NavLink key={n.href} {...n} active={path === n.href}
                       badge={n.href === '/' ? waiting : undefined} />
            ))}
            <div className="h-px bg-line mx-2 my-3" />
            <p className="label px-3 pb-1.5">Field</p>
            {FIELD.map((n) => <NavLink key={n.href} {...n} active={path === n.href} />)}
          </nav>

          <div className="mt-auto flex items-center gap-2.5 border-t border-line px-2 pt-4">
            <span className="h-[30px] w-[30px] rounded-full bg-accent-soft text-accent grid place-items-center
                             text-[0.6875rem] font-semibold">AR</span>
            <span className="leading-tight">
              <span className="block text-[0.8125rem] font-medium">Anita Rao</span>
              <span className="block text-[0.75rem] text-ink-3">Regional head</span>
            </span>
          </div>
        </aside>

        {/* ------------------------------------------------------- main */}
        <div className="flex-1 min-w-0 h-full overflow-y-auto">
          {/* Narrow screens: the sidebar folds into one row of tabs. */}
          <nav className="md:hidden flex items-center gap-1 overflow-x-auto border-b border-line px-4 h-12"
               aria-label="Main">
            <span className="h-6 w-6 rounded-md bg-accent text-white grid place-items-center
                             text-[0.75rem] font-semibold mr-2 shrink-0">M</span>
            {[...MANAGER, ...FIELD].map((n) => (
              <Link key={n.href} href={n.href}
                    className={`shrink-0 px-2.5 h-8 grid place-items-center rounded-lg text-[0.8125rem] ${
                      path === n.href ? 'bg-surface text-ink font-medium shadow-[0_0_0_1px_var(--color-line)]'
                                      : 'text-ink-2'}`}>
                {n.label}
              </Link>
            ))}
          </nav>
          {children}
        </div>

        {/* -------------------------------------------------- companion */}
        {isManager && (
          <>
            {open && (
              <button aria-label="Close the agent panel" onClick={() => setOpen(false)}
                      className="xl:hidden fixed inset-0 z-30 bg-black/20" />
            )}
            <div className={`fixed inset-y-0 right-0 z-40 w-[min(380px,100vw)] transition-transform duration-200
                             xl:static xl:z-auto xl:translate-x-0 xl:shrink-0 ${
                               open ? 'translate-x-0 shadow-2xl' : 'translate-x-full'}`}>
              <Companion onClose={() => setOpen(false)} />
            </div>
          </>
        )}
      </div>
    </CompanionCtx.Provider>
  );
}
