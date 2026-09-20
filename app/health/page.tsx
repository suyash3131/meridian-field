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
  if (!d) return <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 text-muted">Loading…</div>;

  const cards = [
    {
      label: 'Time to a placed order',
      value: d.speed.medianSeconds != null ? `${d.speed.medianSeconds}s` : '—',
      sub: `median of ${d.speed.sample} · 90th percentile ${d.speed.p90Seconds ?? '—'}s · target under ${d.speed.target}s`,
      bad: (d.speed.medianSeconds ?? 0) > d.speed.target,
      why: 'The thirty-second promise, measured rather than claimed.',
    },
    {
      label: 'Questions per order',
      value: d.questions.perOrder.toFixed(2),
      sub: `${d.questions.answeredWithoutAsking}% placed without asking anything · budget ${d.questions.budget}`,
      bad: d.questions.perOrder > d.questions.budget,
      why: 'If this drifts above one, reps stop using it. They will not tell anyone first.',
    },
    {
      label: 'Resolved without asking',
      value: `${d.matching.autoResolvedPct}%`,
      sub: `across ${d.matching.lines} order lines`,
      bad: d.matching.autoResolvedPct < 80,
      why: 'The alias table’s report card. It should climb every week on its own.',
    },
    {
      label: 'Abandoned drafts',
      value: String(d.abandoned.count),
      sub: `${d.abandoned.pct}% of ${d.abandoned.started} conversations started`,
      bad: d.abandoned.pct > 10,
      why: 'A rep who started and walked away has already decided. This moves before order volume does.',
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-8">
      <div>
        <h1 className="text-lg font-semibold">Agent health</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Not whether it crashed — whether it is being used. Order volume tells you the product
          worked last month. These tell you whether it will still be working next month.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <div key={c.label} className="rounded border border-line bg-panel p-4">
            <div className="text-xs uppercase tracking-wide text-muted">{c.label}</div>
            <div className={`text-3xl font-semibold num mt-1 ${c.bad ? 'text-alarm' : 'text-accent'}`}>
              {c.value}
            </div>
            <div className="text-xs text-muted mt-1">{c.sub}</div>
            <div className="text-xs text-muted mt-2 border-t border-line pt-2">{c.why}</div>
          </div>
        ))}
      </div>

      {/* Every row here is one alias away from never being asked about again.
          This is the list someone works through on a Friday afternoon. */}
      <section>
        <h2 className="text-sm font-semibold mb-1">Phrases we keep asking about</h2>
        <p className="text-xs text-muted mb-3">
          Each of these cost a rep a question. Confirming the right product once adds a learned
          alias, and the next rep who types it is never asked.
        </p>
        {d.phrasesWeKeepAskingAbout.length === 0 ? (
          <p className="text-sm text-muted">Nothing needed asking about.</p>
        ) : (
          <div className="rounded border border-line divide-y divide-line">
            {d.phrasesWeKeepAskingAbout.map((p) => (
              <div key={p.phrase} className="px-3 py-2 flex justify-between text-sm">
                <span className="font-mono text-xs">&ldquo;{p.phrase}&rdquo;</span>
                <span className="text-muted text-xs num">asked {p.asked} of {p.times} times</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
