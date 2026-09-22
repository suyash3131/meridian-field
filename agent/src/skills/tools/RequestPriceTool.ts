import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { post, currentRep, repLang } from '../../lib/api';
import { tr, replyIn, priceAskText } from '../../lib/say';

/**
 * The shop wants a better price. This agent never gives one: the ask goes to
 * the rep's ASM in his words, and every price stays as the CRM set it.
 */
export default class RequestPriceTool implements LuaTool {
  name = 'request_price_exception';
  description =
    'The shop or rep wants a discount or a better rate ("10% off do", "rate kam karo", ' +
    '"extra scheme chahiye"). Sends the ask to his ASM. You never change a price yourself.';

  inputSchema = z.object({
    ask: z.string().describe('What he asked for, in his own words, copied exactly.'),
    shop: z.string().optional().describe('The counter he named, if he named one ("apollo", "sharma medical").'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const rep = await currentRep();
    const r = await post('/api/agent/price', { repId: rep.id, ...input });
    const lang = await repLang();
    if (r.kind !== 'sent')
      return { error: r.message, sendExactly: tr(r.message ?? 'could not send that', lang), replyIn: replyIn(lang),
               nextStep: 'Send sendExactly word for word and stop.' };
    return {
      sent: true,
      sendExactly: priceAskText(r.outlet, input.ask, r.onDraft, lang),
      nextStep: r.onDraft
        ? 'Send sendExactly word for word and stop. His read-back is still open: if he then says yes, confirm it at the price shown.'
        : 'Send sendExactly word for word and stop.',
    };
  }
}
