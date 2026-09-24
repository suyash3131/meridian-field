import { NextResponse } from 'next/server';
import { one, sql, rs } from '@/lib/db';
import { outstanding } from '@/lib/order';
import { invoiceUrl } from '@/lib/sign';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Every email an order's life sends, built here rather than by the model.
 *
 * The agent only delivers them. Every line, rupee and address is read from the
 * order as it stands in the ledger, so an email cannot disagree with the books,
 * and the model has no text of its own to get wrong.
 *
 *   placed   → chemist: confirmation with the invoice PDF attached; the rep is
 *              copied so he has the invoice too
 *   held     → ASM: everything needed to decide, and "reply APPROVE or REJECT"
 *              — a reply to this email is a decision the agent can carry
 *   approved → chemist: the same confirmation + invoice; rep: told it went through
 *   rejected → rep: told it was refused and why, so he can collect first
 *
 * Every email has a plain-text part beside the HTML. HTML-only mail from a new
 * sender is one of the things that sends it to spam.
 */
type Mail = {
  who: 'chemist' | 'asm' | 'rep'; to: string; cc?: string[]; subject: string; html: string; text: string;
  attachments?: { filename: string; contentType: string; url: string }[];
};

export async function GET(req: Request) {
  const u = new URL(req.url);
  const orderId = u.searchParams.get('orderId') ?? '';
  const o = await one<{
    id: string; status: string; total_paise: string; subtotal_paise: string;
    scheme_discount_paise: string; credit_terms_days: number; confirmed_at: string | null;
    outlet_id: string; outlet: string; area: string; outlet_email: string | null; credit_limit_paise: string;
    rep: string; rep_email: string | null; asm: string | null; asm_email: string | null;
    mail_message_id: string | null; inv_id: string | null; due_on: string | null;
    approval_id: string | null; decided_by: string | null; approval_status: string | null;
  }>(
    `SELECT o.id, o.status, o.total_paise, o.subtotal_paise, o.scheme_discount_paise,
            o.credit_terms_days, o.confirmed_at, o.mail_message_id,
            o.outlet_id, ou.name AS outlet, ou.area, ou.email AS outlet_email, ou.credit_limit_paise,
            r.name AS rep, r.email AS rep_email, m.name AS asm, m.email AS asm_email,
            i.id AS inv_id, to_char(i.due_on, 'DD Mon YYYY') AS due_on,
            a.id AS approval_id, dm.name AS decided_by, a.status AS approval_status
       FROM orders o
       JOIN outlets ou ON ou.id = o.outlet_id
       JOIN reps r     ON r.id = o.rep_id
       LEFT JOIN managers m ON m.id = r.asm_id
       LEFT JOIN invoices i ON i.order_id = o.id
       LEFT JOIN approvals a ON a.subject_id = o.id AND a.kind = 'credit_override'
       LEFT JOIN managers dm ON dm.id = a.decided_by
      WHERE o.id = $1`, [orderId]);
  if (!o) return NextResponse.json({ error: 'no such order' }, { status: 404 });

  const event = u.searchParams.get('event')
    ?? (o.status === 'held_credit' ? 'held' : o.status === 'confirmed' ? 'placed' : 'none');

  const lines = await sql<{ name: string; pack_desc: string; qty: number; free_qty: number; line_total_paise: string }>(
    `SELECT s.name, s.pack_desc, l.qty, l.free_qty, l.line_total_paise
       FROM order_lines l JOIN skus s ON s.id = l.sku_id
      WHERE l.order_id = $1 ORDER BY l.id`, [orderId]);

  // Owed by the shop right now, the same figure the credit check used.
  const owed = await outstanding(o.outlet_id).catch(() => null);

  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  // "Baby Lotion 200ml" already says 200ml; its pack "200ml bottle" then only adds "bottle".
  const pack = (l: { name: string; pack_desc: string }) => {
    const size = l.pack_desc.split(' ')[0];
    return l.name.toLowerCase().includes(size.toLowerCase()) ? l.pack_desc.slice(size.length).trim() : l.pack_desc;
  };
  const rows = lines.map((l) =>
    `<tr><td style="padding:6px 12px 6px 0">${l.qty} × ${esc(l.name)} <span style="color:#667">${esc(pack(l))}</span>` +
    (l.free_qty ? ` <b style="color:#0f766e">+ ${l.free_qty} free</b>` : '') +
    `</td><td style="padding:6px 0;text-align:right">${rs(l.line_total_paise)}</td></tr>`).join('');
  // The free goods are extra stock, not money off: the total already excludes
  // them. Written as "− ₹84" above the total, it read as a discount.
  const scheme = Number(o.scheme_discount_paise) > 0
    ? `Free goods worth ${rs(o.scheme_discount_paise)} included under the scheme` : '';
  const table =
    `<table style="border-collapse:collapse;font:14px/1.4 -apple-system,Segoe UI,sans-serif;min-width:320px">${rows}` +
    (scheme ? `<tr><td colspan="2" style="padding:6px 0;color:#0f766e">${scheme}</td></tr>` : '') +
    `<tr><td style="padding:10px 12px 0 0;border-top:1px solid #ddd"><b>Total</b></td>` +
    `<td style="padding:10px 0 0;border-top:1px solid #ddd;text-align:right"><b>${rs(o.total_paise)}</b></td></tr></table>`;
  const ref = o.approval_id ? `${o.id} · ${o.approval_id}` : o.id;
  const wrap = (body: string) =>
    `<div style="font:14px/1.5 -apple-system,Segoe UI,sans-serif;color:#111;max-width:560px">${body}` +
    `<p style="color:#889;font-size:12px;margin-top:24px">Meridian Healthcare · ref ${esc(ref)}</p></div>`;
  const plain = lines.map((l) => `${l.qty} x ${l.name}${l.free_qty ? ` + ${l.free_qty} free` : ''}  ${rs(l.line_total_paise)}`).join('\n')
    + (scheme ? `\n${scheme}` : '') + `\nTotal ${rs(o.total_paise)}`;
  const footer = `\n\nMeridian Healthcare · ref ${ref}`;

  const invoice = o.inv_id
    ? [{ filename: `Meridian-${o.inv_id}.pdf`, contentType: 'application/pdf', url: invoiceUrl(o.id) }]
    : undefined;
  const chemistConfirmation = (): Mail | null => !o.outlet_email ? null : {
    who: 'chemist', to: o.outlet_email,
    cc: o.rep_email ? [o.rep_email] : undefined,
    subject: `Order confirmed: ${o.outlet}, ${rs(o.total_paise)} · ${o.id}`,
    html: wrap(
      `<p>Dear ${esc(o.outlet)},</p><p>Your order with ${esc(o.rep)} is booked. The invoice is attached.</p>${table}` +
      `<p>Credit: ${o.credit_terms_days} days${o.due_on ? `, due <b>${esc(o.due_on)}</b>` : ''}.</p>` +
      `<p style="color:#556">Reply to this email with any question about this order and it reaches ${esc(o.rep)}. ` +
      `You can also ask what your shop owes.</p>`),
    text: `Dear ${o.outlet},\n\nYour order with ${o.rep} is booked. The invoice is attached.\n\n${plain}\n` +
      `Credit: ${o.credit_terms_days} days${o.due_on ? `, due ${o.due_on}` : ''}.\n\n` +
      `Reply to this email with any question about this order and it reaches ${o.rep}.` + footer,
    attachments: invoice,
  };

  const emails: Mail[] = [];

  if (event === 'placed' && o.status === 'confirmed') {
    const c = chemistConfirmation(); if (c) emails.push(c);
  }

  if (event === 'held' && o.status === 'held_credit' && o.asm_email)
    emails.push({
      who: 'asm', to: o.asm_email,
      subject: `Held for credit: ${o.outlet}, ${rs(o.total_paise)} · ${o.id}`,   // the ref rides in the subject: a reply keeps it, the quote may not
      html: wrap(
        `<p>${esc(o.asm ?? '')},</p><p>${esc(o.rep)}'s order at <b>${esc(o.outlet)}</b> (${esc(o.area)}) ` +
        `is over the shop's credit limit, so it is on hold until you decide.</p>${table}` +
        `<p>Credit limit ${rs(o.credit_limit_paise)}` + (owed != null ? ` · already owed ${rs(owed)}` : '') + `.</p>` +
        `<p style="font-size:15px"><b>Reply APPROVE</b> to release it (the shop gets its confirmation and invoice), ` +
        `or <b>REJECT</b> to cancel it. You can add a note after the word.</p>` +
        `<p style="color:#556">Only a reply from your own address counts. The agent does not decide this; it carries out what you reply.</p>`),
      text: `${o.asm ?? ''},\n\n${o.rep}'s order at ${o.outlet} (${o.area}) is over the shop's credit limit, so it is on hold until you decide.\n\n` +
        `${plain}\nCredit limit ${rs(o.credit_limit_paise)}` + (owed != null ? `, already owed ${rs(owed)}` : '') + `.\n\n` +
        `Reply APPROVE to release it, or REJECT to cancel it. You can add a note after the word.` + footer,
    });

  if (event === 'approved' && o.status === 'confirmed') {
    const c = chemistConfirmation(); if (c) emails.push({ ...c, cc: undefined });
    if (o.rep_email)
      emails.push({
        who: 'rep', to: o.rep_email,
        subject: `Approved: ${o.outlet}, ${rs(o.total_paise)}`,
        html: wrap(`<p>${esc(o.rep)},</p><p>${esc(o.decided_by ?? 'Your ASM')} approved the held order at <b>${esc(o.outlet)}</b>. ` +
          `It is now booked, and the shop has its confirmation and invoice.</p>${table}`),
        text: `${o.rep},\n\n${o.decided_by ?? 'Your ASM'} approved the held order at ${o.outlet}. It is now booked, and the shop has its confirmation and invoice.\n\n${plain}` + footer,
        attachments: invoice,
      });
  }

  if (event === 'rejected' && o.status === 'cancelled' && o.rep_email)
    emails.push({
      who: 'rep', to: o.rep_email,
      subject: `Not approved: ${o.outlet}, ${rs(o.total_paise)}`,
      html: wrap(`<p>${esc(o.rep)},</p><p>${esc(o.decided_by ?? 'Your ASM')} did not approve the held order at <b>${esc(o.outlet)}</b>, ` +
        `so it is cancelled.` + (owed != null ? ` The shop owes ${rs(owed)}; collecting some of it frees room for the next order.` : '') + `</p>${table}`),
      text: `${o.rep},\n\n${o.decided_by ?? 'Your ASM'} did not approve the held order at ${o.outlet}, so it is cancelled.` +
        (owed != null ? ` The shop owes ${rs(owed)}; collecting some of it frees room for the next order.` : '') + `\n\n${plain}` + footer,
    });

  return NextResponse.json({
    orderId: o.id, status: o.status, event, threadRoot: o.mail_message_id, emails,
    // Kept for the tools written before the list existed.
    chemist: emails.find((e) => e.who === 'chemist'), asm: emails.find((e) => e.who === 'asm'),
    invoiceUrl: invoice?.[0]?.url ?? null,
  });
}

/** The first email about an order: later ones about it reply to this, so they thread. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (!b.orderId || !b.messageId) return NextResponse.json({ error: 'orderId and messageId required' }, { status: 400 });
  await sql(`UPDATE orders SET mail_message_id = $2 WHERE id = $1 AND mail_message_id IS NULL`, [b.orderId, String(b.messageId)]);
  return NextResponse.json({ ok: true });
}
