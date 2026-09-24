import { LuaTool, Lua } from 'lua-cli';
import { z } from 'zod';
import { post, currentRep } from '../../lib/api';
import { remember } from '../../lib/memory';

/**
 * A rival seen at a counter, as data. From a message ("Cipla 10+3 de raha hai
 * Sharma pe"), a voice note, or a photo of a rival's scheme leaflet. The model
 * reads brand / product / offer; the CRM matches the shop and which of our
 * products it hits, stores the rep's words beside the reading, and the
 * manager's competitor_watch counts it from then on.
 */
export default class NoteCompetitorTool implements LuaTool {
  name = 'note_competitor';
  description =
    'Record a rival brand\'s offer or activity a rep saw at a counter: a scheme, a discount, a shelf taken, a leaflet photo. ' +
    'Use it alongside an order or on its own whenever a rival brand is named. If the counter gave no order because of it, use log_visit instead.';

  inputSchema = z.object({
    shop: z.string().describe('The counter, as the rep named it.'),
    brand: z.string().describe('The rival company or brand, e.g. "Cipla".'),
    product: z.string().optional().describe('Their product, e.g. "paracetamol 650".'),
    offer: z.string().optional().describe('The offer exactly as stated, e.g. "10+3", "20% off".'),
    ourProduct: z.string().optional().describe('The Meridian product it competes with, if the rep said.'),
    words: z.string().describe('What the rep said about it, verbatim.'),
    fromPhoto: z.boolean().optional().describe('True if read from a photo of a leaflet or shelf.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const rep = await currentRep();
    const r = await post<any>('/api/agent/competitor', {
      repId: rep.id, shopPhrase: input.shop, brand: input.brand, product: input.product, offer: input.offer,
      ourProduct: input.ourProduct, raw: input.words, source: input.fromPhoto ? 'photo' : 'rep',
    });
    if (r.error) return { error: r.error, options: r.options ?? null };
    await remember({ outletId: r.outletId, outlet: r.outlet, kind: 'competitor', text: input.words, by: rep.name,
                    gist: `rival competitor ${input.brand}${input.offer ? ` offering ${input.offer}` : ''}${input.product ? ` on ${input.product}` : ''}` });
    const spread = r.countersThisWeek > 1 ? ` ${r.brand} is at ${r.countersThisWeek} counters this week.` : '';
    return {
      sendExactly: `Noted: ${r.brand}${input.offer ? ` ${input.offer}` : ''} at ${r.outlet}.${spread} Your ASM sees it tonight. ✓`,
      nextStep: 'Send sendExactly word for word and stop.',
      threadId: Lua.request?.threadId,
    };
  }
}
