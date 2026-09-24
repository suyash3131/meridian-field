import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What the field team said about each shop recently, in their own words: the
 * reasons behind no-order visits and every rival sighting. The agent's
 * memory-backfill job reads this into Lua's Data store, where it becomes
 * searchable by meaning. Live remarks are written there directly as they
 * happen; this only fills the memory for the history that predates it.
 */
export async function GET(req: Request) {
  const days = Math.min(60, Math.max(1, Number(new URL(req.url).searchParams.get('days') ?? 21)));
  const rows = await sql<{ outlet_id: string; outlet: string; region: string; kind: string; text: string; by: string | null; at: string }>(
    `SELECT * FROM (
       SELECT v.outlet_id, ou.name AS outlet, ou.region,
              CASE WHEN c.id IS NOT NULL THEN 'competitor' ELSE 'no_order' END AS kind,
              v.no_order_reason AS text, r.name AS by, v.occurred_at AS at
         FROM visits v
         JOIN outlets ou ON ou.id = v.outlet_id
         LEFT JOIN reps r ON r.id = v.rep_id
         LEFT JOIN competitor_intel c ON c.id = 'CI-' || v.id
        WHERE v.no_order_reason IS NOT NULL
          AND v.occurred_at >= now() - make_interval(days => $1)
       UNION ALL
       SELECT c.outlet_id, ou.name, ou.region, 'competitor', c.raw, r.name, c.seen_at
         FROM competitor_intel c
         JOIN outlets ou ON ou.id = c.outlet_id
         LEFT JOIN reps r ON r.id = c.rep_id
        WHERE c.id NOT LIKE 'CI-V%' AND c.seen_at >= now() - make_interval(days => $1)
     ) m
     ORDER BY at DESC LIMIT 250`, [days]);
  return NextResponse.json({
    memories: rows.map((r) => ({ outletId: r.outlet_id, outlet: r.outlet, region: r.region, kind: r.kind,
                                 text: r.text, by: r.by ?? 'rep', at: new Date(r.at).toISOString() })),
  });
}
