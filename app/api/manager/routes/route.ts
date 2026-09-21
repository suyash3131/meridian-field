import { NextResponse } from 'next/server';
import { sql, one, tx } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Twenty a day is the plan; a little headroom for a busy market. */
const MAX_STOPS = 25;

const WEEKDAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** One rep's route for one weekday, in order. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const repId = u.searchParams.get('repId') ?? '';
  const weekday = Number(u.searchParams.get('weekday'));
  const stops = await sql<{ outlet_id: string; seq: number }>(
    `SELECT bo.outlet_id, bo.seq FROM beats b JOIN beat_outlets bo ON bo.beat_id = b.id
      WHERE b.rep_id = $1 AND b.weekday = $2 ORDER BY bo.seq`, [repId, weekday]);
  return NextResponse.json({ stops: stops.map((s) => s.outlet_id) });
}

/** Replace a rep's route for one weekday. The order given is the order walked. */
export async function PUT(req: Request) {
  const b = await req.json().catch(() => ({}));
  const repId = String(b.repId ?? '');
  const weekday = Number(b.weekday);
  const ids: string[] = Array.isArray(b.outletIds) ? [...new Set(b.outletIds.map(String))] as string[] : [];

  if (!(weekday >= 1 && weekday <= 6)) return bad('Routes run Monday to Saturday.');
  if (ids.length > MAX_STOPS) return bad(`At most ${MAX_STOPS} counters in a day.`);

  const rep = await one<{ id: string; name: string; region: string }>(
    `SELECT id, name, region FROM reps WHERE id = $1`, [repId]);
  if (!rep) return bad('No such rep.');

  // A rep walks his own territory. A counter from the other region on his
  // route would be a planning mistake, so it is refused rather than stored.
  if (ids.length) {
    const ok = await sql<{ id: string }>(
      `SELECT id FROM outlets WHERE id = ANY($1) AND region = $2 AND status = 'active'`, [ids, rep.region]);
    if (ok.length !== ids.length) return bad(`Every counter must be an active ${rep.region} counter.`);
  }

  let beat = await one<{ id: string }>(`SELECT id FROM beats WHERE rep_id = $1 AND weekday = $2`, [repId, weekday]);
  if (!beat) {
    const id = `BEAT-${repId}-${weekday}`;
    await sql(`INSERT INTO beats (id, rep_id, weekday, name) VALUES ($1, $2, $3, $4)`,
      [id, repId, weekday, `${rep.name.split(' ')[0]} — ${WEEKDAY_NAMES[weekday]}`]);
    beat = { id };
  }

  // Replace in one go: a route half-deleted is a rep with no plan tomorrow.
  const beatId = beat.id;
  await tx(async (q) => {
    await q(`DELETE FROM beat_outlets WHERE beat_id = $1`, [beatId]);
    if (ids.length)
      await q(
        `INSERT INTO beat_outlets (beat_id, outlet_id, seq)
         SELECT $1, x.id, x.ord FROM unnest($2::text[]) WITH ORDINALITY AS x(id, ord)`,
        [beatId, ids]);
  });

  return NextResponse.json({ ok: true, stops: ids.length });
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
