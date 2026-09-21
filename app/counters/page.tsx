'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { PageHeader, Segmented, rs } from '../ui';

const RouteMap = dynamic(() => import('../route-map'), { ssr: false });

type Outlet = {
  id: string; name: string; area: string; region: string; lat: number; lng: number;
  credit_limit_paise: string; is_new: boolean;
};
type Rep = { id: string; name: string; region: string };
type Mode = 'plan' | 'add';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, i) => ({ key: String(i + 1), label }));
const TARGET = 20;

function todayWeekday() {
  const d = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(new Date());
  const n = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(d) + 1;
  return String(n === 7 ? 1 : n);
}

const input = 'w-full h-10 rounded-[9px] border border-line-strong bg-surface px-3 text-[0.875rem] ' +
              'placeholder:text-ink-4';

export default function Counters() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [mode, setMode] = useState<Mode>('plan');

  const [repId, setRepId] = useState('R-07');
  const [weekday, setWeekday] = useState(todayWeekday);
  const [route, setRoute] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({ name: '', area: '', region: 'North', limit: '25000' });
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);

  const rep = reps.find((r) => r.id === repId);
  const region = mode === 'add' ? form.region : rep?.region ?? 'North';
  const here = useMemo(() => outlets.filter((o) => o.region === region), [outlets, region]);
  const dirty = route.join() !== saved.join();

  const loadOutlets = useCallback(() =>
    fetch('/api/manager/outlets').then((r) => r.json()).then((d) => setOutlets(d.outlets)), []);

  useEffect(() => {
    loadOutlets();
    fetch('/api/reps').then((r) => r.json()).then((d) =>
      setReps(d.reps.map((r: Rep) => ({ id: r.id, name: r.name, region: r.region }))));
  }, [loadOutlets]);

  useEffect(() => {
    setMsg(null);
    fetch(`/api/manager/routes?repId=${repId}&weekday=${weekday}`).then((r) => r.json())
      .then((d) => { setRoute(d.stops); setSaved(d.stops); });
  }, [repId, weekday]);

  const toggle = (id: string) =>
    setRoute((r) => r.includes(id) ? r.filter((x) => x !== id) : r.length >= 25 ? r : [...r, id]);

  async function saveRoute() {
    setBusy(true);
    const r = await fetch('/api/manager/routes', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repId, weekday: Number(weekday), outletIds: route }),
    }).then((x) => x.json());
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: r.error });
    setSaved(route);
    setMsg({ ok: true, text: `Saved. ${rep?.name.split(' ')[0]} sees it on his phone next ${DAYS[Number(weekday) - 1].label}.` });
  }

  async function addCounter() {
    setBusy(true);
    const r = await fetch('/api/manager/outlets', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, creditLimitRupees: Number(form.limit), lat: pin?.lat, lng: pin?.lng }),
    }).then((x) => x.json());
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: r.error });
    await loadOutlets();
    setMsg({ ok: true, text: `${form.name} added. Reps can order from it now, and you can put it on a route.` });
    setForm({ name: '', area: '', region: form.region, limit: '25000' });
    setPin(null);
  }

  const points = here.map((o) => {
    const at = route.indexOf(o.id);
    return {
      id: o.id, lat: o.lat, lng: o.lng, title: o.name,
      label: mode === 'plan' && at >= 0 ? String(at + 1) : '',
      tone: (mode === 'plan' && at >= 0 ? 'picked' : 'muted') as 'picked' | 'muted',
    };
  });

  return (
    <>
      <PageHeader title="Counters & routes" sub={`${outlets.length} counters on file`}>
        <Segmented value={mode} onChange={(m) => { setMode(m); setMsg(null); }}
                   options={[{ key: 'plan', label: 'Plan a route' }, { key: 'add', label: 'Add a counter' }]} />
      </PageHeader>

      <div className="px-5 sm:px-8 py-7 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] max-w-[76rem]">
        <div className="card overflow-hidden relative">
          <RouteMap
            className="h-[420px] lg:h-[600px]"
            fitKey={region}
            points={points}
            pin={mode === 'add' ? pin : null}
            onPick={mode === 'plan' ? toggle : undefined}
            onMapClick={mode === 'add' ? (lat, lng) => setPin({ lat, lng }) : undefined}
          />
          <p className="absolute left-3 top-3 z-[500] rounded-lg bg-surface/95 px-3 py-2 text-[0.75rem] text-ink-2
                        shadow-[0_0_0_1px_var(--color-line)]">
            {mode === 'plan' ? 'Tap a counter to add it to the route, in the order you tap.'
                             : pin ? 'Pin dropped. Tap again to move it.' : 'Tap the map where the counter is.'}
          </p>
        </div>

        <aside className="card p-5 flex flex-col gap-4 self-start">
          {mode === 'plan' ? (
            <>
              <label className="block">
                <span className="label">Rep</span>
                <select value={repId} onChange={(e) => setRepId(e.target.value)} className={`${input} mt-1.5`}>
                  {reps.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.region}</option>)}
                </select>
              </label>
              <div>
                <span className="label">Day</span>
                <div className="mt-1.5"><Segmented value={weekday} options={DAYS} onChange={setWeekday} /></div>
              </div>

              <div>
                <div className="flex items-baseline justify-between">
                  <span className="label">Route</span>
                  <span className={`fig text-[0.8125rem] font-medium ${route.length >= TARGET ? 'text-accent' : 'text-ink-2'}`}>
                    {route.length} / {TARGET}
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-track overflow-hidden">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (route.length / TARGET) * 100)}%` }} />
                </div>
              </div>

              <ul className="max-h-[300px] overflow-y-auto -mx-2">
                {here.map((o) => {
                  const at = route.indexOf(o.id);
                  return (
                    <li key={o.id}>
                      <label className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sunk cursor-pointer">
                        <input type="checkbox" checked={at >= 0} onChange={() => toggle(o.id)}
                               className="h-4 w-4 accent-[#0f766e]" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[0.8125rem] font-medium truncate">
                            {o.name}{o.is_new && <span className="pill ml-1.5 bg-accent-soft text-accent">New</span>}
                          </span>
                          <span className="block text-[0.75rem] text-ink-3">{o.area}</span>
                        </span>
                        {at >= 0 && <span className="fig text-[0.75rem] text-ink-3">{at + 1}</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>

              <button onClick={saveRoute} disabled={!dirty || busy}
                      className="h-10 rounded-[9px] bg-ink text-white text-[0.875rem] font-medium disabled:opacity-40">
                {busy ? 'Saving…' : dirty ? 'Save route' : 'Saved'}
              </button>
            </>
          ) : (
            <>
              <label className="block">
                <span className="label">Counter name</span>
                <input className={`${input} mt-1.5`} placeholder="e.g. City Chemist" value={form.name}
                       onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="block">
                <span className="label">Area</span>
                <input className={`${input} mt-1.5`} placeholder="e.g. Karol Bagh" value={form.area}
                       onChange={(e) => setForm({ ...form, area: e.target.value })} />
              </label>
              <div>
                <span className="label">Region</span>
                <div className="mt-1.5">
                  <Segmented value={form.region} onChange={(r) => { setForm({ ...form, region: r }); setPin(null); }}
                             options={[{ key: 'North', label: 'North' }, { key: 'South', label: 'South' }]} />
                </div>
              </div>
              <label className="block">
                <span className="label">Credit limit (₹)</span>
                <input className={`${input} mt-1.5 fig`} inputMode="numeric" value={form.limit}
                       onChange={(e) => setForm({ ...form, limit: e.target.value.replace(/[^\d]/g, '') })} />
                {form.limit && <span className="mt-1 block text-[0.75rem] text-ink-3 fig">{rs(Number(form.limit) * 100)}</span>}
              </label>
              <p className="text-[0.75rem] text-ink-3">
                {pin ? <>Location: <span className="fig">{pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}</span></>
                     : 'Tap the map to place it.'}
              </p>
              <button onClick={addCounter} disabled={busy || !form.name || !form.area || !pin}
                      className="h-10 rounded-[9px] bg-ink text-white text-[0.875rem] font-medium disabled:opacity-40">
                {busy ? 'Adding…' : 'Add counter'}
              </button>
            </>
          )}

          {msg && (
            <p role="status" className={`text-[0.8125rem] rounded-lg px-3 py-2 ${
              msg.ok ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'}`}>{msg.text}</p>
          )}
        </aside>
      </div>
    </>
  );
}
