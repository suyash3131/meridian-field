'use client';

import { useCompanion } from './shell';

/** Paise to rupees, Indian grouping. The API sends paise; nothing here does
 *  arithmetic beyond this conversion and summing figures it was given. */
export const rs = (p: number | string) => '₹' + Math.round(Number(p) / 100).toLocaleString('en-IN');

/** The bar across the top of every manager page. */
export function PageHeader({ title, sub, children }:
  { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  const { setOpen } = useCompanion();
  return (
    <header className="h-16 flex items-center gap-4 px-5 sm:px-8 border-b border-line">
      <h2 className="text-[0.9375rem] font-semibold">{title}</h2>
      {sub && <p className="hidden sm:block text-[0.8125rem] text-ink-3">{sub}</p>}
      <div className="ml-auto flex items-center gap-2">
        {children}
        <button
          onClick={() => setOpen(true)}
          className="xl:hidden inline-flex items-center gap-2 h-9 px-3 rounded-[9px] bg-ink text-white
                     text-[0.8125rem] font-medium"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
               strokeLinecap="round" aria-hidden><path d="M4 12h3l2-5 3 10 2-5h6" /></svg>
          Ask Meridian
        </button>
      </div>
    </header>
  );
}

/** A segmented control. Real buttons, one pressed. */
export function Segmented<T extends string>({ value, options, onChange }:
  { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex p-[3px] gap-0.5 bg-track rounded-[10px]" role="group">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button key={o.label} onClick={() => onChange(o.key)} aria-pressed={on}
                  className={`h-[30px] px-3 rounded-[8px] text-[0.8125rem] font-medium transition-colors ${
                    on ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-ink-2 hover:text-ink'}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Bar({ pct, tone = 'ink', className = '' }:
  { pct: number; tone?: 'ink' | 'danger' | 'warn' | 'accent'; className?: string }) {
  const fill = { ink: 'bg-ink', danger: 'bg-danger-bar', warn: 'bg-warn-bar', accent: 'bg-accent' }[tone];
  return (
    <div className={`h-1.5 rounded-full bg-track overflow-hidden ${className}`} aria-hidden>
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function Initials({ name, tone = 'neutral' }: { name: string; tone?: 'neutral' | 'danger' }) {
  const t = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <span className={`h-[30px] w-[30px] shrink-0 rounded-full grid place-items-center text-[0.6875rem] font-semibold ${
      tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-track text-ink-2'}`} aria-hidden>
      {t}
    </span>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`rounded-lg bg-track animate-pulse ${className}`} aria-busy="true" />;
}

/** The sentence at the top of every page. The answer comes before the numbers. */
export function Headline({ eyebrow, title, sub }: { eyebrow?: string; title: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      {eyebrow && <p className="text-[0.8125rem] text-ink-3 mb-1.5">{eyebrow}</p>}
      <h1 className="text-[1.625rem] sm:text-[1.875rem] leading-[1.2] font-semibold tracking-[-0.025em] text-balance">
        {title}
      </h1>
      {sub && <p className="mt-1.5 text-[0.9375rem] text-ink-2 max-w-[62ch]">{sub}</p>}
    </div>
  );
}
