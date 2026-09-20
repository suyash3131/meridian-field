import { NextRequest, NextResponse } from 'next/server';
import { sql, one } from '@/lib/db';
import { resolveOutlet } from '@/lib/match';
import { outstanding } from '@/lib/order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** What a rep needs to know before he opens his mouth at a counter. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const repId = req.nextUrl.searchParams.get('repId') ?? undefined;
  const weekday = ((new Date().getDay() + 6) % 7) + 1;

  const decision = await resolveOutlet(q, { repId, weekday });
  // `decision` already carries its own status; spreading it after an explicit
  // one silently overwrote it. Return the decision as-is.
  if (decision.status !== 'resolved') return NextResponse.json(decision);

  const o = decision.value;
  const owed = await outstanding(o.id);
  const [lastVisit, overdue, nearExpiry, recent] = await Promise.all([
    one<{ at: string; days: number }>(
      `SELECT max(occurred_at) AS at, current_date - max(occurred_at)::date AS days
         FROM visits WHERE outlet_id = $1`, [o.id]),
    one<{ amt: string }>(
      `SELECT COALESCE(SUM(amount_paise),0)::bigint AS amt FROM invoices
        WHERE outlet_id = $1 AND status <> 'paid' AND due_on < current_date`, [o.id]),
    sql<{ name: string; batch_no: string; days: number }>(
      `SELECT s.name, b.batch_no, b.expiry_date - current_date AS days
         FROM batches b JOIN skus s ON s.id = b.sku_id
        WHERE b.expiry_date - current_date BETWEEN 0 AND 90
          AND b.sku_id IN (SELECT DISTINCT ol.sku_id FROM order_lines ol
                             JOIN orders ord ON ord.id = ol.order_id
                            WHERE ord.outlet_id = $1)
        ORDER BY b.expiry_date LIMIT 3`, [o.id]),
    sql<{ name: string; qty: number }>(
      `SELECT s.name, SUM(ol.qty)::int AS qty
         FROM order_lines ol JOIN orders ord ON ord.id = ol.order_id
         JOIN skus s ON s.id = ol.sku_id
        WHERE ord.outlet_id = $1 AND ord.status = 'confirmed'
        GROUP BY s.name ORDER BY SUM(ol.qty) DESC LIMIT 4`, [o.id]),
  ]);

  const limit = Number(o.credit_limit_paise);
  return NextResponse.json({
    status: 'resolved',
    outlet: { id: o.id, name: o.name, area: o.area, region: o.region },
    credit: {
      limitPaise: limit, outstandingPaise: owed, headroomPaise: limit - owed,
      overduePaise: Number(overdue?.amt ?? 0), termsDays: o.credit_terms_days,
    },
    lastVisitDaysAgo: lastVisit?.days ?? null,
    nearExpiry, usuallyBuys: recent,
  });
}
