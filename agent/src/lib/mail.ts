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
      await Channels.email.send({ to: { email: e.to }, subject: e.subject, html: e.html });
      sent[who] = e.to;
    } catch { /* left unsent; the reply will not claim it went */ }
  }
  return sent;
}
