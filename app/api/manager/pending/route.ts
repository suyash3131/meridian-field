import { NextResponse } from 'next/server';
import { pendingFor } from '@/lib/approvals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** What is waiting on one manager, oldest first, numbered the way they will see it. */
export async function GET(req: Request) {
  const managerId = new URL(req.url).searchParams.get('managerId') ?? '';
  const rows = await pendingFor(managerId);
  return NextResponse.json({
    pending: rows.map((r, i) => ({
      n: i + 1, id: r.id, kind: r.kind, orderId: r.subject_id, outlet: r.outlet, rep: r.rep,
      reason: r.reason, valuePaise: r.value_paise == null ? null : Number(r.value_paise), ageDays: r.age_days,
    })),
  });
}
