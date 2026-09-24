import { NextResponse } from 'next/server';
import { one, sql, businessWeekday } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * A rep's route for a day, as a Google Maps link that opens turn-by-turn
 * directions through every stop in order. Nothing to install and no API key:
 * it is a plain Maps URL, which WhatsApp shows as a tappable link. Maps takes
 * up to 9 stops between start and end, so a longer route becomes two links.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const repId = u.searchParams.get('repId') ?? '';
  const weekday = Number(u.searchParams.get('weekday')) || businessWeekday();
  const rep = await one<{ name: string }>(`SELECT name FROM reps WHERE id = $1`, [repId]);
  if (!rep) return NextResponse.json({ error: 'no such rep' }, { status: 404 });
  const stops = await sql<{ id: string; name: string; area: string; lat: number; lng: number }>(
    `SELECT ou.id, ou.name, ou.area, ou.lat, ou.lng
       FROM beats b JOIN beat_outlets bo ON bo.beat_id = b.id JOIN outlets ou ON ou.id = bo.outlet_id
      WHERE b.rep_id = $1 AND b.weekday = $2 ORDER BY bo.seq`, [repId, weekday]);

  const links: string[] = [];
  for (let i = 0; i < stops.length; i += 10) {
    const leg = stops.slice(Math.max(0, i - (i ? 1 : 0)), i + 10);
    if (leg.length < 1) break;
    const p = (s: { lat: number; lng: number }) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
    const dest = leg[leg.length - 1];
    const mid = leg.slice(0, -1);
    links.push(`https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${p(dest)}` +
      (mid.length ? `&waypoints=${encodeURIComponent(mid.map(p).join('|'))}` : ''));
  }
  return NextResponse.json({
    rep: rep.name, day: DAYS[weekday], weekday,
    stops: stops.map((s, i) => ({ n: i + 1, id: s.id, name: s.name, area: s.area })),
    links,
  });
}
