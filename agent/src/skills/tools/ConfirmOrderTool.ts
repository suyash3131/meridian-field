import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { post, rs } from '../../lib/api';

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
    if (r.error) return { error: r.error };

    if (r.status === 'held_credit')
      return {
        placed: false,
        held: true,
        orderId: r.orderId,
        total: rs(r.totalPaise),
        tellRep:
          `Saved — ${rs(r.totalPaise)}. It crosses this counter's credit limit, so it has gone ` +
          `to your ASM for approval. Visit recorded. Move on.`,
        note: 'Do not offer to override this. You cannot, and neither can the rep.',
      };

    return {
      placed: true,
      orderId: r.orderId,
      total: rs(r.totalPaise),
      tellRep: `Done — ${rs(r.totalPaise)}. Visit recorded.`,
    };
  }
}
