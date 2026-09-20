import { NextResponse } from 'next/server';
import { sql, one } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** "Is today going the way it should, and who is stuck." Nothing else. */
export async function GET() {
  const [today, byRep, approvals, flagged] = await Promise.all([
    one<{ visits: number; orders: number; value: string; scheduled: number }>(
      `SELECT
         (SELECT count(*)::int FROM visits WHERE occurred_at::date = current_date) AS visits,
         (SELECT count(*)::int FROM orders WHERE created_at::date = current_date
            AND status IN ('confirmed','held_credit')) AS orders,
         (SELECT COALESCE(SUM(total_paise),0)::bigint FROM orders
           WHERE created_at::date = current_date AND status = 'confirmed') AS value,
         (SELECT count(*)::int FROM beats b JOIN beat_outlets bo ON bo.beat_id = b.id
           WHERE b.weekday = EXTRACT(ISODOW FROM current_date)::int) AS scheduled`),
    sql<{ rep_id: string; name: string; region: string; scheduled: number; made: number; value: string }>(
      `SELECT r.id AS rep_id, r.name, r.region,
              (SELECT count(*)::int FROM beats b JOIN beat_outlets bo ON bo.beat_id = b.id
                WHERE b.rep_id = r.id AND b.weekday = EXTRACT(ISODOW FROM current_date)::int) AS scheduled,
              (SELECT count(*)::int FROM visits v
                WHERE v.rep_id = r.id AND v.occurred_at::date = current_date) AS made,
              (SELECT COALESCE(SUM(o.total_paise),0)::bigint FROM orders o
                WHERE o.rep_id = r.id AND o.created_at::date = current_date
                  AND o.status = 'confirmed') AS value
         FROM reps r ORDER BY r.region, r.id`),
    sql<{ id: string; outlet: string; rep: string; reason: string; order_id: string; value: string; age_days: number }>(
      `SELECT a.id, ou.name AS outlet, r.name AS rep, a.reason, a.subject_id AS order_id,
              COALESCE(o.total_paise, 0)::bigint AS value,
              (current_date - a.created_at::date) AS age_days
         FROM approvals a
         JOIN outlets ou ON ou.id = a.outlet_id
         JOIN reps r ON r.id = a.requested_by
         LEFT JOIN orders o ON o.id = a.subject_id
        WHERE a.status = 'pending' ORDER BY a.created_at`),
    sql<{ id: string; outlet: string; rep: string; note: string; at: string }>(
      `SELECT v.id, ou.name AS outlet, r.name AS rep,
              COALESCE(v.verification_note, 'off today''s route') AS note,
              to_char(v.occurred_at, 'DD Mon HH24:MI') AS at
         FROM visits v JOIN outlets ou ON ou.id = v.outlet_id JOIN reps r ON r.id = v.rep_id
        WHERE (v.verification = 'flagged' OR v.on_beat = false)
          AND v.occurred_at >= now() - interval '7 days'
        ORDER BY v.occurred_at DESC LIMIT 8`),
  ]);

  return NextResponse.json({ today, byRep, approvals, flagged });
}
