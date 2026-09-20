'use client';

import { useEffect, useRef, useState } from 'react';

const AGENT_ID = 'baseAgent_agent_1789922892145_ie20jx4g5';
const rs = (p: number) => '₹' + Math.round(p / 100).toLocaleString('en-IN');

type Finding = {
  code: string; headline: string; impactPaise: number;
  estimated: boolean; detail: Record<string, unknown>; lever: string | null;
};
type Answer = {
  scope: string; headline: string;
  trend: { thisWeek: number; lastWeek: number; deltaPaise: number; pct: number };
  findings: Finding[]; biggestLever: string | null;
};

declare global {
  interface Window { LuaPop?: { init: (c: Record<string, unknown>) => Promise<unknown>; destroy?: () => void } }
}

const SCOPES = [
  { key: 'North', label: 'North' },
  { key: 'South', label: 'South' },
  { key: '', label: 'All India' },
];

/** A cause reads as a line of argument, not a card. The ordinal down the left
 *  is what makes the list feel ranked rather than merely listed. */
function Cause({ n, f }: { n: number; f: Finding }) {
  return (
    <li className="grid grid-cols-[1.75rem_1fr] sm:grid-cols-[2.25rem_1fr] gap-x-2 py-5">
      <span className="ordinal pt-[0.3rem]">{String(n).padStart(2, '0')}</span>
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p className="text-[0.9375rem] leading-snug max-w-[46ch]">{f.headline}</p>
          {f.impactPaise > 0 && (
            <p className="fig text-[0.9375rem] text-signal whitespace-nowrap">
              {f.estimated && <span className="text-ink-faint">≈ </span>}
              {rs(f.impactPaise)}
            </p>
          )}
        </div>
        {f.lever && (
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-soft max-w-[54ch]">
            {f.lever}
          </p>
        )}
        {f.estimated && (
          <p className="mt-1.5 label">
            Estimated from coverage, not measured
          </p>
        )}
      </div>
    </li>
  );
}

export default function Ask() {
  const [region, setRegion] = useState<string>('North');
  const [a, setA] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(true);
  const booted = useRef(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/manager/answer?region=${encodeURIComponent(region)}`)
      .then((r) => r.json()).then((d) => { setA(d); setLoading(false); });
  }, [region]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const start = async () => {
      await window.LuaPop?.init({
        agentId: AGENT_ID,
        environment: 'production',
        displayMode: 'embedded',
        embeddedDisplayConfig: {
          targetContainerId: 'manager-chat',
          useContainerHeight: true,
          conversationStarters: [
            'why is north down this week',
            'what is waiting on me',
            'how is the south doing',
          ],
        },
        theme: 'light',
        sessionId: `meridian-manager-${Math.random().toString(36).slice(2, 10)}`,
        runtimeContext:
          'You are talking to Anita Rao, the regional head. She wants an answer, not a chart: ' +
          'a headline number, the causes in order of size, and the one thing worth doing. ' +
          'Use territory_answer. Never compute or restate a number it did not give you.',
      });
    };
    if (window.LuaPop) { start(); return; }
    const s = document.createElement('script');
    s.src = 'https://lua-ai-global.github.io/lua-pop/lua-pop.umd.js';
    s.onload = start;
    document.body.appendChild(s);
  }, []);

  const week = Math.ceil(
    ((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86_400_000 + 1) / 7
  );

  return (
    <div className="mx-auto max-w-[68rem] px-5 sm:px-8">
      <div className="grid gap-x-12 lg:grid-cols-[1fr_20rem]">

        {/* ---------------------------------------------------- the memo */}
        <article className="py-10 lg:py-12 lg:border-r lg:border-rule lg:pr-12">

          <div className="flex items-center gap-4 mb-8">
            <span className="label whitespace-nowrap">
              {region || 'All India'} · Week {week}
            </span>
            <span className="flex-1 h-px bg-rule" />
            <div className="flex gap-4">
              {SCOPES.map((s) => {
                const on = s.key === region;
                return (
                  <button
                    key={s.label}
                    onClick={() => setRegion(s.key)}
                    aria-pressed={on}
                    className={`label !text-[0.6875rem] whitespace-nowrap pb-0.5 border-b
                                transition-colors ${
                      on ? '!text-ink border-ink' : 'border-transparent hover:!text-ink-soft'
                    }`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* The question, quoted. It grounds the answer below it and it is a
              reminder of what this page is for. */}
          <p className="text-[0.8125rem] text-ink-faint mb-5 measure">
            “Is the number going to land, and if not, where is it leaking?”
          </p>

          {loading || !a ? (
            <div className="space-y-3" aria-busy="true">
              <div className="h-7 w-4/5 bg-paper-sunk" />
              <div className="h-7 w-3/5 bg-paper-sunk" />
            </div>
          ) : (
            <>
              <h1 className="answer">{a.headline}</h1>

              <p className="fig mt-4 text-[0.8125rem] text-ink-faint">
                {rs(a.trend.lastWeek)}
                <span className="mx-2 text-rule-firm">→</span>
                {rs(a.trend.thisWeek)}
                {a.trend.pct !== 0 && (
                  <span className={a.trend.pct < 0 ? 'text-signal ml-3' : 'text-settled ml-3'}>
                    {a.trend.pct < 0 ? '▾' : '▴'} {Math.abs(a.trend.pct)}%
                  </span>
                )}
              </p>

              <div className="rule-label mt-11 mb-1">
                <span className="label">Why · biggest first</span>
              </div>

              <ol className="rows">
                {a.findings.map((f, i) => <Cause key={f.code + i} n={i + 1} f={f} />)}
              </ol>

              {a.biggestLever && (
                <div className="mt-10 border-t-2 border-ink pt-5">
                  <p className="label mb-2">Do this first</p>
                  <p className="text-[0.9375rem] leading-relaxed measure">{a.biggestLever}</p>
                </div>
              )}

              <p className="mt-10 label leading-relaxed measure">
                Every figure here is computed. The agent chooses what to look at
                and how to say it, and does none of the arithmetic.
              </p>
            </>
          )}
        </article>

        {/* --------------------------------------------------- the rail */}
        <aside className="pb-12 lg:py-12">
          <div className="rule-label mb-3">
            <span className="label">Ask it yourself</span>
          </div>
          <p className="text-[0.8125rem] text-ink-soft leading-relaxed mb-4">
            The same agent the reps use, in the same words you would say out loud.
          </p>
          <div className="border border-rule bg-white overflow-hidden">
            <div id="manager-chat" style={{ height: '30rem' }} />
          </div>
        </aside>
      </div>
    </div>
  );
}
