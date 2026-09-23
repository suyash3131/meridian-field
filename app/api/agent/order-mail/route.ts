import { NextResponse } from 'next/server';
import { one, sql, rs } from '@/lib/db';
import { outstanding } from '@/lib/order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The emails an order sends, built here rather than by the model.
 *
 * The agent only delivers them. Every line, rupee and address is read from the
 * order as it was committed, so the chemist's confirmation cannot disagree with
 * the ledger, and the model has no text of its own to get wrong.
 *
 *   chemist — a confirmation of what was booked, with the total and the credit
 *             terms. Sent for a placed order only: a held order has not been
 *             accepted, and telling the shop it has would be a promise we
 *             have not made.
 *   asm     — for a held order, the area manager is told now, by email, with
 *             enough on the page to decide without opening the dashboard.
 */
export async function GET(req: Request) {
  const orderId = new URL(req.url).searchParams.get('orderId') ?? '';
  const o = await one<{
    id: string; status: string; total_paise: string; subtotal_paise: string;
    scheme_discount_paise: string; credit_terms_days: number; confirmed_at: string | null;
    outlet_id: string; outlet: string; area: string; outlet_email: string | null; credit_limit_paise: string;
    rep: string; asm: string | null; asm_email: string | null;
  }>(
    `SELECT o.id, o.status, o.total_paise, o.subtotal_paise, o.scheme_discount_paise,
            o.credit_terms_days, o.confirmed_at,
            o.outlet_id, ou.name AS outlet, ou.area, ou.email AS outlet_email, ou.credit_limit_paise,
            r.name AS rep, m.name AS asm, m.email AS asm_email
       FROM orders o
       JOIN outlets ou ON ou.id = o.outlet_id
       JOIN reps r     ON r.id = o.rep_id
       LEFT JOIN managers m ON m.id = r.asm_id
      WHERE o.id = $1`, [orderId]);
  if (!o) return NextResponse.json({ error: 'no such order' }, { status: 404 });

  const lines = await sql<{ name: string; pack_desc: string; qty: number; free_qty: number; line_total_paise: string }>(
    `SELECT s.name, s.pack_desc, l.qty, l.free_qty, l.line_total_paise
       FROM order_lines l JOIN skus s ON s.id = l.sku_id
      WHERE l.order_id = $1 ORDER BY l.id`, [orderId]);

  // Owed by the shop right now, the same figure the credit check used.
  const owed = await outstanding(o.outlet_id).catch(() => null);

  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const rows = lines.map((l) =>
    `<tr><td style="padding:6px 12px 6px 0">${l.qty} × ${esc(l.name)} <span style="color:#667">${esc(l.pack_desc)}</span>` +
    (l.free_qty ? ` <b style="color:#0f766e">+ ${l.free_qty} free</b>` : '') +
    `</td><td style="padding:6px 0;text-align:right">${rs(l.line_total_paise)}</td></tr>`).join('');
  const table =
    `<table style="border-collapse:collapse;font:14px/1.4 -apple-system,Segoe UI,sans-serif;min-width:320px">${rows}` +
    (Number(o.scheme_discount_paise) > 0
      ? `<tr><td style="padding:6px 12px 6px 0;color:#0f766e">Scheme saving</td><td style="text-align:right;color:#0f766e">− ${rs(o.scheme_discount_paise)}</td></tr>` : '') +
    `<tr><td style="padding:10px 12px 0 0;border-top:1px solid #ddd"><b>Total</b></td>` +
    `<td style="padding:10px 0 0;border-top:1px solid #ddd;text-align:right"><b>${rs(o.total_paise)}</b></td></tr></table>`;
  const wrap = (body: string) =>
    `<div style="font:14px/1.5 -apple-system,Segoe UI,sans-serif;color:#111;max-width:560px">${body}` +
    `<p style="color:#889;font-size:12px;margin-top:24px">Meridian Healthcare · field order ${esc(o.id)}</p></div>`;
  const plain = lines.map((l) => `${l.qty} x ${l.name}${l.free_qty ? ` + ${l.free_qty} free` : ''}  ${rs(l.line_total_paise)}`).join('\n');

  const out: Record<string, unknown> = { orderId: o.id, status: o.status };

  if (o.status === 'confirmed' && o.outlet_email)
    out.chemist = {
      to: o.outlet_email,
      subject: `Order confirmed: ${o.outlet}, ${rs(o.total_paise)}`,
      html: wrap(
        `<p>Dear ${esc(o.outlet)},</p><p>Your order with ${esc(o.rep)} is booked.</p>${table}` +
        `<p>Credit: ${o.credit_terms_days} days. Payment is due ${o.credit_terms_days} days from delivery.</p>`),
      text: `Order confirmed: ${o.outlet}\n\n${plain}\nTotal ${rs(o.total_paise)}\nCredit: ${o.credit_terms_days} days`,
    };

  if (o.status === 'held_credit' && o.asm_email)
    out.asm = {
      to: o.asm_email,
      subject: `Held for credit: ${o.outlet}, ${rs(o.total_paise)}`,
      html: wrap(
        `<p>${esc(o.asm ?? '')},</p><p>${esc(o.rep)}'s order at <b>${esc(o.outlet)}</b> (${esc(o.area)}) ` +
        `is over the shop's credit limit, so it is on hold until you decide.</p>${table}` +
        `<p>Credit limit ${rs(o.credit_limit_paise)}` + (owed != null ? ` · already owed ${rs(owed)}` : '') + `.</p>` +
        `<p>Approve or reject it on Today in the Meridian dashboard. The agent cannot release it.</p>`),
      text: `Held for credit: ${o.outlet} ${rs(o.total_paise)}\n\n${plain}`,
    };

  return NextResponse.json(out);
}
