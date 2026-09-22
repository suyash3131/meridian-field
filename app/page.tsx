'use client';

import { useEffect, useState } from 'react';
import { Bar, Headline, Initials, PageHeader, Skeleton, rs } from './ui';

type Pulse = {
  today: { visits: number; orders: number; value: string; scheduled: number };
  byRep: { rep_id: string; name: string; region: string; scheduled: number; made: number; value: string }[];
  approvals: { id: string; kind: string; outlet: string; rep: string; reason: string; order_id: string; value: string; age_days: number }[];
  flagged: { id: string; outlet: string; rep: string; note: string; at: string }[];
};
type Answer = {
  trend: { thisWeek: number; lastWeek: number; pct: number };
  findings: { code: string; detail: Record<string, number> }[];
};

const ist = (o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...o }).format(new Date());

/** Several held orders at one counter are one decision, not several. */
function groupByOutlet(approvals: Pulse['approvals']) {
  const m = new Map<string, { outlet: string; rep: string; reason: string; count: number; value: number; oldest: number }>();
  for (const a of approvals) {
    const g = m.get(a.outlet) ?? { outlet: a.outlet, rep: a.rep, reason: a.reason, count: 0, value: 0, oldest: 0 };
    g.count += 1;
    g.value += Number(a.value);
    g.oldest = Math.max(g.oldest, a.age_days);
    m.set(a.outlet, g);
  }
  return [...m.values()].sort((a, b) => b.oldest - a.oldest);
}

/** "Order takes Sharma Medical past its ₹50,000 credit limit" → "over its ₹50,000 limit". */
const shortReason = (r: string) => {
  const m = r.match(/past its (₹[\d,]+) credit limit/);
  return m ? `over its ${m[1]} limit` : r;
};

/** What a rep asked the ASM for, by approval kind. */
const REQUEST: Record<string, string> = {
  order_change: 'Change to a placed order',
  price_exception: 'Asking for a better price',
};

/** "5 held orders and 1 rep request are waiting on you." */
function waitingTitle(holds: number, changes: number) {
  const parts = [
    holds ? `${holds} held order${holds > 1 ? 's' : ''}` : '',
    changes ? `${changes} rep request${changes > 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  return `${parts.join(' and ')} ${holds + changes > 1 ? 'are' : 'is'} waiting on you.`;
}

function Kpi({ label, value, foot, tone }: { label: string; value: React.ReactNode; foot: React.ReactNode; tone?: 'danger' }) {
  return (
    <div className={`card px-[18px] py-4 flex flex-col gap-2.5 ${tone === 'danger' ? 'border-danger-line' : ''}`}>
      <p className={`label ${tone === 'danger' ? '!text-danger' : ''}`}>{label}</p>
      <p className={`fig text-[1.625rem] leading-none font-medium ${tone === 'danger' ? 'text-danger' : ''}`}>{value}</p>
      <p className="text-[0.75rem] text-ink-3">{foot}</p>
    </div>
  );
}

export default function Today() {
  const [d, setD] = useState<Pulse | null>(null);
  const [week, setWeek] = useState<Answer | null>(null);
  const [showFlagged, setShowFlagged] = useState(false);

  useEffect(() => {
    fetch('/api/manager/pulse').then((r) => r.json()).then(setD);
    fetch('/api/manager/answer?region=').then((r) => r.json()).then(setWeek);
  }, []);

  const hour = Number(ist({ hour: 'numeric', hour12: false }));
  const greeting = hour < 12 ? 'Good morning, Anita' : hour < 17 ? 'Good afternoon, Anita' : 'Good evening, Anita';
  // A rep's request (fix a placed order, a better price) is a decision too, but
  // it is not money held: it gets its own line and stays out of "Held for you".
  const holds = d ? d.approvals.filter((a) => !(a.kind in REQUEST)) : [];
  const changes = d ? d.approvals.filter((a) => a.kind in REQUEST) : [];
  const decisions = groupByOutlet(holds);
  const held = decisions.reduce((s, g) => s + g.value, 0);
  const overdue = week?.findings.find((f) => f.code === 'collections')?.detail;
  const started = (d?.today.visits ?? 0) > 0;

  return (
    <>
      <PageHeader title="Today" sub={ist({ weekday: 'long', day: 'numeric', month: 'long' })} />

      <div className="px-5 sm:px-8 py-7 flex flex-col gap-5 max-w-[76rem]">
        {!d ? (
          <>
            <Skeleton className="h-9 w-3/5" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px]" />)}
            </div>
          </>
        ) : (
          <>
            <Headline
              eyebrow={greeting}
              title={
                holds.length + changes.length > 0
                  ? <>{waitingTitle(holds.length, changes.length)}</>
                  : started
                    ? <>{d.today.visits} of {d.today.scheduled} counters covered so far.</>
                    : <>Nothing needs you right now.</>
              }
              sub={
                holds.length + changes.length > 0
                  ? 'Nothing ships until you decide.'
                  : started ? `${d.today.orders} orders placed today.` : 'Reps start at 9.'
              }
            />

            {/* ------------------------------------------------ figures */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
              <Kpi label="Covered today"
                   value={<>{d.today.visits}<span className="text-ink-4"> / {d.today.scheduled}</span></>}
                   foot={started ? `${rs(d.today.value)} confirmed` : 'Reps start at 9:00'} />
              <Kpi label="Held for you" tone={held ? 'danger' : undefined}
                   value={rs(held)}
                   foot={`${holds.length} orders · ${decisions.length} counter${decisions.length === 1 ? '' : 's'}`} />
              <Kpi label="This week"
                   value={week ? rs(week.trend.thisWeek) : '—'}
                   foot={week ? (
                     <>
                       <span className={`fig ${week.trend.pct < 0 ? 'text-danger' : 'text-accent'}`}>
                         {week.trend.pct < 0 ? '▾' : '▴'} {Math.abs(week.trend.pct)}%
                       </span>{' '}vs last week
                     </>
                   ) : 'All India'} />
              <Kpi label="Past payment terms"
                   value={overdue ? rs(overdue.overduePaise) : '—'}
                   foot={overdue ? `across ${overdue.counters} counters` : 'All India'} />
            </div>

            <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
              {/* -------------------------------------------- decisions */}
              <section className="card overflow-hidden">
                <div className="flex items-center gap-2.5 px-5 py-4">
                  <h2 className="text-[0.875rem] font-semibold">Needs your decision</h2>
                  {d.approvals.length > 0 && (
                    <span className="pill fig bg-danger-soft text-danger">{d.approvals.length}</span>
                  )}
                </div>
                {d.approvals.length === 0 ? (
                  <p className="px-5 pb-5 text-[0.875rem] text-ink-2">
                    Nothing is waiting. Every order went straight through.
                  </p>
                ) : (
                  <ul className="rows border-t border-track">
                    {decisions.map((g) => (
                      <li key={g.outlet} className="flex items-start gap-3.5 px-5 py-4">
                        <Initials name={g.outlet} tone="danger" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[0.875rem] font-medium">{g.outlet}</p>
                          <p className="mt-0.5 text-[0.8125rem] text-ink-2">
                            {g.count} order{g.count > 1 ? 's' : ''} {shortReason(g.reason)} · {g.rep}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="fig text-[0.875rem] font-medium">{rs(g.value)}</p>
                          <p className={`pill mt-1.5 ${g.oldest >= 3 ? 'bg-warn-soft text-warn' : 'bg-track text-ink-2'}`}>
                            {g.oldest === 0 ? 'today' : `${g.oldest} day${g.oldest > 1 ? 's' : ''}`}
                          </p>
                        </div>
                      </li>
                    ))}
                    {changes.map((c) => (
                      <li key={c.id} className="flex items-start gap-3.5 px-5 py-4">
                        <Initials name={c.outlet} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[0.875rem] font-medium">{c.outlet}</p>
                          <p className="mt-0.5 text-[0.8125rem] text-ink-2">
                            {REQUEST[c.kind]} · {c.rep}
                          </p>
                          <p className="mt-1 text-[0.8125rem] text-ink">{c.reason.replace(/^Rep asks: /, '')}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="fig text-[0.875rem] font-medium">{rs(c.value)}</p>
                          <p className="pill mt-1.5 bg-track text-ink-2">
                            {c.age_days === 0 ? 'today' : `${c.age_days} day${c.age_days > 1 ? 's' : ''}`}
                          </p>
                        </div>
                      </li>
                    ))}
                    <li className="px-5 py-3 bg-sunk text-[0.75rem] text-ink-3">
                      The agent can’t release a hold, change a placed order or give a discount. That decision stays with a person.
                    </li>
                  </ul>
                )}
              </section>

              {/* ------------------------------------------------- reps */}
              <section className="card overflow-hidden">
                <div className="flex items-center px-5 py-4">
                  <h2 className="text-[0.875rem] font-semibold">Reps</h2>
                  <p className="ml-auto text-[0.75rem] text-ink-3">Route covered today</p>
                </div>
                <ul className="rows border-t border-track">
                  {d.byRep.map((r) => {
                    const pct = r.scheduled ? Math.round((r.made / r.scheduled) * 100) : 0;
                    const behind = started && r.scheduled > 0 && pct < 60;
                    return (
                      <li key={r.rep_id} className="flex items-center gap-3.5 px-5 py-3.5">
                        <Initials name={r.name} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[0.875rem] font-medium">{r.name}</p>
                          <p className="text-[0.75rem] text-ink-3">{r.region} · {r.rep_id}</p>
                        </div>
                        <div className="w-[132px] shrink-0">
                          <Bar pct={pct} tone={behind ? 'danger' : 'ink'} />
                          <p className={`fig mt-1.5 text-[0.75rem] ${behind ? 'text-danger' : 'text-ink-2'}`}>
                            {r.scheduled ? `${r.made} of ${r.scheduled}` : 'No route today'}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>

            {/* --------------------------------------------- flagged */}
            {d.flagged.length > 0 && (
              <section className="card overflow-hidden">
                <button
                  onClick={() => setShowFlagged((v) => !v)}
                  aria-expanded={showFlagged}
                  className="w-full flex flex-wrap items-center gap-x-3.5 gap-y-1 px-5 py-4 text-left"
                >
                  <span className="text-[0.875rem] font-medium">
                    {d.flagged.length} visit{d.flagged.length > 1 ? 's' : ''} worth a look
                  </span>
                  <span className="text-[0.8125rem] text-ink-3">Off route or far from the counter. Logged, not blocked.</span>
                  <span className="ml-auto text-[0.8125rem] font-medium text-accent">
                    {showFlagged ? 'Hide' : 'Review'}
                  </span>
                </button>
                {showFlagged && (
                  <ul className="rows border-t border-track">
                    {d.flagged.map((f) => (
                      <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                        <span className="text-[0.875rem] font-medium">{f.outlet}</span>
                        <span className="text-[0.8125rem] text-ink-3">{f.rep}</span>
                        <span className="pill bg-warn-soft text-warn">{f.note}</span>
                        <span className="fig ml-auto text-[0.75rem] text-ink-3">{f.at}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
