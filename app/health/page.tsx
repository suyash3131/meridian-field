'use client';

import { useEffect, useState } from 'react';
import { Bar, Headline, PageHeader, Skeleton } from '../ui';

type Health = {
  speed: { medianSeconds: number | null; p90Seconds: number | null; sample: number; target: number };
  questions: { perOrder: number; answeredWithoutAsking: number; budget: number };
  matching: { autoResolvedPct: number; lines: number };
  abandoned: { count: number; started: number; pct: number };
  phrasesWeKeepAskingAbout: { phrase: string; times: number; asked: number }[];
};

type Metric = {
  label: string; figure: string; unit?: string; pct: number;
  off: boolean; foot: string; marker?: number;
};

function MetricCard({ m }: { m: Metric }) {
  return (
    <div className={`card p-[18px] flex flex-col gap-2.5 ${m.off ? 'border-warn-line' : ''}`}>
      <p className="label">{m.label}</p>
      <p className="fig text-[2rem] leading-none font-medium">
        {m.figure}{m.unit && <span className="text-[1.125rem] text-ink-4">{m.unit}</span>}
      </p>
      <div className="relative">
        <Bar pct={m.pct} tone={m.off ? 'warn' : 'accent'} />
        {m.marker != null && (
          <span className="absolute -top-1 h-3.5 w-0.5 bg-ink" style={{ left: `${m.marker}%` }} aria-hidden />
        )}
      </div>
      <p className="text-[0.75rem] text-ink-3">{m.foot}</p>
    </div>
  );
}

export default function AgentHealth() {
  const [d, setD] = useState<Health | null>(null);
  useEffect(() => { fetch('/api/manager/health').then((r) => r.json()).then(setD); }, []);

  // Speed runs on a scale of 1.6× the target, with a tick where the target is,
  // so "just over" reads as just over. The rest are shares of their limit.
  const metrics: Metric[] = !d ? [] : [
    {
      label: 'Time to a placed order',
      figure: d.speed.medianSeconds != null ? `${d.speed.medianSeconds}` : '—', unit: 's',
      pct: ((d.speed.medianSeconds ?? 0) / (d.speed.target * 1.6)) * 100,
      marker: 100 / 1.6,
      off: (d.speed.medianSeconds ?? 0) > d.speed.target,
      foot: `Target under ${d.speed.target}s · slowest 10% take ${d.speed.p90Seconds ?? '—'}s`,
    },
    {
      label: 'Questions per order',
      figure: d.questions.perOrder.toFixed(2),
      pct: (d.questions.perOrder / d.questions.budget) * 100,
      off: d.questions.perOrder > d.questions.budget,
      foot: `Limit is ${d.questions.budget} · ${d.questions.answeredWithoutAsking}% needed no question`,
    },
    {
      label: 'Matched without asking',
      figure: `${d.matching.autoResolvedPct}`, unit: '%',
      pct: d.matching.autoResolvedPct,
      off: d.matching.autoResolvedPct < 80,
      foot: `Across ${d.matching.lines} order lines`,
    },
    {
      label: 'Abandoned drafts',
      figure: `${d.abandoned.count}`,
      pct: d.abandoned.pct,
      off: d.abandoned.pct > 10,
      foot: `${d.abandoned.pct}% of ${d.abandoned.started} started`,
    },
  ];

  const offCount = metrics.filter((m) => m.off).length;

  return (
    <>
      <PageHeader title="Agent health" sub={d ? `Last 4 weeks · ${d.abandoned.started} conversations` : 'Last 4 weeks'} />

      <div className="px-5 sm:px-8 py-7 flex flex-col gap-5 max-w-[76rem]">
        {!d ? (
          <>
            <Skeleton className="h-9 w-2/5" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[132px]" />)}
            </div>
          </>
        ) : (
          <>
            <Headline
              title={offCount === 0 ? 'Reps are using it, and it’s quick.'
                : offCount === 1 ? 'Reps are using it. One number needs watching.'
                : `${offCount} numbers need watching.`}
            />

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
              {metrics.map((m) => <MetricCard key={m.label} m={m} />)}
            </div>

            <section className="card overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-4">
                <div>
                  <h2 className="text-[0.875rem] font-semibold">Words the agent still asks about</h2>
                  <p className="mt-0.5 text-[0.8125rem] text-ink-2">
                    Once a rep confirms the product, nobody is asked about that word again.
                  </p>
                </div>
                {d.phrasesWeKeepAskingAbout.length > 0 && (
                  <span className="pill fig ml-auto bg-track text-ink-2">{d.phrasesWeKeepAskingAbout.length}</span>
                )}
              </div>

              {d.phrasesWeKeepAskingAbout.length === 0 ? (
                <p className="px-5 pb-5 text-[0.875rem] text-ink-2">Nothing needed asking about.</p>
              ) : (
                <>
                  <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)] px-5 py-2.5
                                  border-t border-track bg-sunk text-[0.75rem] font-medium text-ink-3">
                    <span>What the rep typed</span><span>Times typed</span><span>Had to ask</span>
                  </div>
                  <ul className="rows border-t border-track">
                    {d.phrasesWeKeepAskingAbout.map((p) => {
                      const share = p.times ? (p.asked / p.times) * 100 : 0;
                      return (
                        <li key={p.phrase}
                            className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)] items-center px-5 py-3">
                          <span className="fig text-[0.875rem]">“{p.phrase}”</span>
                          <span className="fig text-[0.8125rem]">{p.times}</span>
                          <span className="flex items-center gap-2.5">
                            <span className="fig text-[0.8125rem] w-4">{p.asked}</span>
                            <Bar pct={share} tone={share >= 50 ? 'danger' : 'ink'} className="w-20" />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
