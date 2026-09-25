import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { post, askText, afterAnswer, repLang } from '../../lib/api';
import { tr, replyIn } from '../../lib/say';
import { sent } from '../../lib/guard';

/**
 * The rep said no to the read-back. The model does not decide whether that
 * means cancel or change: the rep does, by tapping Change or Cancel on the
 * slip, or from two numbered options built here when he only typed "no".
 */
export default class DeclineOrderTool implements LuaTool {
  name = 'decline_order';
  description =
    'The rep tapped Change or Cancel on a read-back, or said no ("no", "nahi", "mat karo", ' +
    '"cancel", "galat hai") without saying what to change. If he did say what to change ' +
    '("nahi, 2 hi chahiye"), call draft_order again instead.';

  inputSchema = z.object({
    draftId: z.string().describe('The draftId of the read-back he said no to.'),
    pick: z.enum(['change', 'cancel']).optional().describe(
      'Only when he tapped a slip button: "change" for Change / बदलें, "cancel" for Cancel / रद्द करें. ' +
      'Leave it out when he just typed no, so he is asked which he means.'
    ),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const result = await post('/api/agent/decline', { draftId: input.draftId });
    const lang = await repLang();
    if (result.kind !== 'question')
      return { error: tr(result.message ?? 'that order is no longer open', lang), replyIn: replyIn(lang) };
    // A tap already said which: answer the decline's question for him.
    if (input.pick)
      return sent(afterAnswer(await post('/api/agent/answer', { draftId: input.draftId, pick: input.pick }), lang));
    return sent(askText(result.draftId, result.question, result.options, lang));
  }
}
