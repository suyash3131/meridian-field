import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { get, currentRep } from '../../lib/api';
import { remember } from '../../lib/memory';

/**
 * Something worth knowing next time about a shop that is not an order or a
 * rival: "owner only after 4pm", "wants delivery before 11", "complained the
 * last batch came late". It comes back in that shop's brief, and a manager can
 * find it by meaning.
 */
export default class RememberTool implements LuaTool {
  name = 'remember_note';
  description =
    'Save a remark about a shop for next time: a preference, a complaint, timing, anything a rep would want to know on the next visit. ' +
    'Not for orders, not for rivals (note_competitor), not for no-order visits (log_visit).';

  inputSchema = z.object({
    shop: z.string().describe('The counter, as the rep named it.'),
    note: z.string().min(3).describe('The remark, in the rep\'s words.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const rep = await currentRep();
    const r = await get<any>(`/api/agent/outlet?q=${encodeURIComponent(input.shop)}&repId=${encodeURIComponent(rep.id)}`);
    if (r.status !== 'resolved') return { notFound: true, reason: r.reason, options: r.candidates ?? null };
    await remember({ outletId: r.outlet.id, outlet: r.outlet.name, region: r.outlet.region, kind: 'remark', text: input.note, by: rep.name });
    return { sendExactly: `Remembered for ${r.outlet.name}. ✓`, nextStep: 'Send sendExactly word for word and stop.' };
  }
}
