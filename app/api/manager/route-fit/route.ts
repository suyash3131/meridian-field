import { NextResponse } from 'next/server';
import { one, sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Which existing routes a counter fits best: every rep's weekday route in the
 * counter's region, ranked by how far the counter is from that route's nearest
 * stop. So "put it on a route?" comes with real choices ("Ramesh · Monday,
 * 0.8 km from a stop") instead of "which rep, which day?". Pass repId to rank
 * only that rep's days. A suggestion only: the manager picks.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const outletId = u.searchParams.get('outletId') ?? '';
  const repId = u.searchParams.get('repId');
  const o = await one<{ id: string; region: string; lat: number; lng: number }>(
    `SELECT id, region, lat, lng FROM outlets WHERE id = $1`, [outletId]);
  if (!o) return NextResponse.json({ error: 'no such counter' }, { status: 404 });

  const rows = await sql<{ rep_id: string; rep: string; weekday: number; lat: number | null; lng: number | null; outlet_id: string | null }>(
    `SELECT r.id AS rep_id, r.name AS rep, b.weekday, ou.lat, ou.lng, ou.id AS outlet_id
       FROM reps r JOIN beats b ON b.rep_id = r.id
       LEFT JOIN beat_outlets bo ON bo.beat_id = b.id
       LEFT JOIN outlets ou ON ou.id = bo.outlet_id
      WHERE r.region = $1 AND ($2::text IS NULL OR r.id = $2)`, [o.region, repId]);

  const fits = new Map<string, { repId: string; rep: string; weekday: number; day: string; km: number | null; stops: number; already: boolean }>();
  for (const r of rows) {
    const k = `${r.rep_id}-${r.weekday}`;
    const f = fits.get(k) ?? { repId: r.rep_id, rep: r.rep, weekday: r.weekday, day: DAYS[r.weekday], km: null, stops: 0, already: false };
    fits.set(k, f);
    if (!r.outlet_id) continue;
    f.stops++;
    if (r.outlet_id === o.id) { f.already = true; continue; }
    const km = distKm(o.lat, o.lng, Number(r.lat), Number(r.lng));
    f.km = f.km == null ? km : Math.min(f.km, km);
  }
  const ranked = [...fits.values()].filter((f) => !f.already)
    .sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9) || a.stops - b.stops)
    .map((f) => ({ ...f, km: f.km == null ? null : Math.round(f.km * 10) / 10 }));
  const on = [...fits.values()].filter((f) => f.already).map((f) => ({ rep: f.rep, day: f.day }));
  return NextResponse.json({ fits: ranked.slice(0, 6), alreadyOn: on });
}

function distKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371, r = (d: number) => (d * Math.PI) / 180;
  const x = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
