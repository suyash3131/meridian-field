import { LuaTool, Channels } from 'lua-cli';
import { z } from 'zod';
import { get, thisTurn } from '../../lib/api';
import { chemistShop } from '../../lib/chemist';
import { remember } from '../../lib/memory';
import { buttons } from '../../lib/rich';

/**
 * Pass a chemist's message to the people who can act on it: the rep who looks
 * after the shop, copied to his ASM. The agent never acts on a chemist's
 * request itself (no order placed, no price given, nothing changed), because a
 * chemist cannot authorise any of that. It also goes into the shop's memory,
 * so the rep's next brief there mentions it.
 */
export default class MessageRepTool implements LuaTool {
  name = 'message_rep';
  description =
    'A chemist wants something only their rep can do: a new or repeat order, a change, a complaint, a delivery question, ' +
    'a better price, a payment arrangement, or anything else. Passes their message on and tells them it went.';
  inputSchema = z.object({
    topic: z.enum(['order_request', 'complaint', 'delivery', 'price', 'payment', 'other']).describe('What it is about.'),
    shop: z.string().optional().describe('Only if they named one of their shops.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const s = await chemistShop(input.shop);
    if ('ask' in s)
      return { sendExactly: `${s.ask}\n\n${s.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}` + buttons(s.options),
               nextStep: 'Send sendExactly word for word and stop.' };
    const words = (await thisTurn()).text;
    const r = await get<any>(`/api/chemist/relay?outletId=${encodeURIComponent(s.id)}`);
    if (r.error) return { sendExactly: 'Thank you. I could not find your rep just now; Meridian will contact you.', nextStep: 'Send sendExactly word for word and stop.' };

    const label = { order_request: 'Order request', complaint: 'Complaint', delivery: 'Delivery question', price: 'Price request', payment: 'Payment', other: 'Message' }[input.topic];
    let sent = false;
    if (r.rep_email) {
      try {
        await Channels.email.send({
          to: { email: r.rep_email },
          cc: r.asm_email ? [r.asm_email] : undefined,
          subject: `${label} from ${r.shop}`,
          text: `${r.rep},\n\n${r.shop} wrote to Meridian:\n\n"${words}"\n\nNothing has been done about it: this needs you. ` +
                (input.topic === 'order_request' ? 'If it is an order, send it to the agent as usual and the shop gets its confirmation.' : '') +
                `\n\nMeridian Healthcare`,
        });
        sent = true;
      } catch (e) { console.log('message_rep not sent', String(e)); }
    }
    await remember({ outletId: s.id, outlet: s.name, kind: 'chemist', text: `${label}: ${words}`, by: `${s.name} (chemist)` });
    return {
      sendExactly: sent
        ? `Thank you. I've passed this to ${r.rep}, your Meridian rep${r.asm ? `, and to ${r.asm}` : ''}. ${input.topic === 'order_request' ? 'Your order is not placed until your rep confirms it; you will get a confirmation email with the invoice when it is.' : 'They will get back to you.'}`
        : `Thank you. I've noted this for ${r.rep}, your Meridian rep, who will get back to you.`,
      nextStep: 'Send sendExactly word for word and stop.',
    };
  }
}
