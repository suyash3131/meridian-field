import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reps, and the counters on each one's route today. Powers the rep view. */
export async function GET() {
  const reps = await sql<{
    id: string; name: string; region: string; asm: string;
    counters: { id: string; name: string; area: string; lat: number; lng: number; on_beat: boolean }[];
  }>(
    `SELECT r.id, r.name, r.region, m.name AS asm,
            COALESCE(
              (SELECT json_agg(x ORDER BY x.on_beat DESC, x.name)
                 FROM (
                   SELECT o.id, o.name, o.area, o.lat, o.lng,
                          -- Beats run Monday to Saturday. On a Sunday there is no route,
                          -- so every counter would read "not on today's route" — which is
                          -- an artefact of the calendar, not a fact about the rep. With no
                          -- route for the day, territory membership is the honest answer.
                          CASE WHEN EXISTS (SELECT 1 FROM beats b2
                                             WHERE b2.rep_id = r.id
                                               AND b2.weekday = EXTRACT(ISODOW FROM current_date)::int)
                            THEN EXISTS (SELECT 1 FROM beat_outlets bo JOIN beats b ON b.id = bo.beat_id
                                          WHERE bo.outlet_id = o.id AND b.rep_id = r.id
                                            AND b.weekday = EXTRACT(ISODOW FROM current_date)::int)
                            ELSE true
                          END AS on_beat
                     FROM outlets o
                    WHERE EXISTS (SELECT 1 FROM beat_outlets bo JOIN beats b ON b.id = bo.beat_id
                                   WHERE bo.outlet_id = o.id AND b.rep_id = r.id)
                 ) x), '[]'::json) AS counters
       FROM reps r JOIN managers m ON m.id = r.asm_id
      ORDER BY r.region, r.id`
  );
  const noRouteToday = new Date().getDay() === 0;
  return NextResponse.json({ reps, noRouteToday, weekday: new Date().toLocaleDateString('en-IN', { weekday: 'long' }) });
}
