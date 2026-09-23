import { Channels } from 'lua-cli';
import { get } from './api';

/**
 * Send the emails an order owes, through Lua's own email channel.
 *
 * The CRM writes them (/api/agent/order-mail) and this only delivers, so the
 * model never composes a word of anything a chemist or a manager receives.
 * A failed send never undoes an order: the order is the record and the email
 * is a courtesy about it. The reply says what actually went out, nothing more.
 */
export async function sendOrderMail(orderId: string): Promise<{ chemist?: string; asm?: string }> {
  const sent: { chemist?: string; asm?: string } = {};
  let m: any;
  try { m = await get(`/api/agent/order-mail?orderId=${encodeURIComponent(orderId)}`); }
  catch { return sent; }

  for (const who of ['chemist', 'asm'] as const) {
    const e = m?.[who];
    if (!e?.to) continue;
    try {
      const r = await Channels.email.send({ to: { email: e.to }, subject: e.subject, html: e.html });
      // Accepted is not arrived. Wait a moment for the first receipt, log both,
      // and only claim the email went if nothing has already reported it failed.
      await new Promise((ok) => setTimeout(ok, 2500));
      const later = await Channels.getStatus(r.deliveryId).catch(() => null);
      console.log(`order-mail ${who} → ${e.to}: sent as ${r.status}, now ${later?.status ?? 'unknown'}`,
                  later?.error ? JSON.stringify(later.error) : '');
      if (r.status !== 'failed' && later?.status !== 'failed') sent[who] = e.to;
    } catch (err) {
      console.log(`order-mail ${who} → ${e.to}: not sent`, String(err));
    }
  }
  return sent;
}
