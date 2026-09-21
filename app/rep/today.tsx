'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Lang } from './i18n';
import { T } from './i18n';

const RouteMap = dynamic(() => import('../route-map'), { ssr: false });

export type Stop = {
  id: string; name: string; area: string; lat: number; lng: number; seq: number;
  task: 'collect' | 'order' | 'check'; overduePaise: number; daysSinceOrder: number | null;
  done: boolean; outcome: string | null;
};
export type Day = {
  rep: { id: string; name: string; region: string };
  manager: { name: string; role: string };
  showingTomorrow: boolean;
  position: { lat: number; lng: number } | null;
  stops: Stop[];
};

const TASK_CLS = {
  collect: 'bg-danger-soft text-danger',
  order: 'bg-accent-soft text-accent',
  check: 'bg-track text-ink-2',
};

/** The brief, as sentences. Built from the day's data in whichever language
 *  the rep chose; the same lines are what "Listen" reads aloud. */
export function briefLines(d: Day, lang: Lang): string[] {
  const t = T[lang];
  const todo = d.stops.filter((s) => !s.done);
  if (!d.stops.length) return [t.noStops];
  if (!todo.length) return [t.allDone];

  const lines = [t.stopsLine(d.stops.length, d.stops.length - todo.length)];
  const collect = todo.filter((s) => s.task === 'collect').sort((a, b) => b.overduePaise - a.overduePaise);
  if (collect.length)
    lines.push(t.collectLine(collect.reduce((n, s) => n + s.overduePaise, 0), collect.length, collect[0].name));
  const quiet = todo.filter((s) => s.task === 'order')
    .sort((a, b) => (b.daysSinceOrder ?? 999) - (a.daysSinceOrder ?? 999))[0];
  if (quiet) lines.push(t.quietLine(quiet.name, quiet.daysSinceOrder));
  return lines;
}

export default function TodayTab({ day, lang, greeting, onOpen }:
  { day: Day | null; lang: Lang; greeting: string; onOpen: (s: Stop) => void }) {
  const t = T[lang];
  const [picked, setPicked] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);
  useEffect(() => { window.speechSynthesis?.cancel(); setSpeaking(false); }, [lang]);

  if (!day) return <div className="p-4 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-2xl bg-track animate-pulse" />)}</div>;

  const lines = briefLines(day, lang);
  const done = day.stops.filter((s) => s.done).length;

  function listen() {
    const s = window.speechSynthesis;
    if (!s) return;
    if (speaking) { s.cancel(); setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance([greeting, ...lines].join(' '));
    u.lang = t.speech;
    const voice = s.getVoices().find((v) => v.lang === t.speech) ??
                  s.getVoices().find((v) => v.lang.startsWith(lang));
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.onend = () => setSpeaking(false);
    s.cancel(); s.speak(u); setSpeaking(true);
  }

  return (
    <div className="p-3.5 flex flex-col gap-3">
      {/* ------------------------------------------------ the brief */}
      <section className="rounded-2xl bg-ink text-white p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[0.9375rem] font-semibold">{greeting}</p>
            {day.showingTomorrow && <p className="mt-1 text-[0.75rem] text-white/60">{t.tomorrow}</p>}
          </div>
          <button onClick={listen}
                  className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-white/12 hover:bg-white/20
                             text-[0.75rem] font-medium">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {speaking ? <path d="M6 6h12v12H6z" />
                        : <><path d="M11 5L6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>}
            </svg>
            {speaking ? t.stop : t.listen}
          </button>
        </div>
        <ul className="mt-3 space-y-1.5">
          {lines.map((l) => (
            <li key={l} className="flex gap-2 text-[0.8125rem] leading-snug text-white/85">
              <span className="mt-[0.45rem] h-1 w-1 rounded-full bg-white/50 shrink-0" />{l}
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------------------------------------------- the map */}
      {day.stops.length > 0 && (
        <RouteMap
          className="h-[180px] rounded-2xl overflow-hidden border border-line"
          fitKey={day.rep.id}
          zoomButtons={false}
          me={day.position}
          onPick={setPicked}
          points={day.stops.map((s) => ({
            id: s.id, lat: s.lat, lng: s.lng, title: s.name,
            label: s.done ? '✓' : String(s.seq),
            tone: s.id === picked ? 'picked' : s.done ? 'done' : 'todo',
          }))}
        />
      )}

      {/* ------------------------------------------------ the stops */}
      {day.stops.length > 0 && (
        <section className="rounded-2xl bg-surface border border-line overflow-hidden">
          <div className="px-4 pt-3.5 pb-3">
            <div className="flex justify-between text-[0.75rem]">
              <span className="font-medium">{t.progress(done, day.stops.length)}</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-track overflow-hidden">
              <div className="h-full rounded-full bg-accent transition-[width]"
                   style={{ width: `${(done / day.stops.length) * 100}%` }} />
            </div>
          </div>
          <ul className="rows border-t border-track">
            {day.stops.map((s) => (
              <li key={s.id}>
                <div className={`flex items-center gap-3 px-4 py-3 ${s.id === picked ? 'bg-accent-soft/60' : ''}`}>
                  <button onClick={() => setPicked(s.id)} aria-label={s.name}
                          className={`h-8 w-8 shrink-0 rounded-full grid place-items-center text-[0.75rem] font-semibold ${
                            s.done ? 'bg-accent-soft text-accent' : 'bg-ink text-white'}`}>
                    {s.done ? '✓' : s.seq}
                  </button>
                  <button onClick={() => onOpen(s)} className="flex-1 min-w-0 text-left">
                    <p className={`text-[0.875rem] font-medium truncate ${s.done ? 'text-ink-3' : ''}`}>{s.name}</p>
                    <p className="mt-0.5 flex items-center gap-1.5">
                      {s.done
                        ? <span className="pill bg-accent-soft text-accent">{s.outcome === 'order' ? t.done : t.visited}</span>
                        : <span className={`pill ${TASK_CLS[s.task]}`}>{t.task[s.task](s.overduePaise)}</span>}
                      <span className="text-[0.75rem] text-ink-3 truncate">{s.area}</span>
                    </p>
                  </button>
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`}
                     target="_blank" rel="noreferrer" aria-label={`${t.directions}: ${s.name}`}
                     className="h-10 w-10 shrink-0 grid place-items-center rounded-full text-ink-2 hover:bg-track">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
                         strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 11l18-8-8 18-2-8-8-2z" /></svg>
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
