'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../ui';
import TodayTab, { type Day } from './today';
import AttendanceTab, { type AttDay } from './attendance';
import { T, type Lang } from './i18n';

const AGENT_ID = 'baseAgent_agent_1789922892145_ie20jx4g5';

/** Set this to a real number to make "Call" dial it. Unset, the demo explains
 *  instead of ringing a stranger. */
const ASM_PHONE = process.env.NEXT_PUBLIC_ASM_PHONE ?? '';

type Counter = { id: string; name: string; area: string; lat: number; lng: number; on_beat: boolean };
type Rep = { id: string; name: string; region: string; asm: string; counters: Counter[] };
type Tab = 'today' | 'chat' | 'attendance';

function store(key: string, value?: string): string | null {
  try {
    if (value !== undefined) { localStorage.setItem(key, value); return value; }
    return localStorage.getItem(key);
  } catch { return null; }
}

function browserKey(): string {
  const k = store('meridian_demo_key');
  if (k) return k;
  return store('meridian_demo_key', Math.random().toString(36).slice(2, 10)) ?? 'nostore';
}

const ist = (o: Intl.DateTimeFormatOptions, locale = 'en-IN') =>
  new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Kolkata', ...o }).format(new Date());

const ICON: Record<Tab, React.ReactNode> = {
  today: <><path d="M9 20l-5-2V4l5 2 6-2 5 2v14l-5-2-6 2z" /><path d="M9 6v14M15 4v14" /></>,
  chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" />,
  attendance: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4" /></>,
};

/** The demo's controls: who you are and where you are standing. */
function Control({ label, children, note }: { label: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1.5">{children}</div>
      {note && <p className="mt-1.5 text-[0.75rem] leading-relaxed text-ink-3">{note}</p>}
    </label>
  );
}
const selectCls =
  'w-full h-10 rounded-[9px] border border-line-strong bg-surface px-3 text-[0.875rem] text-ink ' +
  'disabled:opacity-50';

export default function RepView() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [weekday, setWeekday] = useState('');
  const [repId, setRepId] = useState('R-07');
  const [standingAt, setStandingAt] = useState('');
  const [useRealGps, setUseRealGps] = useState(false);
  const [posNote, setPosNote] = useState('no location published yet');

  const [tab, setTab] = useState<Tab>('today');
  const [lang, setLang] = useState<Lang>('en');
  const [day, setDay] = useState<Day | null>(null);
  const [att, setAtt] = useState<AttDay[] | null>(null);
  const [calling, setCalling] = useState(false);
  const mounted = useRef(false);

  const rep = reps.find((r) => r.id === repId);
  const t = T[lang];

  useEffect(() => { const l = store('meridian_lang'); if (l === 'hi' || l === 'en') setLang(l); }, []);
  const pickLang = (l: Lang) => { setLang(l); store('meridian_lang', l); };

  useEffect(() => {
    fetch('/api/reps').then((r) => r.json()).then((d) => {
      setReps(d.reps); setWeekday(d.weekday);
      const first = d.reps.find((r: Rep) => r.id === 'R-07') ?? d.reps[0];
      if (first) {
        setRepId(first.id);
        setStandingAt(first.counters.find((c: Counter) => c.on_beat)?.id ?? first.counters[0]?.id ?? '');
      }
    });
  }, []);

  // The day and the month, refreshed whenever the rep looks at them. An order
  // placed in the chat ticks its stop off here, because both read the ledger.
  const refresh = useCallback(() => {
    fetch(`/api/rep/today?repId=${repId}`).then((r) => r.json()).then(setDay).catch(() => {});
    fetch(`/api/rep/attendance?repId=${repId}`).then((r) => r.json()).then((d) => setAtt(d.days)).catch(() => {});
  }, [repId]);
  useEffect(() => { setDay(null); setAtt(null); refresh(); }, [refresh]);
  useEffect(() => { if (tab !== 'chat') refresh(); }, [tab, refresh]);
  useEffect(() => {
    if (tab !== 'today') return;
    const i = setInterval(refresh, 20_000);
    return () => clearInterval(i);
  }, [tab, refresh]);

  async function publish(lat: number, lng: number, note: string) {
    await fetch('/api/agent/position', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repId, lat, lng, accuracyM: 25 }),
    });
    setPosNote(note);
    refresh();
  }

  useEffect(() => {
    if (!rep) return;
    if (useRealGps) {
      navigator.geolocation?.getCurrentPosition(
        (p) => publish(p.coords.latitude, p.coords.longitude,
          'your actual location, so expect every visit to come back flagged'),
        () => setPosNote('the browser refused to share a location'),
        { enableHighAccuracy: true, timeout: 8000 }
      );
      return;
    }
    const c = rep.counters.find((x) => x.id === standingAt);
    if (!c) return;
    publish(c.lat + (Math.random() - 0.5) * 0.0004, c.lng + (Math.random() - 0.5) * 0.0004,
      `outside ${c.name}, ${c.area}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rep?.id, weekday]);

  const hour = Number(ist({ hour: 'numeric', hour12: false }));
  const firstName = rep?.name.split(' ')[0] ?? '';
  const greeting = t.greeting(hour, firstName);

  return (
    <>
      <PageHeader title="At the counter" sub="What a rep sees on his phone" companion={false} />

      <div className="px-5 sm:px-8 py-6 grid gap-8 lg:grid-cols-[18rem_1fr] max-w-[64rem]">

        {/* ------------------------------------------------ the demo controls */}
        <div className="flex flex-col gap-5">
          <p className="text-[0.9375rem] leading-relaxed text-ink-2">
            The rep’s whole product. His day on a map, one chat to order in, and attendance
            he never has to mark.
          </p>

          <div className="card p-4 flex flex-col gap-4">
            <Control label="You are">
              <select value={repId} className={selectCls}
                      onChange={(e) => {
                        const r = reps.find((x) => x.id === e.target.value);
                        setRepId(e.target.value);
                        setStandingAt(r?.counters.find((c) => c.on_beat)?.id ?? r?.counters[0]?.id ?? '');
                      }}>
                {reps.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.region}</option>)}
              </select>
            </Control>
            <Control label="Standing outside" note={posNote}>
              <select value={standingAt} disabled={useRealGps} className={selectCls}
                      onChange={(e) => setStandingAt(e.target.value)}>
                {rep?.counters.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.on_beat ? '' : ' · off today’s route'}</option>
                ))}
              </select>
            </Control>
            <label className="flex gap-2.5 cursor-pointer">
              <input type="checkbox" checked={useRealGps} onChange={(e) => setUseRealGps(e.target.checked)}
                     className="mt-[0.2rem] h-4 w-4 shrink-0 accent-[#0f766e]" />
              <span className="text-[0.8125rem] text-ink-2 leading-relaxed">
                Use my real location. Every visit will come back flagged, which is what a rep
                ordering from home looks like.
              </span>
            </label>
          </div>

          <p className="text-[0.75rem] leading-relaxed text-ink-3">
            The phone sends its own position to the server. The agent has no tool that accepts a
            location, so nothing typed in the chat can fake one.
          </p>
        </div>

        {/* ------------------------------------------------------ the phone */}
        <div className="justify-self-center w-full max-w-[23rem]">
          <div className="rounded-[2.5rem] bg-[#1c1b1a] p-2.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)]">
            <div className="relative rounded-[2rem] overflow-hidden bg-bg flex flex-col"
                 style={{ height: 'clamp(34rem, calc(100vh - 8rem), 44rem)' }}>

              {/* app bar */}
              <header className="shrink-0 bg-surface border-b border-line px-4 pt-7 pb-3 flex items-center gap-3">
                <span className="h-9 w-9 rounded-full bg-accent text-white grid place-items-center text-[0.8125rem] font-semibold">
                  {firstName.slice(0, 1)}
                </span>
                <div className="flex-1 min-w-0 leading-tight">
                  <p className="text-[0.875rem] font-semibold truncate">{rep?.name ?? ' '}</p>
                  <p className="text-[0.75rem] text-ink-3">
                    {ist({ weekday: 'short', day: 'numeric', month: 'short' }, t.locale)}
                  </p>
                </div>
                <div className="flex p-0.5 rounded-full bg-track" role="group" aria-label="Language">
                  {(['en', 'hi'] as Lang[]).map((l) => (
                    <button key={l} onClick={() => pickLang(l)} aria-pressed={lang === l}
                            className={`h-7 px-2.5 rounded-full text-[0.75rem] font-medium ${
                              lang === l ? 'bg-surface text-ink shadow-sm' : 'text-ink-3'}`}>
                      {l === 'en' ? 'EN' : 'हिं'}
                    </button>
                  ))}
                </div>
                <button onClick={() => setCalling(true)} aria-label={`${t.call} ${day?.manager.name ?? ''}`}
                        className="h-9 w-9 rounded-full bg-accent text-white grid place-items-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                       strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
                  </svg>
                </button>
              </header>

              {/* the three tabs share one frame; chat stays mounted so the
                  conversation survives a look at the map */}
              <div className="relative flex-1 min-h-0">
                <div className={`absolute inset-0 overflow-y-auto ${tab === 'today' ? '' : 'invisible'}`}>
                  <TodayTab day={day} lang={lang} greeting={greeting} />
                </div>
                <div className={`absolute inset-0 bg-white ${tab === 'chat' ? '' : 'invisible'}`}>
                  <div id="counter-chat" className="h-full" />
                </div>
                <div className={`absolute inset-0 overflow-y-auto ${tab === 'attendance' ? '' : 'invisible'}`}>
                  <AttendanceTab days={att} lang={lang} />
                </div>
              </div>

              {/* tab bar */}
              <nav className="shrink-0 bg-surface border-t border-line grid grid-cols-3 pb-3 pt-1.5" aria-label="Rep app">
                {(['today', 'chat', 'attendance'] as Tab[]).map((k) => (
                  <button key={k} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}
                          className={`flex flex-col items-center gap-0.5 py-1.5 text-[0.6875rem] font-medium ${
                            tab === k ? 'text-accent' : 'text-ink-3'}`}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         strokeWidth={tab === k ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      {ICON[k]}
                    </svg>
                    {t[k]}
                  </button>
                ))}
              </nav>

              {/* call sheet */}
              {calling && (
                <div className="absolute inset-0 z-20 flex items-end bg-black/30" onClick={() => setCalling(false)}>
                  <div className="w-full rounded-t-3xl bg-surface p-5 pb-6" onClick={(e) => e.stopPropagation()}
                       role="dialog" aria-label={t.callTitle}>
                    <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong" />
                    <p className="label">{t.callTitle}</p>
                    <p className="mt-1 text-[1.125rem] font-semibold">{day?.manager.name}</p>
                    {!ASM_PHONE && <p className="mt-2 text-[0.8125rem] text-ink-3">{t.callDemo}</p>}
                    <div className="mt-5 grid grid-cols-2 gap-2.5">
                      <button onClick={() => setCalling(false)}
                              className="h-12 rounded-xl border border-line-strong text-[0.875rem] font-medium">
                        {t.cancel}
                      </button>
                      {ASM_PHONE ? (
                        <a href={`tel:${ASM_PHONE}`}
                           className="h-12 rounded-xl bg-accent text-white grid place-items-center text-[0.875rem] font-medium">
                          {t.callNow}
                        </a>
                      ) : (
                        <button disabled
                                className="h-12 rounded-xl bg-accent/40 text-white text-[0.875rem] font-medium">
                          {t.callNow}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
