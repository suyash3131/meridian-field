import { NextResponse } from 'next/server';
import { pendingFor } from '@/lib/approvals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** What is waiting on one manager, oldest first, numbered the way they will see it. */
export async function GET(req: Request) {
  const managerId = new URL(req.url).searchParams.get('managerId') ?? '';
  const rows = await pendingFor(managerId);
  // One decision per shop and kind: six holds at one counter are one question
  // to a manager, not six. Totals are summed here, never by the agent.
  const groups: {
    n: number; outlet: string | null; outletId: string | null; kind: string; count: number; ids: string[];
    totalPaise: number; oldestDays: number; reps: string[]; limitPaise: number | null; owedPaise: number | null;
  }[] = [];
  for (const r of rows) {
    let g = groups.find((x) => x.outletId === r.outlet_id && x.kind === r.kind);
    if (!g) {
      g = { n: groups.length + 1, outlet: r.outlet, outletId: r.outlet_id, kind: r.kind, count: 0, ids: [], totalPaise: 0,
            oldestDays: 0, reps: [], limitPaise: r.limit_paise == null ? null : Number(r.limit_paise),
            owedPaise: r.owed_paise == null ? null : Number(r.owed_paise) };
      groups.push(g);
    }
    g.count++; g.ids.push(r.id); g.totalPaise += Number(r.value_paise ?? 0);
    g.oldestDays = Math.max(g.oldestDays, r.age_days);
    if (r.rep && !g.reps.includes(r.rep)) g.reps.push(r.rep);
  }
  return NextResponse.json({
    groups,
    pending: rows.map((r, i) => ({
      n: i + 1, id: r.id, kind: r.kind, orderId: r.subject_id, outlet: r.outlet, rep: r.rep,
      reason: r.reason, valuePaise: r.value_paise == null ? null : Number(r.value_paise), ageDays: r.age_days,
    })),
  });
}
