import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { post, rs, repLang } from '../../lib/api';
import { placedText, heldText, alreadyText, tr } from '../../lib/say';
import { sendOrderMail } from '../../lib/mail';
import { reaction, documentBlock } from '../../lib/rich';

/**
 * Commit the order the rep just confirmed.
 *
 * This writes the visit too, in the same code path. That is the whole design:
 * attendance is what is left behind by doing real work at a real counter, and
 * there is deliberately no tool anywhere in this agent that records a visit on
 * its own. A rep cannot say he was somewhere; he can only have been there.
 */
export default class ConfirmOrderTool implements LuaTool {
  name = 'confirm_order';
  description =
    'Place the order once the rep has said yes. Only call this after he has confirmed — ' +
    'never on your own initiative, and never to "save time".';

  inputSchema = z.object({
    draftId: z.string().describe('The draftId of the order he just confirmed.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const r = await post('/api/agent/confirm', input);
    const lang = await repLang();
    // What happened to a draft that is no longer open: cancelled, or with the ASM.
    if (r.error) return { error: r.error, sendExactly: tr(r.error, lang),
                          nextStep: 'Send sendExactly word for word and stop.' };

    // A second yes for an order that already went through. Nothing new is placed.
    if (r.already)
      return {
        alreadyPlaced: true,
        orderId: r.orderId,
        sendExactly: alreadyText(r.totalPaise, r.status === 'held_credit', lang, r.outlet),
        nextStep: 'Send sendExactly word for word and stop. Nothing new was placed.',
      };

    // Only a first confirmation gets here, so each order emails at most once.
    const mailed = await sendOrderMail(r.orderId, r.status === 'held_credit' ? 'held' : 'placed');

    if (r.status === 'held_credit')
      return {
        placed: false,
        held: true,
        orderId: r.orderId,
        total: rs(r.totalPaise),
        sendExactly: heldText(r.totalPaise, lang, r.outlet) +
          (mailed.asm ? (lang === 'hi' ? ' ASM को ईमेल भेजा, वे जवाब में approve कर सकते हैं।' : ' Your ASM has it by email and can approve it with a reply.') : ''),
        nextStep: 'Send sendExactly word for word and stop. Do not offer to override this: you cannot, and neither can the rep.',
      };

    return {
      placed: true,
      orderId: r.orderId,
      total: rs(r.totalPaise),
      // The ✅ lands on his "haan"; the invoice arrives as a file he can forward.
      sendExactly: placedText(r.totalPaise, lang, r.outlet) +
        (mailed.chemist ? (lang === 'hi' ? ' दुकान को ईमेल से पुष्टि और इनवॉइस भेजा।' : ' Confirmation and invoice emailed to the shop.') : '') +
        (mailed.invoiceUrl ? documentBlock(lang === 'hi' ? 'इनवॉइस' : 'Invoice', mailed.invoiceUrl, `Meridian-${r.orderId}.pdf`) : '') +
        reaction('✅'),
      nextStep: 'Send sendExactly to the rep word for word and stop.',
    };
  }
}
