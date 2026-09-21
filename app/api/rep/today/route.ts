import { NextResponse } from 'next/server';
import { sql, one, businessWeekday } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Past this, a counter that has not ordered is worth asking for one. */
const QUIET_DAYS = 14;

/**
 * A rep's day: his route, what each stop needs, and what he has done.
 *
 * Every task is derived from the ledger, not written by anyone: money past
 * its terms means "collect", a counter that has gone quiet means "take an
 * order", anything else means "check stock". "Done" is a visit recorded today,
 * which only an order or a stated reason can create.
 *
 * On a Sunday there is no route, so it shows Monday's and says so.
 */
export async function GET(req: Request) {
  const repId = new URL(req.url).searchParams.get('repId') ?? 'R-07';
  const today = businessWeekday();
  const weekday = today === 7 ? 1 : today;

  const rep = await one<{ id: string; name: string; region: string; asm: string; asm_role: string }>(
    `SELECT r.id, r.name, r.region, m.name AS asm, m.role AS asm_role
       FROM reps r JOIN managers m ON m.id = r.asm_id WHERE r.id = $1`, [repId]);
  if (!rep) return NextResponse.json({ error: 'no such rep' }, { status: 404 });

  const [stops, position] = await Promise.all([
    sql<{
      id: string; name: string; area: string; lat: number; lng: number; seq: number;
      overdue_paise: string; days_since_order: number | null; done: boolean; outcome: string | null;
    }>(
      `SELECT o.id, o.name, o.area, o.lat, o.lng, bo.seq,
              COALESCE((SELECT SUM(i.amount_paise) FROM invoices i
                         WHERE i.outlet_id = o.id AND i.status <> 'paid'
                           AND i.due_on < current_date), 0)::bigint           AS overdue_paise,
              (SELECT current_date - MAX(od.created_at)::date FROM orders od
                WHERE od.outlet_id = o.id AND od.status = 'confirmed')        AS days_since_order,
              EXISTS (SELECT 1 FROM visits v WHERE v.outlet_id = o.id AND v.rep_id = $1
                        AND v.occurred_at::date = current_date)                AS done,
              (SELECT v.outcome FROM visits v WHERE v.outlet_id = o.id AND v.rep_id = $1
                  AND v.occurred_at::date = current_date
                ORDER BY v.occurred_at DESC LIMIT 1)                          AS outcome
         FROM beats b
         JOIN beat_outlets bo ON bo.beat_id = b.id
         JOIN outlets o ON o.id = bo.outlet_id
        WHERE b.rep_id = $1 AND b.weekday = $2
        ORDER BY bo.seq`,
      [repId, weekday]
    ),
    one<{ lat: number; lng: number }>(`SELECT lat, lng FROM rep_positions WHERE rep_id = $1`, [repId]),
  ]);

  return NextResponse.json({
    rep: { id: rep.id, name: rep.name, region: rep.region },
    manager: { name: rep.asm, role: rep.asm_role },
    showingTomorrow: today === 7,
    position,
    stops: stops.map((s) => {
      const overdue = Number(s.overdue_paise);
      const task =
        overdue > 0 ? 'collect'
        : s.days_since_order === null || s.days_since_order >= QUIET_DAYS ? 'order'
        : 'check';
      return {
        id: s.id, name: s.name, area: s.area, lat: s.lat, lng: s.lng, seq: s.seq,
        task, overduePaise: overdue, daysSinceOrder: s.days_since_order,
        done: s.done, outcome: s.outcome,
      };
    }),
  });
}
