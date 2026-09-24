import { NextResponse } from 'next/server';
import { pendingFor } from '@/lib/approvals';
import { sql } from '@/lib/db';

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
  // What is in each held order, so a manager deciding one at a time sees it:
  // "3 × Dolomed 650, 2 × Baby Lotion 200ml".
  const orderIds = rows.map((r) => r.subject_id).filter(Boolean);
  const lines = orderIds.length ? await sql<{ order_id: string; qty: number; name: string }>(
    `SELECT l.order_id, l.qty, s.name FROM order_lines l JOIN skus s ON s.id = l.sku_id
      WHERE l.order_id = ANY($1) ORDER BY l.id`, [orderIds]) : [];
  const itemsOf = (orderId: string) => {
    const mine = lines.filter((l) => l.order_id === orderId);
    const shown = mine.slice(0, 3).map((l) => `${l.qty} × ${l.name}`).join(', ');
    return mine.length > 3 ? `${shown} +${mine.length - 3} more` : shown || null;
  };
  return NextResponse.json({
    groups,
    pending: rows.map((r, i) => ({
      n: i + 1, id: r.id, kind: r.kind, orderId: r.subject_id, outlet: r.outlet, rep: r.rep,
      reason: r.reason, items: itemsOf(r.subject_id), valuePaise: r.value_paise == null ? null : Number(r.value_paise), ageDays: r.age_days,
    })),
  });
}
