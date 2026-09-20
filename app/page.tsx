'use client';

import { useEffect, useState } from 'react';

const rs = (p: number | string) => '₹' + Math.round(Number(p) / 100).toLocaleString('en-IN');

type Pulse = {
  today: { visits: number; orders: number; value: string; scheduled: number };
  byRep: { rep_id: string; name: string; region: string; scheduled: number; made: number; value: string }[];
  approvals: { id: string; outlet: string; rep: string; reason: string; order_id: string; value: string; age_days: number }[];
  flagged: { id: string; outlet: string; rep: string; note: string; at: string }[];
};

/** A hairline showing proportion. Not a chart — it earns its place because a
 *  manager scanning twelve rows reads a length faster than she reads "6 / 18". */
function Coverage({ made, scheduled }: { made: number; scheduled: number }) {
  if (!scheduled) return <span className="text-ink-faint">—</span>;
  const pct = Math.round((made / scheduled) * 100);
  const behind = pct < 60;
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="relative block h-[3px] w-14 bg-rule" aria-hidden>
        <span
          className={`absolute inset-y-0 left-0 ${behind ? 'bg-signal' : 'bg-ink'}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </span>
      <span className={`fig text-[0.8125rem] ${behind ? 'text-signal' : 'text-ink-soft'}`}>
        {made}/{scheduled}
      </span>
    </span>
  );
}

export default function Today() {
  const [d, setD] = useState<Pulse | null>(null);
  useEffect(() => { fetch('/api/manager/pulse').then((r) => r.json()).then(setD); }, []);

  // Rendered in the business's timezone, not the browser's or the server's.
  const fmt = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...o }).format(new Date());
  const today = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
  const dayName = fmt({ weekday: 'long' });

  return (
    <div className="mx-auto max-w-[68rem] px-5 sm:px-8 py-10 lg:py-12">
      <div className="rule-label mb-8">
        <span className="label">{today}</span>
      </div>

      {!d ? (
        <div className="h-7 w-3/5 bg-paper-sunk" aria-busy="true" />
      ) : (
        <>
          {/* Answer first, as a sentence. A manager should be able to leave after
              reading one line if the line is reassuring.

              The two sentences are separate blocks rather than one run of text:
              as a single paragraph the second one wrapped mid-phrase, and the
              thing that needs her is the thing that must not start mid-line. */}
          <h1 className="answer">
            {d.today.visits === 0 ? (
              <>Nothing logged yet today. {dayName}’s route is {d.today.scheduled} counters.</>
            ) : (
              <>{d.today.visits} of {d.today.scheduled} counters covered so far.</>
            )}
            {d.approvals.length > 0 && (
              <span className="block text-signal">
                {d.approvals.length} decision{d.approvals.length > 1 ? 's' : ''} waiting on you.
              </span>
            )}
          </h1>

          <p className="fig mt-4 text-[0.8125rem] text-ink-faint">
            {d.today.visits === 0 ? (
              <>Reps start at nine</>
            ) : (
              <>
                {d.today.orders} orders
                <span className="mx-2.5 text-rule-firm">·</span>
                {rs(d.today.value)} confirmed today
              </>
            )}
          </p>

          {/* ------------------------------------------------- approvals */}
          <section className="mt-12">
            <div className="rule-label mb-1">
              <span className="label">Needs a decision · nothing ships until you act</span>
            </div>

            {d.approvals.length === 0 ? (
              <p className="py-5 text-[0.875rem] text-ink-soft">
                Nothing is waiting. Every order placed today went straight through.
              </p>
            ) : (
              <ul className="rows">
                {d.approvals.map((a) => (
                  <li key={a.id} className="row-hover -mx-3 px-3 py-4
                                            grid gap-x-6 gap-y-1
                                            sm:grid-cols-[1fr_auto_5.5rem] items-baseline">
                    <div>
                      <p className="text-[0.9375rem]">
                        {a.outlet}
                        <span className="tag ml-2.5">{a.rep}</span>
                      </p>
                      <p className="mt-1 text-[0.8125rem] text-ink-soft max-w-[52ch]">{a.reason}</p>
                    </div>
                    <p className="fig text-[0.9375rem] text-signal sm:text-right">{rs(a.value)}</p>
                    <p className="fig text-[0.75rem] text-ink-faint sm:text-right">
                      {a.age_days === 0 ? 'today' : `${a.age_days}d held`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ------------------------------------------------------ reps */}
          <section className="mt-12">
            <div className="rule-label mb-1">
              <span className="label">Reps · today</span>
            </div>
            <ul className="rows">
              {d.byRep.map((r) => (
                <li key={r.rep_id} className="row-hover -mx-3 px-3 py-3
                                              grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_6rem_9rem_7rem]
                                              gap-x-6 gap-y-1 items-baseline">
                  <p className="text-[0.9375rem]">
                    {r.name}
                    <span className="tag ml-2.5">{r.rep_id}</span>
                  </p>
                  <p className="label hidden sm:block">{r.region}</p>
                  <div className="col-span-2 sm:col-span-1">
                    <Coverage made={r.made} scheduled={r.scheduled} />
                  </div>
                  <p className="fig text-[0.875rem] text-right">{rs(r.value)}</p>
                </li>
              ))}
            </ul>
          </section>

          {/* --------------------------------------------------- flagged */}
          <section className="mt-12">
            <div className="rule-label mb-1">
              <span className="label">Worth a look · recorded, not blocked</span>
            </div>
            <p className="pt-3 pb-1 text-[0.8125rem] text-ink-soft measure leading-relaxed">
              A counter off today’s route, or a visit logged from further away than it should be.
              Neither is stopped — a rep covering for a colleague who is ill has to be able to work.
            </p>
            {d.flagged.length === 0 ? (
              <p className="py-4 text-[0.875rem] text-ink-soft">Nothing flagged this week.</p>
            ) : (
              <ul className="rows mt-3">
                {d.flagged.map((f) => (
                  <li key={f.id} className="row-hover -mx-3 px-3 py-2.5
                                            flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5">
                    <p className="text-[0.875rem]">
                      {f.outlet}
                      <span className="tag ml-2.5">{f.rep}</span>
                    </p>
                    <p className="text-[0.75rem] text-ink-faint">
                      {f.note}
                      <span className="fig ml-3">{f.at}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
