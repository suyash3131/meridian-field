import { LuaTool, Lua } from 'lua-cli';
import { z } from 'zod';
import { post, currentRep, repLang } from '../../lib/api';
import { notedText, replyIn, tr } from '../../lib/say';
import { remember } from '../../lib/memory';

/**
 * A counter that gave no order today.
 *
 * Roughly a third of calls end this way, and they are not blanks. "Cipla gave
 * him 10+3" is how a company finds out it is losing a shelf a month before the
 * order book says so. A reason is required: a no-order visit with no reason is
 * indistinguishable from a rep at home tapping a button, so the reason IS the
 * evidence, and the server rejects the call without one.
 */
export default class LogVisitTool implements LuaTool {
  name = 'log_visit';
  description =
    'Record a counter the rep called on that gave no order, or where he noticed something — ' +
    'a rival scheme, a product run out, stock near expiry. Use it whenever he names a shop ' +
    'and says why there is nothing to order. Never use it when he has given you an order.';

  inputSchema = z.object({
    shop: z.string().describe('The counter name exactly as the rep typed it.'),
    outcome: z.enum(['no_order', 'competitor', 'stock_note']).describe(
      'competitor if a rival brand is named; stock_note if it is about shelf stock or expiry; ' +
      'otherwise no_order.'
    ),
    reason: z.string().min(3).describe(
      'What the rep actually said, in his words. "stock bhara hai", "Cipla ne 10+3 diya". ' +
      'Never write "no order" alone — that records nothing.'
    ),
    repId: z.string().optional().describe('Only on the first message of a conversation.'),
    rivalBrand: z.string().optional().describe('For outcome competitor: the rival brand named, e.g. "Cipla".'),
    rivalOffer: z.string().optional().describe('For outcome competitor: the offer as stated, e.g. "10+3".'),
    rivalProduct: z.string().optional().describe('For outcome competitor: their product, if named.'),
    gist: z.string().optional().describe('The reason in 3 to 10 plain English words, e.g. "old batch near expiry, wants return".'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const rep = await currentRep(input.repId);
    const r = await post('/api/agent/visit', {
      repId: rep.id,
      shopPhrase: input.shop,
      outcome: input.outcome,
      reason: input.reason,
      threadId: Lua.request?.threadId,
      rawMessage: `${input.shop} — ${input.reason}`,
    });
    const lang = await repLang();
    if (r.error)
      return { error: tr(r.error, lang), options: r.options ?? null, replyIn: replyIn(lang) };

    // The reason is what the next rep at this counter should know. A named
    // rival also becomes a structured sighting the manager can count.
    if (r.outletId) {
      await remember({ outletId: r.outletId, outlet: r.outlet, region: r.region, kind: input.outcome === 'competitor' ? 'competitor' : 'no_order',
                       text: input.reason, gist: input.gist, by: rep.name });
      if (input.outcome === 'competitor' && input.rivalBrand)
        await post('/api/agent/competitor', { repId: rep.id, outletId: r.outletId, brand: input.rivalBrand,
          offer: input.rivalOffer, product: input.rivalProduct, raw: input.reason }).catch(() => null);
    }
    return {
      recorded: true,
      counter: r.outlet,
      evidence: r.verification,
      offRoute: !r.onBeat,
      sendExactly: notedText(r.outlet, lang),
      nextStep: 'Send sendExactly to the rep word for word and stop. Say nothing about the route or the evidence.',
    };
  }
}
