import { one, sql } from '@/lib/db';
import { verify } from '@/lib/sign';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The invoice for a placed order, as a PDF, from the ledger.
 *
 * Every figure is read from the committed order and its invoice row, so the
 * PDF cannot disagree with the books, and no model writes any of it. The link
 * is signed (lib/sign.ts): Lua fetches it to attach it to the chemist's email,
 * and WhatsApp fetches it to send it to the rep as a document.
 *
 * Money is printed "Rs." because the PDF's built-in fonts have no ₹ glyph.
 * There is no GST split: the brief has no tax data, and a made-up tax line on
 * an invoice is worse than none. That is on the limitations list.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const orderId = u.searchParams.get('orderId') ?? '';
  if (!verify('invoice:' + orderId, u.searchParams.get('t')))
    return new Response('This invoice link is not valid.', { status: 403 });

  const o = await one<{
    id: string; status: string; total_paise: string; scheme_discount_paise: string;
    credit_terms_days: number; confirmed_at: string | null;
    outlet: string; area: string; region: string; drug_licence: string | null; gstin: string | null;
    rep: string; inv_id: string | null; issued_on: string | null; due_on: string | null;
  }>(
    `SELECT o.id, o.status, o.total_paise, o.scheme_discount_paise, o.credit_terms_days, o.confirmed_at,
            ou.name AS outlet, ou.area, ou.region, ou.drug_licence, ou.gstin, r.name AS rep,
            i.id AS inv_id, to_char(i.issued_on, 'DD Mon YYYY') AS issued_on, to_char(i.due_on, 'DD Mon YYYY') AS due_on
       FROM orders o
       JOIN outlets ou ON ou.id = o.outlet_id
       JOIN reps r ON r.id = o.rep_id
       LEFT JOIN invoices i ON i.order_id = o.id
      WHERE o.id = $1`, [orderId]);
  if (!o) return new Response('No such order.', { status: 404 });
  if (o.status !== 'confirmed' && o.status !== 'dispatched' || !o.inv_id)
    return new Response('This order has no invoice: it has not been accepted.', { status: 409 });

  const lines = await sql<{ name: string; pack_desc: string; qty: number; free_qty: number;
                            unit_price_paise: string; line_total_paise: string }>(
    `SELECT s.name, s.pack_desc, l.qty, l.free_qty, l.unit_price_paise, l.line_total_paise
       FROM order_lines l JOIN skus s ON s.id = l.sku_id
      WHERE l.order_id = $1 ORDER BY l.id`, [orderId]);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${o.inv_id}`);
  pdf.setAuthor('Meridian Healthcare');
  const page = pdf.addPage([595, 842]);               // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.07, 0.09), grey = rgb(0.42, 0.44, 0.48), teal = rgb(0.06, 0.46, 0.43);
  const rs = (p: number | string) => 'Rs. ' + Math.round(Number(p) / 100).toLocaleString('en-IN');
  const text = (t: string, x: number, y: number, o2: { f?: typeof font; s?: number; c?: typeof ink; right?: boolean } = {}) => {
    const f = o2.f ?? font, s = o2.s ?? 10;
    const w = o2.right ? f.widthOfTextAtSize(t, s) : 0;
    page.drawText(t, { x: x - w, y, size: s, font: f, color: o2.c ?? ink });
  };
  const rule = (y: number) => page.drawLine({ start: { x: 48, y }, end: { x: 547, y }, thickness: 0.6, color: rgb(0.85, 0.86, 0.88) });

  let y = 790;
  text('Meridian Healthcare', 48, y, { f: bold, s: 18, c: teal });
  text('INVOICE', 547, y, { f: bold, s: 18, right: true });
  y -= 18;
  text('Field order via the Meridian agent', 48, y, { c: grey, s: 9 });
  text(o.inv_id, 547, y, { right: true, c: grey });

  y -= 40;
  text('Bill to', 48, y, { c: grey, s: 9 });
  text('Issued', 360, y, { c: grey, s: 9 });
  text('Due', 460, y, { c: grey, s: 9 });
  y -= 15;
  text(o.outlet, 48, y, { f: bold, s: 12 });
  text(o.issued_on ?? '', 360, y);
  text(o.due_on ?? '', 460, y, { f: bold });
  y -= 14;
  text(`${o.area}, ${o.region}`, 48, y, { c: grey });
  text(`${o.credit_terms_days} days credit`, 360, y, { c: grey });
  y -= 13;
  if (o.drug_licence) { text(`Drug licence ${o.drug_licence}`, 48, y, { c: grey, s: 9 }); y -= 12; }
  if (o.gstin) { text(`GSTIN ${o.gstin}`, 48, y, { c: grey, s: 9 }); y -= 12; }

  y -= 22;
  text('Item', 48, y, { c: grey, s: 9 });
  text('Qty', 330, y, { c: grey, s: 9, right: true });
  text('Free', 380, y, { c: grey, s: 9, right: true });
  text('Rate', 460, y, { c: grey, s: 9, right: true });
  text('Amount', 547, y, { c: grey, s: 9, right: true });
  y -= 8; rule(y); y -= 16;

  for (const l of lines) {
    text(l.name, 48, y, { f: bold });
    text(String(l.qty), 330, y, { right: true });
    text(l.free_qty ? `+${l.free_qty}` : '', 380, y, { right: true, c: teal });
    text(rs(l.unit_price_paise), 460, y, { right: true });
    text(rs(l.line_total_paise), 547, y, { right: true });
    y -= 12;
    text(l.pack_desc, 48, y, { c: grey, s: 8.5 });
    y -= 18;
  }
  rule(y + 6); y -= 12;
  if (Number(o.scheme_discount_paise) > 0) {
    text('Scheme: free goods included above', 48, y, { c: teal });
    text(`worth ${rs(o.scheme_discount_paise)}`, 547, y, { right: true, c: teal });
    y -= 20;
  }
  text('Total payable', 48, y, { f: bold, s: 13 });
  text(rs(o.total_paise), 547, y, { f: bold, s: 13, right: true });

  y -= 44;
  text(`Order ${o.id}, booked by ${o.rep}.`, 48, y, { c: grey, s: 9 });
  y -= 12;
  text(`Payment is due by ${o.due_on}. Questions: reply to the order email or tell your Meridian rep.`, 48, y, { c: grey, s: 9 });
  y -= 12;
  text('Figures are from the Meridian ledger. No part of this invoice was written by the AI.', 48, y, { c: grey, s: 9 });

  const bytes = await pdf.save();
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="Meridian-${o.inv_id}.pdf"`,
      'cache-control': 'private, max-age=300',
    },
  });
}
