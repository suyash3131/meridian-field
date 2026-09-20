'use client';

import { useEffect, useState } from 'react';

const rs = (p: number | string) => '₹' + Math.round(Number(p) / 100).toLocaleString('en-IN');

type Pulse = {
  today: { visits: number; orders: number; value: string; scheduled: number };
  byRep: { rep_id: string; name: string; region: string; scheduled: number; made: number; value: string }[];
  approvals: { id: string; outlet: string; rep: string; reason: string; order_id: string; value: string; age_days: number }[];
  flagged: { id: string; outlet: string; rep: string; note: string; at: string }[];
};

export default function Today() {
  const [d, setD] = useState<Pulse | null>(null);
  useEffect(() => { fetch('/api/manager/pulse').then((r) => r.json()).then(setD); }, []);

  if (!d) return <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 text-muted">Loading…</div>;

  const covered = d.today.scheduled ? Math.round((d.today.visits / d.today.scheduled) * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-8">
      <div>
        <h1 className="text-lg font-semibold">Today</h1>
        <p className="text-sm text-muted mt-1">
          One screen, one question: is today going the way it should, and who is stuck.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['Counters covered', `${d.today.visits} / ${d.today.scheduled}`, `${covered}% of plan`],
          ['Orders', String(d.today.orders), 'placed today'],
          ['Order value', rs(d.today.value), 'confirmed today'],
          ['Waiting on you', String(d.approvals.length), 'approvals pending'],
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded border border-line bg-panel p-3">
            <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
            <div className="text-2xl font-semibold num mt-1">{value}</div>
            <div className="text-xs text-muted">{sub}</div>
          </div>
        ))}
      </div>

      {/* The approvals come first because they are the only thing on this page
          that stops work until a person acts. */}
      <section>
        <h2 className="text-sm font-semibold mb-2">
          Needs a decision <span className="font-normal text-muted">— nothing ships until you act</span>
        </h2>
        {d.approvals.length === 0 ? (
          <p className="text-sm text-muted">Nothing pending.</p>
        ) : (
          <div className="rounded border border-line divide-y divide-line">
            {d.approvals.map((a) => (
              <div key={a.id} className="p-3 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">
                    {a.outlet} <span className="text-muted font-normal">· {rs(a.value)} · {a.rep}</span>
                  </div>
                  <div className="text-xs text-warn mt-0.5">{a.reason}</div>
                </div>
                <div className="text-xs text-muted num">
                  {a.age_days === 0 ? 'today' : `${a.age_days}d waiting`}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">Reps today</h2>
        <div className="rounded border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-panel text-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-3 py-2">Rep</th>
                <th className="text-left font-medium px-3 py-2">Region</th>
                <th className="text-right font-medium px-3 py-2">Covered</th>
                <th className="text-right font-medium px-3 py-2">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.byRep.map((r) => {
                const pct = r.scheduled ? Math.round((r.made / r.scheduled) * 100) : 0;
                const behind = r.scheduled > 0 && pct < 60;
                return (
                  <tr key={r.rep_id}>
                    <td className="px-3 py-2">{r.name} <span className="text-muted">{r.rep_id}</span></td>
                    <td className="px-3 py-2 text-muted">{r.region}</td>
                    <td className={`px-3 py-2 text-right num ${behind ? 'text-alarm font-medium' : ''}`}>
                      {r.made} / {r.scheduled}{r.scheduled ? ` · ${pct}%` : ''}
                    </td>
                    <td className="px-3 py-2 text-right num">{rs(r.value)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Off-route and far-from-counter visits are surfaced, never blocked.
          A rep covering for a colleague who is ill must still be able to work. */}
      <section>
        <h2 className="text-sm font-semibold mb-2">
          Worth a look <span className="font-normal text-muted">— recorded, not blocked</span>
        </h2>
        {d.flagged.length === 0 ? (
          <p className="text-sm text-muted">Nothing flagged this week.</p>
        ) : (
          <div className="rounded border border-line divide-y divide-line">
            {d.flagged.map((f) => (
              <div key={f.id} className="px-3 py-2 flex flex-wrap justify-between gap-2 text-sm">
                <span>{f.outlet} <span className="text-muted">· {f.rep}</span></span>
                <span className="text-muted text-xs">{f.note} · {f.at}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
