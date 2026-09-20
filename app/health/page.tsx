'use client';

import { useEffect, useState } from 'react';

type Health = {
  speed: { medianSeconds: number | null; p90Seconds: number | null; sample: number; target: number };
  questions: { perOrder: number; answeredWithoutAsking: number; budget: number };
  matching: { autoResolvedPct: number; lines: number };
  abandoned: { count: number; started: number; pct: number };
  phrasesWeKeepAskingAbout: { phrase: string; times: number; asked: number }[];
};

export default function AgentHealth() {
  const [d, setD] = useState<Health | null>(null);
  useEffect(() => { fetch('/api/manager/health').then((r) => r.json()).then(setD); }, []);

  const metrics = !d ? [] : [
    {
      figure: d.speed.medianSeconds != null ? `${d.speed.medianSeconds}` : '—',
      unit: 's',
      label: 'Time to a placed order',
      meta: `median of ${d.speed.sample} · 90th percentile ${d.speed.p90Seconds ?? '—'}s · target under ${d.speed.target}s`,
      off: (d.speed.medianSeconds ?? 0) > d.speed.target,
      why: 'The thirty-second promise, measured rather than claimed.',
    },
    {
      figure: d.questions.perOrder.toFixed(2),
      unit: '',
      label: 'Questions per order',
      meta: `${d.questions.answeredWithoutAsking}% placed without asking anything · budget ${d.questions.budget}`,
      off: d.questions.perOrder > d.questions.budget,
      why: 'If this drifts above one, reps stop using it — and they will not tell anyone first.',
    },
    {
      figure: `${d.matching.autoResolvedPct}`,
      unit: '%',
      label: 'Resolved without asking',
      meta: `across ${d.matching.lines} order lines`,
      off: d.matching.autoResolvedPct < 80,
      why: 'The alias table’s report card. It should climb every week on its own.',
    },
    {
      figure: `${d.abandoned.count}`,
      unit: '',
      label: 'Abandoned drafts',
      meta: `${d.abandoned.pct}% of ${d.abandoned.started} conversations started`,
      off: d.abandoned.pct > 10,
      why: 'A rep who started and walked away has already decided. This moves before order volume does.',
    },
  ];

  return (
    <div className="mx-auto max-w-[68rem] px-5 sm:px-8 py-10 lg:py-12">
      <div className="rule-label mb-8">
        <span className="label">Instrumentation</span>
      </div>

      <h1 className="answer">Is the agent being used, or is it merely not crashing?</h1>

      <p className="mt-5 text-[0.9375rem] leading-relaxed text-ink-soft measure">
        Order volume tells you the product worked last month. These four tell you
        whether it will still be working next month.
      </p>

      {!d ? (
        <div className="mt-12 h-7 w-2/5 bg-paper-sunk" aria-busy="true" />
      ) : (
        <>
          <ul className="rows mt-12">
            {metrics.map((m) => (
              <li key={m.label} className="grid gap-x-8 gap-y-2 py-7
                                           sm:grid-cols-[7.5rem_1fr] items-baseline">
                <p className={`fig text-[2.25rem] leading-none tracking-tight
                               ${m.off ? 'text-signal' : 'text-ink'}`}>
                  {m.figure}
                  <span className="text-[1.25rem] text-ink-faint">{m.unit}</span>
                </p>
                <div>
                  <p className="text-[0.9375rem] font-medium">{m.label}</p>
                  <p className="fig mt-1 text-[0.75rem] text-ink-faint">{m.meta}</p>
                  <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-ink-soft max-w-[54ch]">
                    {m.why}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <section className="mt-14">
            <div className="rule-label mb-1">
              <span className="label">Phrases we keep asking about</span>
            </div>
            <p className="pt-3 pb-4 text-[0.8125rem] leading-relaxed text-ink-soft measure">
              Each of these cost a rep a question. Confirming the right product once writes a
              learned alias, and the next rep who types it is never asked. This is a work
              queue, not a chart — someone clears it on a Friday afternoon and the number above
              goes up on its own.
            </p>

            {d.phrasesWeKeepAskingAbout.length === 0 ? (
              <p className="py-4 text-[0.875rem] text-ink-soft">Nothing needed asking about.</p>
            ) : (
              <ul className="rows">
                {d.phrasesWeKeepAskingAbout.map((p) => (
                  <li key={p.phrase} className="row-hover -mx-3 px-3 py-2.5
                                                flex items-baseline justify-between gap-6">
                    <span className="fig text-[0.8125rem]">“{p.phrase}”</span>
                    <span className="fig text-[0.75rem] text-ink-faint whitespace-nowrap">
                      asked {p.asked} of {p.times}
                    </span>
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
