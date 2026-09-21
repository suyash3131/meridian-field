import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A rep's month, day by day: counters on the route against counters actually
 * visited. There is no "present" flag anywhere to read. A day counts because
 * visits exist, and a visit exists only because an order or a stated reason
 * was recorded at the counter.
 */
export async function GET(req: Request) {
  const repId = new URL(req.url).searchParams.get('repId') ?? 'R-07';

  const days = await sql<{ day: string; weekday: number; scheduled: number; made: number; flagged: number }>(
    `WITH month AS (
       SELECT d::date AS day
         FROM generate_series(date_trunc('month', current_date), current_date, interval '1 day') d
     ),
     first_record AS (SELECT MIN(occurred_at)::date AS d FROM visits)
     SELECT to_char(m.day, 'YYYY-MM-DD') AS day,
            EXTRACT(ISODOW FROM m.day)::int AS weekday,
            COALESCE((SELECT count(*) FROM beats b JOIN beat_outlets bo ON bo.beat_id = b.id
                       WHERE b.rep_id = $1 AND b.weekday = EXTRACT(ISODOW FROM m.day)::int), 0)::int AS scheduled,
            (SELECT count(DISTINCT v.outlet_id) FROM visits v
              WHERE v.rep_id = $1 AND v.occurred_at::date = m.day)::int AS made,
            (SELECT count(*) FROM visits v
              WHERE v.rep_id = $1 AND v.occurred_at::date = m.day
                AND v.verification = 'flagged')::int AS flagged
       FROM month m, first_record f
      WHERE m.day >= f.d
      ORDER BY m.day`,
    [repId]
  );

  return NextResponse.json({ days });
}
