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

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Eight o&rsquo;clock</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          One question, asked differently every time: is the number going to land, and if not,
          where is it leaking. The answer below is computed — the agent chooses what to look at
          and how to say it, and never does the arithmetic itself.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <section className="space-y-4">
          <div className="flex gap-2">
            {['North', 'South', 'All'].map((r) => (
              <button key={r} onClick={() => setRegion(r === 'All' ? '' : r)}
                className={`rounded border px-3 py-1.5 text-sm ${
                  (r === 'All' ? '' : r) === region
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-line hover:bg-panel'}`}>
                {r}
              </button>
            ))}
          </div>

          {loading || !a ? (
            <p className="text-muted text-sm">Working it out…</p>
          ) : (
            <>
              <div className="rounded border border-line bg-panel p-4">
                <div className="text-base font-medium">{a.headline}</div>
                <div className="text-xs text-muted mt-1 num">
                  {rs(a.trend.lastWeek)} → {rs(a.trend.thisWeek)}
                  {a.trend.pct !== 0 && ` · ${a.trend.pct > 0 ? '+' : ''}${a.trend.pct}%`}
                </div>
              </div>

              <div>
                <h2 className="text-sm font-semibold mb-2">
                  Causes, biggest first
                  <span className="font-normal text-muted"> — sized in rupees so they can be compared</span>
                </h2>
                <ol className="space-y-2">
                  {a.findings.map((f, i) => (
                    <li key={f.code + i} className="rounded border border-line p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-medium">{i + 1}. {f.headline}</span>
                        {f.impactPaise > 0 && (
                          <span className="text-sm num text-alarm whitespace-nowrap">
                            {f.estimated ? '≈ ' : ''}{rs(f.impactPaise)}
                          </span>
                        )}
                      </div>
                      {f.lever && <div className="text-xs text-muted mt-1">{f.lever}</div>}
                      {f.estimated && (
                        <div className="text-[11px] text-muted mt-1 italic">
                          Estimated from coverage, not measured.
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </div>

              {a.biggestLever && (
                <div className="rounded border-l-2 border-accent bg-panel p-3">
                  <div className="text-xs uppercase tracking-wide text-muted">Do this first</div>
                  <div className="text-sm mt-1">{a.biggestLever}</div>
                </div>
              )}
            </>
          )}
        </section>

        <section>
          <div className="text-xs uppercase tracking-wide text-muted mb-2">
            Ask the agent — same agent the reps use
          </div>
          <div className="rounded border border-line overflow-hidden">
            <div id="manager-chat" style={{ height: '34rem' }} />
          </div>
        </section>
      </div>
    </div>
  );
}
