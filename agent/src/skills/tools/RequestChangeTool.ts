import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { post, currentRep, repLang } from '../../lib/api';
import { tr, replyIn, changeSentText } from '../../lib/say';

/**
 * The rep wants to fix an order he already placed. Nothing is edited here:
 * the request goes to his ASM, in his words, and the order stands until then.
 */
export default class RequestChangeTool implements LuaTool {
  name = 'request_order_change';
  description =
    'The rep wants to change or cancel an order he ALREADY PLACED ("Done" was sent): ' +
    '"3 nahi 2 tha", "galti ho gayi", "cancel that order". Sends it to his ASM. ' +
    'Never use draft_order to fix a placed order: that makes a second order.';

  inputSchema = z.object({
    change: z.string().describe('What he wants changed, in his own words, copied exactly.'),
    orderId: z.string().optional().describe('The orderId from confirm_order, if you have it.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const rep = await currentRep();
    const r = await post('/api/agent/change', { repId: rep.id, ...input });
    const lang = await repLang();
    if (r.kind !== 'sent')
      return { error: tr(r.message ?? 'could not send that', lang), replyIn: replyIn(lang) };
    return {
      sent: true,
      sendExactly: changeSentText(r.outlet, r.totalPaise, lang),
      nextStep: 'Send sendExactly word for word and stop. Do not draft a new order.',
    };
  }
}
