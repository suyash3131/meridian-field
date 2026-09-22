import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { post, askText, repLang } from '../../lib/api';
import { tr, replyIn } from '../../lib/say';

/**
 * The rep said no to the read-back. The model does not decide whether that
 * means cancel or change: the rep does, from two numbered options built here.
 */
export default class DeclineOrderTool implements LuaTool {
  name = 'decline_order';
  description =
    'The rep said no to a read-back ("no", "nahi", "mat karo", "cancel", "galat hai") ' +
    'without saying what to change. If he did say what to change ("nahi, 2 hi chahiye"), ' +
    'call draft_order again instead.';

  inputSchema = z.object({
    draftId: z.string().describe('The draftId of the read-back he said no to.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const result = await post('/api/agent/decline', input);
    const lang = await repLang();
    if (result.kind === 'question') return askText(result.draftId, result.question, result.options, lang);
    return { error: tr(result.message ?? 'that order is no longer open', lang), replyIn: replyIn(lang) };
  }
}
