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
/**
 * English gists for the seed's Hinglish remarks, so an English question finds
 * them by meaning (see the gist note in agent/src/lib/memory.ts). Live remarks
 * get theirs from the model when they are recorded.
 */
const GIST: [RegExp, string][] = [
  [/stock bhara/i, 'shelf is full, enough stock, no need to order'],
  [/shutter down|shop closed/i, 'shop was closed'],
  [/owner not there/i, 'owner absent, staff cannot place orders'],
  [/payment pending/i, 'payment pending, owes money'],
  [/purana batch|expiry/i, 'old batch near expiry, complaint about expiry'],
  [/4 baje/i, 'owner only available after 4pm, timing preference'],
  [/seal tooti|complaint/i, 'customer complaint, damaged product packaging'],
  [/delivery late/i, 'late delivery complaint, unhappy'],
  [/cipla|mankind|himalaya|competitor|rival/i, 'rival competitor brand offer or scheme'],
];

export async function GET(req: Request) {
  const days = Math.min(60, Math.max(1, Number(new URL(req.url).searchParams.get('days') ?? 21)));
  const rows = await sql<{ outlet_id: string; outlet: string; region: string; kind: string; text: string; by: string | null; at: string }>(
    // History only: the seed's visits (ids V-0001…). Anything the live agent
    // recorded was written to memory as it happened, so it is not repeated here.
    `SELECT v.outlet_id, ou.name AS outlet, ou.region,
            CASE WHEN c.id IS NOT NULL THEN 'competitor' ELSE 'no_order' END AS kind,
            v.no_order_reason AS text, r.name AS by, v.occurred_at AS at
       FROM visits v
       JOIN outlets ou ON ou.id = v.outlet_id
       LEFT JOIN reps r ON r.id = v.rep_id
       LEFT JOIN competitor_intel c ON c.id = 'CI-' || v.id
      WHERE v.no_order_reason IS NOT NULL
        AND v.id ~ '^V-[0-9]+$'
        AND v.occurred_at >= now() - make_interval(days => $1)
      ORDER BY v.occurred_at DESC LIMIT 250`, [days]);
  return NextResponse.json({
    memories: rows.map((r) => ({ outletId: r.outlet_id, outlet: r.outlet, region: r.region, kind: r.kind,
                                 text: r.text, gist: GIST.find(([re]) => re.test(r.text))?.[1],
                                 by: r.by ?? 'rep', at: new Date(r.at).toISOString() })),
  });
}
