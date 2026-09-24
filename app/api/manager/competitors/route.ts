import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What rivals are doing, from what reps saw at the counter.
 *
 * Per brand: how many counters this period against the one before, what
 * offers and products were named, which Meridian products they hit, and where.
 * Plus what those counters ordered from us this period against the last, so a
 * manager can see whether the pressure is costing anything yet. Counts and
 * sums only; the words stay the reps' own.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const region = u.searchParams.get('region') || null;
  const days = Math.min(90, Math.max(1, Number(u.searchParams.get('days') ?? 7)));
  const brands = await sql<{
    brand: string; counters_now: number; counters_before: number; offers: string[]; products: string[];
    ours: string[]; shops: string[]; reps: string[]; latest: string; last_seen: string;
  }>(
    `WITH w AS (
       SELECT c.*, ou.name AS shop, ou.region, r.name AS rep, s.name AS our_name,
              c.seen_at >= now() - make_interval(days => $2) AS is_now
         FROM competitor_intel c
         JOIN outlets ou ON ou.id = c.outlet_id
         LEFT JOIN reps r ON r.id = c.rep_id
         LEFT JOIN skus s ON s.id = c.our_sku_id
        WHERE c.seen_at >= now() - make_interval(days => $2 * 2)
          AND ($1::text IS NULL OR ou.region = $1))
     SELECT brand,
            count(DISTINCT outlet_id) FILTER (WHERE is_now)::int AS counters_now,
            count(DISTINCT outlet_id) FILTER (WHERE NOT is_now)::int AS counters_before,
            COALESCE(array_agg(DISTINCT offer) FILTER (WHERE is_now AND offer IS NOT NULL), '{}') AS offers,
            COALESCE(array_agg(DISTINCT product) FILTER (WHERE is_now AND product IS NOT NULL), '{}') AS products,
            COALESCE(array_agg(DISTINCT our_name) FILTER (WHERE is_now AND our_name IS NOT NULL), '{}') AS ours,
            COALESCE(array_agg(DISTINCT shop) FILTER (WHERE is_now), '{}') AS shops,
            COALESCE(array_agg(DISTINCT rep) FILTER (WHERE is_now AND rep IS NOT NULL), '{}') AS reps,
            (array_agg(raw ORDER BY seen_at DESC) FILTER (WHERE is_now))[1] AS latest,
            to_char(max(seen_at) FILTER (WHERE is_now), 'DD Mon') AS last_seen
       FROM w GROUP BY brand
     HAVING count(*) FILTER (WHERE is_now) > 0
     ORDER BY counters_now DESC, brand`, [region, days]);

  // Our own orders at the counters under pressure: this period vs the one before.
  const [money] = await sql<{ now_paise: string; before_paise: string }>(
    `WITH hit AS (
       SELECT DISTINCT c.outlet_id FROM competitor_intel c JOIN outlets ou ON ou.id = c.outlet_id
        WHERE c.seen_at >= now() - make_interval(days => $2) AND ($1::text IS NULL OR ou.region = $1))
     SELECT COALESCE(SUM(o.total_paise) FILTER (WHERE o.created_at >= now() - make_interval(days => $2)), 0)::bigint AS now_paise,
            COALESCE(SUM(o.total_paise) FILTER (WHERE o.created_at <  now() - make_interval(days => $2)), 0)::bigint AS before_paise
       FROM orders o JOIN hit ON hit.outlet_id = o.outlet_id
      WHERE o.status IN ('confirmed', 'dispatched', 'held_credit')
        AND o.created_at >= now() - make_interval(days => $2 * 2)`, [region, days]);

  return NextResponse.json({
    region: region ?? 'all', days, brands,
    oursAtThoseCounters: { nowPaise: Number(money?.now_paise ?? 0), beforePaise: Number(money?.before_paise ?? 0) },
  });
}
