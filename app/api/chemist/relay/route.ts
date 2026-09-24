import { NextResponse } from 'next/server';
import { one } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Who a chemist's message should reach: the rep who looks after the shop (the
 * one on its route, else the one who last took an order there) and that rep's
 * ASM. The agent passes the message on; it never acts on a chemist's request
 * itself, because a chemist cannot place, change or approve anything.
 */
export async function GET(req: Request) {
  const outletId = new URL(req.url).searchParams.get('outletId') ?? '';
  const r = await one<{ shop: string; rep_id: string; rep: string; rep_email: string | null; asm: string | null; asm_email: string | null }>(
    `WITH owner AS (
       (SELECT b.rep_id FROM beat_outlets bo JOIN beats b ON b.id = bo.beat_id WHERE bo.outlet_id = $1 LIMIT 1)
       UNION ALL
       (SELECT rep_id FROM orders WHERE outlet_id = $1 ORDER BY created_at DESC LIMIT 1)
       LIMIT 1)
     SELECT ou.name AS shop, r.id AS rep_id, r.name AS rep, r.email AS rep_email, m.name AS asm, m.email AS asm_email
       FROM owner JOIN reps r ON r.id = owner.rep_id
       JOIN outlets ou ON ou.id = $1
       LEFT JOIN managers m ON m.id = r.asm_id`, [outletId]);
  if (!r) return NextResponse.json({ error: 'nobody looks after this shop yet' }, { status: 404 });
  return NextResponse.json(r);
}
