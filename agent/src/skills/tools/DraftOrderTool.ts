import { LuaTool, Lua } from 'lua-cli';
import { z } from 'zod';
import { post, currentRep, readBack, askText } from '../../lib/api';

/**
 * Turn what the rep said into a priced, checked order — or into exactly one
 * question.
 *
 * Note what this schema cannot express: a price, a discount, a SKU code, a
 * credit decision, or a location. The model has no way to supply any of them,
 * so it has no way to get them wrong. It hands over the rep's own words and
 * the server does the rest.
 */
export default class DraftOrderTool implements LuaTool {
  name = 'draft_order';
  description =
    'Price and check an order the rep just described at a counter. Use this the moment a ' +
    'message names a shop and at least one product. Returns either a ready order to confirm, ' +
    'or one question to put to the rep.';

  inputSchema = z.object({
    shop: z.string().describe(
      'The counter name exactly as the rep typed it, e.g. "sharma medical". ' +
      'Do not correct the spelling or expand it — the resolver is built for his words.'
    ),
    items: z.array(z.object({
      product: z.string().describe(
        'The product exactly as the rep typed it, e.g. "650 tablets", "baby lotion". ' +
        'Never substitute a full product name or a pack size he did not say.'
      ),
      qty: z.number().int().positive().describe('How many, as a number. "2 box" is 2.'),
    })).min(1),
    creditDays: z.number().int().positive().optional().describe(
      'Only if the rep mentioned terms, e.g. "15 days" or "he wants a month" (30).'
    ),
    repId: z.string().optional().describe(
      'Only on the very first message of a conversation, and only if the rep view supplied it.'
    ),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const rep = await currentRep(input.repId);
    const result = await post('/api/agent/draft', {
      repId: rep.id,
      shopPhrase: input.shop,
      items: input.items.map((i) => ({ phrase: i.product, qty: i.qty })),
      creditDays: input.creditDays,
      threadId: Lua.request?.threadId,
      rawMessage: `${input.shop} ${input.items.map((i) => `${i.qty} ${i.product}`).join(', ')}`,
    });

    // Everything below is formatting. No number is recomputed here.
    if (result.kind === 'draft') return readBack(result.draftId, result.summary);

    if (result.kind === 'question' || result.kind === 'duplicate')
      return askText(result.draftId, result.question, result.options);

    if (result.kind === 'parked')
      return { parked: true, tellRep: result.message };

    return { error: result.message ?? 'could not build that order' };
  }
}
