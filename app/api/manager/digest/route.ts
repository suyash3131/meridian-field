import { NextResponse } from 'next/server';
import { sql, one, rs } from '@/lib/db';
import { answerFor } from '@/lib/analysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The eight o'clock email, one per manager, built here in full.
 *
 * It is the answer to the question every ASM asks at the end of the day, sent
 * before they ask it: what happened today, is the week going to land, why not,
 * and what is waiting on me. The Lua job that sends it at 8pm only delivers;
 * every figure and every line is written here from the ledger, the same way
 * the dashboard and the agent's territory answer are.
 */
export async function GET() {
  const managers = await sql<{ id: string; name: string; role: string; region: string | null; email: string }>(
    `SELECT id, name, role, region, email FROM managers WHERE email IS NOT NULL ORDER BY id`);

  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const emails = [];

  for (const m of managers) {
    const region = m.region;                       // null = the regional head, sees everything
    const scope = region ?? 'all regions';

    const today = await one<{ orders: string; value: string; counters: string; held: string }>(
      `SELECT COUNT(*) FILTER (WHERE o.status IN ('confirmed','dispatched'))               AS orders,
              COALESCE(SUM(o.total_paise) FILTER (WHERE o.status IN ('confirmed','dispatched')), 0) AS value,
              COUNT(DISTINCT o.outlet_id)                                                  AS counters,
              COUNT(*) FILTER (WHERE o.status = 'held_credit')                             AS held
         FROM orders o JOIN reps r ON r.id = o.rep_id
        WHERE o.created_at >= current_date AND ($1::text IS NULL OR r.region = $1)`, [region]);

    // Grouped per counter and kind: six holds at one shop are one decision.
    const waiting = await sql<{ kind: string; outlet: string | null; rep: string | null; n: number; days: number; reason: string }>(
      `SELECT a.kind, ou.name AS outlet, MIN(r.name) AS rep, COUNT(*)::int AS n,
              MAX(EXTRACT(DAY FROM now() - a.created_at))::int AS days,
              (ARRAY_AGG(a.reason ORDER BY a.created_at DESC))[1] AS reason
         FROM approvals a
         LEFT JOIN outlets ou ON ou.id = a.outlet_id
         LEFT JOIN reps r     ON r.id = a.requested_by
        WHERE a.status = 'pending'
          AND (a.assigned_to = $1 OR ($2::text IS NULL))
        GROUP BY a.kind, ou.name
        ORDER BY MAX(now() - a.created_at) DESC LIMIT 8`, [m.id, region]);

    const a = await answerFor(region);

    // Rivals seen this week, per brand: the counters and the offers reps named.
    const rivals = await sql<{ brand: string; counters: number; offers: string[]; ours: string[] }>(
      `SELECT c.brand, count(DISTINCT c.outlet_id)::int AS counters,
              COALESCE(array_agg(DISTINCT c.offer) FILTER (WHERE c.offer IS NOT NULL), '{}') AS offers,
              COALESCE(array_agg(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL), '{}') AS ours
         FROM competitor_intel c JOIN outlets ou ON ou.id = c.outlet_id LEFT JOIN skus s ON s.id = c.our_sku_id
        WHERE c.seen_at >= now() - interval '7 days' AND ($1::text IS NULL OR ou.region = $1)
        GROUP BY c.brand ORDER BY 2 DESC LIMIT 3`, [region]);
    const rivalLine = (r: { brand: string; counters: number; offers: string[]; ours: string[] }) =>
      `${r.brand} at ${r.counters} counter${r.counters === 1 ? '' : 's'}` +
      (r.offers.length ? `, offering ${r.offers.join(', ')}` : '') + (r.ours.length ? ` against our ${r.ours.join(', ')}` : '');
    const KIND: Record<string, string> = {
      credit_override: 'Over credit limit', price_exception: 'Asking for a better price',
      order_change: 'Change to a placed order', return: 'Return',
    };

    const p = (t: string) => `<p style="margin:0 0 12px">${t}</p>`;
    const li = (t: string) => `<li style="margin:0 0 8px">${t}</li>`;
    const html =
      `<div style="font:14px/1.5 -apple-system,Segoe UI,sans-serif;color:#111;max-width:600px">` +
      p(`${esc(m.name.split(' ')[0])}, here is ${esc(scope)} at 8pm.`) +
      `<h3 style="margin:20px 0 8px;font-size:15px">Today</h3>` +
      p(`${today?.orders ?? 0} orders placed, ${rs(today?.value)}, across ${today?.counters ?? 0} counters.` +
        (Number(today?.held) ? ` ${today?.held} held for credit.` : '')) +
      `<h3 style="margin:20px 0 8px;font-size:15px">This week</h3>` +
      p(`<b>${esc(a.headline)}</b>`) +
      (a.findings.length ? `<ul style="padding-left:18px;margin:0 0 12px">${a.findings.map((f) => li(esc(f.headline))).join('')}</ul>` : '') +
      (a.biggestLever ? p(`<b>First thing tomorrow:</b> ${esc(a.biggestLever)}`) : '') +
      `<h3 style="margin:20px 0 8px;font-size:15px">Waiting on you</h3>` +
      (waiting.length
        ? `<ul style="padding-left:18px;margin:0 0 12px">${waiting.map((w) =>
            li(`<b>${esc(w.outlet ?? '')}</b>: ${esc(KIND[w.kind] ?? w.kind).toLowerCase()}` +
               (w.n > 1 ? `, ${w.n} requests` : '') + (w.rep ? ` from ${esc(w.rep)}` : '') + '. ' +
               (w.n > 1 ? 'Latest: ' : '') + `${esc(w.reason)} ` +
               `<span style="color:#889">(${w.n > 1 ? 'oldest ' : ''}${w.days === 0 ? 'today' : w.days === 1 ? '1 day' : `${w.days} days`})</span>`)).join('')}</ul>`
        : p('Nothing.')) +
      (rivals.length
        ? `<h3 style="margin:20px 0 8px;font-size:15px">Rivals this week</h3>` +
          `<ul style="padding-left:18px;margin:0 0 12px">${rivals.map((r) => li(esc(rivalLine(r)))).join('')}</ul>`
        : '') +
      p(`<span style="color:#667">Reply to this email to act or ask: <b>what's waiting</b> for the list to approve, ` +
        `<b>approve all sharma</b>, <b>what are competitors doing</b>, <b>which shops complained about expiry</b>.</span>`) +
      `</div>`;

    emails.push({
      managerId: m.id,
      to: m.email,
      subject: `8pm · ${scope}: ${a.headline.replace(/^.*? is /, '')}`,
      html,
      text: [
        `${m.name.split(' ')[0]}, here is ${scope} at 8pm.`,
        `TODAY\n${today?.orders ?? 0} orders placed, ${rs(today?.value)}, across ${today?.counters ?? 0} counters.` +
          (Number(today?.held) ? ` ${today?.held} held for credit.` : ''),
        `THIS WEEK\n${a.headline}\n` + a.findings.map((f) => `- ${f.headline}`).join('\n') +
          (a.biggestLever ? `\nFirst thing tomorrow: ${a.biggestLever}` : ''),
        `WAITING ON YOU\n` + (waiting.length
          ? waiting.map((w) => `- ${w.outlet ?? ''}: ${(KIND[w.kind] ?? w.kind).toLowerCase()}${w.n > 1 ? `, ${w.n} requests` : ''}. ${w.reason}`).join('\n')
          : 'Nothing.'),
        ...(rivals.length ? [`RIVALS THIS WEEK\n` + rivals.map((r) => `- ${rivalLine(r)}`).join('\n')] : []),
        `Reply to this email to act or ask: "what's waiting", "approve all sharma", "what are competitors doing".`,
      ].join('\n\n'),
    });
  }

  return NextResponse.json({ emails });
}
