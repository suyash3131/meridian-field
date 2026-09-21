'use client';

import type { Lang } from './i18n';
import { T } from './i18n';

export type AttDay = { day: string; weekday: number; scheduled: number; made: number; flagged: number };

type State = 'full' | 'part' | 'missed' | 'none';
const STATE_CLS: Record<State, string> = {
  full: 'bg-accent text-white',
  part: 'bg-warn-soft text-warn',
  missed: 'bg-danger-soft text-danger',
  none: 'text-ink-4',
};

function stateOf(d: AttDay, isToday: boolean): State {
  if (!d.scheduled) return d.made ? 'full' : 'none';
  if (d.made >= d.scheduled) return 'full';
  if (d.made > 0) return 'part';
  // Today is not missed yet; it is still happening.
  return isToday ? 'none' : 'missed';
}

/** A month, one square per day. Nothing here can be tapped to change it. */
export default function AttendanceTab({ days, lang }: { days: AttDay[] | null; lang: Lang }) {
  const t = T[lang];
  if (!days) return <div className="p-4"><div className="h-64 rounded-2xl bg-track animate-pulse" /></div>;
  if (!days.length) return null;

  const today = days[days.length - 1].day;
  const first = new Date(days[0].day + 'T00:00:00');
  const monthLabel = new Intl.DateTimeFormat(t.locale, { month: 'long', year: 'numeric' }).format(first);

  // Pad the grid so the 1st lands under its weekday (Monday first).
  const monthStart = new Date(first.getFullYear(), first.getMonth(), 1);
  const lead = (monthStart.getDay() + 6) % 7;
  const firstDate = first.getDate();
  const cells: (AttDay | 'pad' | 'before')[] = [
    ...Array(lead).fill('pad'),
    ...Array(firstDate - 1).fill('before'),
    ...days,
  ];

  // Today is still happening, so the totals count finished days only.
  const working = days.filter((d) => d.scheduled > 0 && d.day !== today);
  const present = working.filter((d) => d.made > 0).length;
  const made = working.reduce((n, d) => n + Math.min(d.made, d.scheduled), 0);
  const scheduled = working.reduce((n, d) => n + d.scheduled, 0);

  return (
    <div className="p-3.5 flex flex-col gap-3">
      <section className="rounded-2xl bg-surface border border-line p-4">
        <p className="label">{monthLabel}</p>
        <p className="mt-1.5 text-[1.375rem] font-semibold tracking-[-0.02em] fig">{t.presentOf(present, working.length)}</p>
        <p className="mt-0.5 text-[0.8125rem] text-ink-2 fig">{t.visitsOf(made, scheduled)}</p>
      </section>

      <section className="rounded-2xl bg-surface border border-line p-3.5">
        <div className="grid grid-cols-7 gap-1.5 text-center">
          {t.weekdays.map((w, i) => <span key={i} className="text-[0.6875rem] font-medium text-ink-3 pb-1">{w}</span>)}
          {cells.map((c, i) => {
            if (c === 'pad') return <span key={i} />;
            if (c === 'before') return <span key={i} className="h-9 grid place-items-center text-[0.75rem] text-ink-4 fig">{i - lead + 1}</span>;
            const s = stateOf(c, c.day === today);
            return (
              <span key={i}
                    title={`${c.made}/${c.scheduled}`}
                    className={`h-9 rounded-lg grid place-items-center text-[0.75rem] font-medium fig ${STATE_CLS[s]} ${
                      c.day === today ? 'ring-2 ring-ink ring-offset-1' : ''}`}>
                {Number(c.day.slice(8))}
              </span>
            );
          })}
        </div>
        <div className="mt-3.5 flex flex-wrap gap-x-3.5 gap-y-1.5">
          {(['full', 'part', 'missed', 'none'] as State[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 text-[0.6875rem] text-ink-2">
              <span className={`h-2.5 w-2.5 rounded-[3px] ${s === 'none' ? 'bg-track' : STATE_CLS[s].split(' ')[0]}`} />
              {t.legend[s]}
            </span>
          ))}
        </div>
      </section>

      <p className="px-1 text-[0.75rem] leading-relaxed text-ink-3">{t.attendanceNote}</p>
    </div>
  );
}
