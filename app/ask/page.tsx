'use client';

import { useEffect, useState } from 'react';
import { Bar, Headline, PageHeader, Segmented, Skeleton, rs } from '../ui';

type Finding = {
  code: string; headline: string; impactPaise: number;
  estimated: boolean; detail: Record<string, unknown>; lever: string | null;
};
type Answer = {
  scope: string; headline: string;
  trend: { thisWeek: number; lastWeek: number; deltaPaise: number; pct: number };
  findings: Finding[]; biggestLever: string | null;
};
type Region = 'North' | 'South' | '';

const SCOPES: { key: Region; label: string }[] = [
  { key: 'North', label: 'North' },
  { key: 'South', label: 'South' },
  { key: '', label: 'All India' },
];

/** One word per kind of cause, so the list can be scanned by colour first. */
const KIND: Record<string, { label: string; cls: string; bar: 'danger' | 'warn' | 'ink' }> = {
  collections:  { label: 'Collections',   cls: 'bg-danger-soft text-danger', bar: 'danger' },
  coverage:     { label: 'Coverage',      cls: 'bg-track text-ink-2',        bar: 'ink' },
  credit_hold:  { label: 'Credit hold',   cls: 'bg-warn-soft text-warn',     bar: 'warn' },
  competitor:   { label: 'Early warning', cls: 'bg-info-soft text-info',     bar: 'ink' },
  cold_counter: { label: 'Not visited',   cls: 'bg-track text-ink-2',        bar: 'ink' },
};

/** "North is ₹1,53,653 this week against ₹1,92,165 last week — down 20%."
 *  becomes "North is down 20% this week." The figures sit beside it. */
function shortHeadline(a: Answer, label: string) {
  const p = a.trend.pct;
  if (p === 0) return `${label} is flat this week.`;
  return `${label} is ${p < 0 ? 'down' : 'up'} ${Math.abs(p)}% this week.`;
}

function weekNumber() {
  const now = new Date();
  return Math.ceil(((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86_400_000 + 1) / 7);
}

export default function EightOClock() {
  const [region, setRegion] = useState<Region>('North');
  const [a, setA] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/manager/answer?region=${encodeURIComponent(region)}`)
      .then((r) => r.json()).then((d) => { setA(d); setLoading(false); });
  }, [region]);

  const label = region || 'All India';
  const max = Math.max(1, ...(a?.findings.map((f) => f.impactPaise) ?? [1]));
  const w = weekNumber();

  return (
    <>
      <PageHeader title="Eight o’clock" sub={`Week ${w} · compared with week ${w - 1}`}>
        <Segmented value={region} options={SCOPES} onChange={setRegion} />
      </PageHeader>

      <div className="px-5 sm:px-8 py-7 flex flex-col gap-5 max-w-[76rem]">
        {loading || !a ? (
          <>
            <Skeleton className="h-[132px]" />
            <Skeleton className="h-[360px]" />
          </>
        ) : (
          <>
            <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="card px-6 py-6">
                <Headline
                  title={shortHeadline(a, label)}
                  sub={a.findings[0]?.code === 'collections'
                    ? 'Most of the gap is money owed, not orders lost.'
                    : undefined}
                />
              </div>
              <div className="card px-[22px] py-5 flex flex-col gap-3">
                <p className="label">Sales, {label}</p>
                <div>
                  <div className="flex justify-between text-[0.75rem] text-ink-3">
                    <span>Last week</span><span className="fig">{rs(a.trend.lastWeek)}</span>
                  </div>
                  <div className="mt-1.5 h-2.5 rounded bg-line-strong" />
                </div>
                <div>
                  <div className="flex justify-between text-[0.75rem] font-medium">
                    <span>This week</span><span className="fig">{rs(a.trend.thisWeek)}</span>
                  </div>
                  <div className="mt-1.5 h-2.5 rounded bg-ink"
                       style={{ width: `${Math.min(100, (a.trend.thisWeek / Math.max(1, a.trend.lastWeek)) * 100)}%` }} />
                </div>
                {a.trend.pct !== 0 && (
                  <p className={`fig mt-auto text-[0.8125rem] ${a.trend.pct < 0 ? 'text-danger' : 'text-accent'}`}>
                    {a.trend.pct < 0 ? '▾' : '▴'} {rs(Math.abs(a.trend.deltaPaise))} · {Math.abs(a.trend.pct)}%
                  </p>
                )}
              </div>
            </div>

            <section className="card overflow-hidden">
              <h2 className="px-5 py-4 text-[0.875rem] font-semibold">Why, biggest first</h2>
              <ol className="rows border-t border-track">
                {a.findings.map((f, i) => {
                  const k = KIND[f.code] ?? { label: f.code, cls: 'bg-track text-ink-2', bar: 'ink' as const };
                  return (
                    <li key={f.code + i} className="grid grid-cols-[1.25rem_1fr] sm:grid-cols-[1.25rem_1fr_180px] gap-x-4 gap-y-2 px-5 py-4">
                      <span className="fig text-[0.75rem] text-ink-4 pt-0.5">{String(i + 1).padStart(2, '0')}</span>
                      <div className="min-w-0">
                        <span className={`pill ${k.cls}`}>{k.label}</span>
                        <p className="mt-2 text-[0.875rem] font-medium leading-snug">{f.headline}</p>
                      </div>
                      <div className="col-start-2 sm:col-start-3">
                        {f.impactPaise > 0 ? (
                          <>
                            <p className="fig text-[0.875rem] font-medium sm:text-right">
                              {f.estimated && <span className="text-ink-4">≈ </span>}{rs(f.impactPaise)}
                            </p>
                            <Bar pct={(f.impactPaise / max) * 100} tone={k.bar} className="mt-2" />
                          </>
                        ) : (
                          <p className="text-[0.75rem] text-ink-3 sm:text-right">No rupee figure yet</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>

            {a.biggestLever && (
              <div className="rounded-[14px] bg-ink text-white px-[22px] py-[18px]">
                <p className="text-[0.75rem] font-medium text-ink-4">Do this first</p>
                <p className="mt-1 text-[0.9375rem] leading-relaxed">{a.biggestLever}</p>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
