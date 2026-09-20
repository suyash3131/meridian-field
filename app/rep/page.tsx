'use client';

import { useEffect, useRef, useState } from 'react';

const AGENT_ID = 'baseAgent_agent_1789922892145_ie20jx4g5';

type Counter = { id: string; name: string; area: string; lat: number; lng: number; on_beat: boolean };
type Rep = { id: string; name: string; region: string; asm: string; counters: Counter[] };

declare global {
  interface Window { LuaPop?: { init: (c: Record<string, unknown>) => Promise<unknown>; destroy?: () => void } }
}

function browserKey(): string {
  try {
    const k = localStorage.getItem('meridian_demo_key');
    if (k) return k;
    const v = Math.random().toString(36).slice(2, 10);
    localStorage.setItem('meridian_demo_key', v);
    return v;
  } catch { return 'nostore'; }
}

/** Controls sit quietly to the side. The phone is the page. */
function Field({ label, children, note }:
  { label: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-2">{children}</div>
      {note && <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-faint">{note}</p>}
    </label>
  );
}

const selectCls =
  "w-full appearance-none bg-transparent border-0 border-b border-rule-firm " +
  "py-1.5 pr-6 text-[0.875rem] text-ink " +
  "focus:border-ink disabled:opacity-40 " +
  "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%226%22><path d=%22M1 1l4 4 4-4%22 fill=%22none%22 stroke=%22%238a8375%22 stroke-width=%221.3%22/></svg>')] " +
  "bg-[right_0.15rem_center] bg-no-repeat";

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
      const first = d.reps.find((r: Rep) => r.id === 'R-07') ?? d.reps[0];
      if (first) {
        setRepId(first.id);
        setStandingAt(first.counters.find((c: Counter) => c.on_beat)?.id ?? first.counters[0]?.id ?? '');
      }
    });
  }, []);

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
        (p) => publish(p.coords.latitude, p.coords.longitude,
          'your actual location — expect every visit to come back flagged'),
        () => setPosNote('the browser refused to share a location'),
        { enableHighAccuracy: true, timeout: 8000 }
      );
      return;
    }
    const c = rep.counters.find((x) => x.id === standingAt);
    if (!c) return;
    publish(c.lat + (Math.random() - 0.5) * 0.0004, c.lng + (Math.random() - 0.5) * 0.0004,
      `outside ${c.name}, ${c.area}`);
  }, [repId, standingAt, useRealGps, rep?.id]);

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
    <div className="mx-auto max-w-[68rem] px-5 sm:px-8 py-10 lg:py-12">
      <div className="grid gap-x-14 gap-y-10 lg:grid-cols-[19rem_1fr]">

        {/* ------------------------------------------------- the framing */}
        <div>
          <div className="rule-label mb-7">
            <span className="label">At the counter</span>
          </div>

          <p className="text-[0.9375rem] leading-relaxed measure">
            This is the whole product for a rep. No app, no forms, no login —
            one chat, the way he already messages his manager.
          </p>

          <div className="mt-9 space-y-7">
            <Field label="You are">
              <select
                value={repId}
                onChange={(e) => {
                  const r = reps.find((x) => x.id === e.target.value);
                  setRepId(e.target.value);
                  setStandingAt(r?.counters.find((c) => c.on_beat)?.id ?? r?.counters[0]?.id ?? '');
                }}
                className={selectCls}
              >
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>{r.name} · {r.id} · {r.region}</option>
                ))}
              </select>
            </Field>

            <Field
              label="Standing outside"
              note={
                <>
                  <span className="fig">{posNote}</span>
                  {noRoute && (
                    <span className="block mt-1">
                      {weekday} — no beat runs today, so nothing counts as off-route.
                    </span>
                  )}
                </>
              }
            >
              <select
                value={standingAt}
                disabled={useRealGps}
                onChange={(e) => setStandingAt(e.target.value)}
                className={selectCls}
              >
                {rep?.counters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.on_beat ? '' : '  · off today’s route'}
                  </option>
                ))}
              </select>
            </Field>

            <label className="flex gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={useRealGps}
                onChange={(e) => setUseRealGps(e.target.checked)}
                className="mt-[0.2rem] h-3.5 w-3.5 shrink-0 accent-[#17150f]"
              />
              <span>
                <span className="text-[0.875rem]">Use my real location</span>
                <span className="mt-1 block text-[0.75rem] leading-relaxed text-ink-faint">
                  You are not in Karol Bagh, so every visit will come back flagged.
                  That is the point — this is what a rep ordering from home looks like.
                </span>
              </span>
            </label>
          </div>

          <div className="mt-9 border-t border-rule pt-5">
            <p className="label mb-2">How location works</p>
            <p className="text-[0.8125rem] leading-relaxed text-ink-soft">
              The phone publishes its own position to the server. The agent has no tool that
              accepts a coordinate, so nothing typed into this chat can produce or change one.
              On WhatsApp this is the location attachment.
            </p>
          </div>
        </div>

        {/* ---------------------------------------------------- the phone */}
        <div className="justify-self-center w-full max-w-[23rem]">
          <div className="rounded-[2.25rem] bg-[#1c1b18] p-2.5 shadow-[0_24px_60px_-20px_rgba(23,21,15,0.45)]">
            <div className="relative rounded-[1.6rem] overflow-hidden bg-white">
              <div className="absolute inset-x-0 top-0 z-10 h-6 flex justify-center">
                <span className="mt-1.5 h-1 w-16 rounded-full bg-black/25" />
              </div>
              <div className="bg-[#0f5c4e] px-4 pt-7 pb-3 flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-white/15 grid place-items-center
                                text-[0.8125rem] text-white font-medium">M</div>
                <div className="leading-tight">
                  <p className="text-[0.875rem] text-white font-medium">Meridian</p>
                  <p className="text-[0.6875rem] text-white/60">order book</p>
                </div>
              </div>
              <div id="counter-chat" style={{ height: '31rem' }} />
            </div>
          </div>
          <p className="label mt-4 text-center">
            Same agent as the manager widget · one agent, two doors
          </p>
        </div>
      </div>
    </div>
  );
}
