import { Channels } from 'lua-cli';
import { get, post } from './api';

/**
 * Send the emails an order owes, through Lua's own email channel.
 *
 * The CRM writes them (/api/agent/order-mail) and this only delivers, so the
 * model never composes a word of anything a chemist, manager or rep receives.
 * A failed send never undoes an order: the order is the record and the email
 * is a courtesy about it. The reply says what actually went out, nothing more.
 *
 * Each email goes with its plain-text part and any attachment (the invoice PDF,
 * which Lua fetches from a signed CRM link). The first email about an order has
 * its Message-ID stored; every later one about it replies to that, so mail
 * clients keep the order's story in one thread.
 */
export type OrderEvent = 'placed' | 'held' | 'approved' | 'rejected';
type Who = 'chemist' | 'asm' | 'rep';

export async function sendOrderMail(orderId: string, event?: OrderEvent):
    Promise<Partial<Record<Who, string>> & { invoiceUrl?: string }> {
  const sent: Partial<Record<Who, string>> & { invoiceUrl?: string } = {};
  let m: any;
  try { m = await get(`/api/agent/order-mail?orderId=${encodeURIComponent(orderId)}${event ? `&event=${event}` : ''}`); }
  catch { return sent; }
  if (m?.invoiceUrl) sent.invoiceUrl = m.invoiceUrl;
  let root: string | undefined = m?.threadRoot ?? undefined;

  for (const e of (m?.emails ?? []) as any[]) {
    if (!e?.to) continue;
    try {
      const r = await Channels.email.send({
        to: { email: e.to },
        cc: e.cc,
        subject: e.subject,
        html: e.html,
        text: e.text,
        attachments: e.attachments,
        ...(root ? { inReplyTo: root, references: [root] } : {}),
      });
      // Accepted is not arrived. Wait a moment for the first receipt, log both,
      // and only claim the email went if nothing has already reported it failed.
      await new Promise((ok) => setTimeout(ok, 2500));
      const later = await Channels.getStatus(r.deliveryId).catch(() => null);
      console.log(`order-mail ${event ?? ''} ${e.who} → ${e.to}: sent as ${r.status}, now ${later?.status ?? 'unknown'}`,
                  later?.error ? JSON.stringify(later.error) : '');
      if (r.status !== 'failed' && later?.status !== 'failed') {
        sent[e.who as Who] = e.to;
        if (!root && r.messageId) {
          root = r.messageId;
          await post('/api/agent/order-mail', { orderId, messageId: r.messageId }).catch(() => {});
        }
      }
    } catch (err) {
      console.log(`order-mail ${e.who} → ${e.to}: not sent`, String(err));
    }
  }
  return sent;
}
