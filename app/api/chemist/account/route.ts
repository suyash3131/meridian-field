import { NextResponse } from 'next/server';
import { one, sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One shop's account, for the shop itself: what it owes, what is overdue, and
 * its last few orders. The agent calls this only with a shop id taken from the
 * conversation's verified record (the chemist's own email or number), so a
 * chemist can never read another shop's account by naming it.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  // An order reference (from the email they replied to) names the shop too.
  const byOrder = u.searchParams.get('orderId')
    ? (await one<{ outlet_id: string }>(`SELECT outlet_id FROM orders WHERE id = $1`, [u.searchParams.get('orderId')]))?.outlet_id
    : null;
  const outletId = byOrder ?? u.searchParams.get('outletId') ?? '';
  const shop = await one<{ id: string; name: string; credit_limit_paise: string }>(
    `SELECT id, name, credit_limit_paise FROM outlets WHERE id = $1`, [outletId]);
  if (!shop) return NextResponse.json({ error: 'no such shop' }, { status: 404 });

  const open = await sql<{ id: string; order_id: string | null; amount_paise: string; due: string; days_over: number }>(
    `SELECT id, order_id, amount_paise, to_char(due_on, 'DD Mon') AS due, (current_date - due_on)::int AS days_over
       FROM invoices WHERE outlet_id = $1 AND status <> 'paid' ORDER BY due_on`, [outletId]);
  const orders = await sql<{ id: string; status: string; total_paise: string; on: string }>(
    `SELECT id, status, total_paise, to_char(created_at, 'DD Mon') AS on
       FROM orders WHERE outlet_id = $1 AND status <> 'draft' ORDER BY created_at DESC LIMIT 3`, [outletId]);

  const owed = open.reduce((a, i) => a + Number(i.amount_paise), 0);
  const overdue = open.filter((i) => i.days_over > 0);
  return NextResponse.json({
    outletId: shop.id,
    shop: shop.name,
    owedPaise: owed,
    overduePaise: overdue.reduce((a, i) => a + Number(i.amount_paise), 0),
    oldestOverdueDays: overdue.length ? Math.max(...overdue.map((i) => i.days_over)) : 0,
    nextDue: open.find((i) => i.days_over <= 0) ?? null,
    openInvoices: open.length,
    lastOrders: orders.map((o) => ({ id: o.id, status: o.status, totalPaise: Number(o.total_paise), on: o.on })),
  });
}
