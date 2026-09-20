'use client';

import { useEffect, useRef, useState } from 'react';

const AGENT_ID = 'baseAgent_agent_1789922892145_ie20jx4g5';

type Counter = { id: string; name: string; area: string; lat: number; lng: number; on_beat: boolean };
type Rep = { id: string; name: string; region: string; asm: string; counters: Counter[] };

declare global {
  interface Window { LuaPop?: { init: (c: Record<string, unknown>) => Promise<unknown>; destroy?: () => void } }
}

/** A stable per-browser suffix, so reloading resumes the same conversation
 *  instead of starting a fresh one and losing the thread mid-demo. */
function browserKey(): string {
  try {
    const k = localStorage.getItem('meridian_demo_key');
    if (k) return k;
    const v = Math.random().toString(36).slice(2, 10);
    localStorage.setItem('meridian_demo_key', v);
    return v;
  } catch { return 'nostore'; }
}

export default function RepView() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [weekday, setWeekday] = useState('');
  const [noRoute, setNoRoute] = useState(false);
  const [repId, setRepId] = useState('R-07');
  const [standingAt, setStandingAt] = useState<string>('');
  const [useRealGps, setUseRealGps] = useState(false);
  const [posNote, setPosNote] = useState('no location published yet');
  const mounted = useRef(false);

  const rep = reps.find((r) => r.id === repId);

  useEffect(() => {
    fetch('/api/reps').then((r) => r.json()).then((d) => {
      setReps(d.reps); setWeekday(d.weekday); setNoRoute(!!d.noRouteToday);
      const r7 = d.reps.find((r: Rep) => r.id === 'R-07') ?? d.reps[0];
      if (r7) { setRepId(r7.id); setStandingAt(r7.counters.find((c: Counter) => c.on_beat)?.id ?? r7.counters[0]?.id ?? ''); }
    });
  }, []);

  // ---- publish the rep's position -------------------------------------------
  // This is the only way a location enters the system. The agent has no tool
  // that accepts a coordinate, so nothing typed in the chat can produce one.
  async function publish(lat: number, lng: number, note: string) {
    await fetch('/api/agent/position', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repId, lat, lng, accuracyM: 25 }),
    });
    setPosNote(note);
  }

  useEffect(() => {
    if (!rep) return;
    if (useRealGps) {
      navigator.geolocation?.getCurrentPosition(
        (p) => publish(p.coords.latitude, p.coords.longitude, 'your real location — expect visits to be flagged'),
        () => setPosNote('browser refused location'),
        { enableHighAccuracy: true, timeout: 8000 }
      );
      return;
    }
    const c = rep.counters.find((x) => x.id === standingAt);
    if (!c) return;
    // A few metres of jitter, the way a phone reports it.
    publish(c.lat + (Math.random() - 0.5) * 0.0004, c.lng + (Math.random() - 0.5) * 0.0004,
      `outside ${c.name}, ${c.area}`);
  }, [repId, standingAt, useRealGps, rep?.id]);

  // ---- mount the Lua widget ---------------------------------------------------
  useEffect(() => {
    if (!rep) return;
    const start = async () => {
      if (!window.LuaPop) return;
      window.LuaPop.destroy?.();
      await window.LuaPop.init({
        agentId: AGENT_ID,
        environment: 'production',
        displayMode: 'embedded',
        embeddedDisplayConfig: {
          targetContainerId: 'counter-chat',
          useContainerHeight: true,
          conversationStarters: [
            'sharma medical 2 box 650 tablets and 1 baby lotion, he wants 15 days',
            'krishna chemist no order, cipla ne 10+3 diya hai',
            'what does sharma medical owe',
          ],
        },
        theme: 'light',
        attachmentsEnabled: true,
        sessionId: `meridian-${rep.id}-${browserKey()}`,
        runtimeContext:
          `The rep in this conversation is ${rep.name}, rep id ${rep.id}, ${rep.region} region, ` +
          `reporting to ${rep.asm}. Today is ${weekday}. If a tool takes an optional repId and ` +
          `nothing is bound yet, pass "${rep.id}".`,
      });
    };
    if (window.LuaPop) { start(); return; }
    if (mounted.current) return;
    mounted.current = true;
    const s = document.createElement('script');
    s.src = 'https://lua-ai-global.github.io/lua-pop/lua-pop.umd.js';
    s.onload = start;
    document.body.appendChild(s);
  }, [rep?.id, weekday]);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 grid gap-8 lg:grid-cols-[22rem_1fr]">
      <section className="space-y-5">
        <div>
          <h1 className="text-lg font-semibold">At the counter</h1>
          <p className="text-sm text-muted mt-1">
            This is the whole product for a rep. No app, no forms, no login — one chat,
            the way he already messages his manager.
          </p>
        </div>

        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted">You are</span>
          <select
            value={repId}
            onChange={(e) => {
              const r = reps.find((x) => x.id === e.target.value);
              setRepId(e.target.value);
              setStandingAt(r?.counters.find((c) => c.on_beat)?.id ?? r?.counters[0]?.id ?? '');
            }}
            className="mt-1 w-full rounded border border-line bg-panel px-3 py-2 text-sm"
          >
            {reps.map((r) => (
              <option key={r.id} value={r.id}>{r.name} · {r.id} · {r.region}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted">Standing outside</span>
          <select
            value={standingAt}
            disabled={useRealGps}
            onChange={(e) => setStandingAt(e.target.value)}
            className="mt-1 w-full rounded border border-line bg-panel px-3 py-2 text-sm disabled:opacity-50"
          >
            {rep?.counters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.on_beat ? '' : '  (not on today’s route)'}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted">📍 {posNote}</span>
          {noRoute && (
            <span className="mt-1 block text-xs text-muted">
              {weekday} — no beat runs today, so nothing counts as off-route.
            </span>
          )}
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={useRealGps} onChange={(e) => setUseRealGps(e.target.checked)}
                 className="mt-1" />
          <span>
            Use my real location
            <span className="block text-xs text-muted">
              You are not in Karol Bagh, so every visit will come back flagged. That is the
              point — turn it on to see what a rep ordering from home looks like.
            </span>
          </span>
        </label>

        <div className="rounded border border-line bg-panel p-3 text-xs text-muted leading-relaxed">
          <strong className="text-foreground font-medium">How location works here.</strong>{' '}
          The phone publishes its own position to the server. The agent has no tool that
          accepts a coordinate, so nothing typed into this chat can produce or change one.
          On WhatsApp this is the location attachment.
        </div>
      </section>

      <section className="space-y-3">
        <div className="mx-auto w-full max-w-[26rem]">
          <div className="rounded-[2rem] border-[10px] border-neutral-800 bg-neutral-800 shadow-xl">
            <div className="rounded-[1.4rem] overflow-hidden bg-white">
              <div className="bg-[#075E54] text-white px-4 py-2.5 flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-white/20 grid place-items-center text-sm">M</div>
                <div className="leading-tight">
                  <div className="text-sm font-medium">Meridian</div>
                  <div className="text-[11px] text-white/70">order book</div>
                </div>
              </div>
              <div id="counter-chat" style={{ height: '30rem' }} />
            </div>
          </div>
        </div>
        <p className="text-center text-xs text-muted">
          Same agent as the manager widget. One agent, two doors.
        </p>
      </section>
    </div>
  );
}
