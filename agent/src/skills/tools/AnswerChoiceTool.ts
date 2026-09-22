import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { post, readBack, askText, repLang } from '../../lib/api';
import { tr, replyIn } from '../../lib/say';

/** The rep answered the one question. Feed his choice back and finish. */
export default class AnswerChoiceTool implements LuaTool {
  name = 'answer_choice';
  description =
    'Send the rep\'s answer to a question draft_order asked. Use it when he replies with a ' +
    'number, a name, or "same"/"new" to a duplicate check.';

  inputSchema = z.object({
    draftId: z.string().describe('The draftId from the question you asked.'),
    pick: z.string().describe(
      'The option key he chose, from the options list. If he replied "1", send the first ' +
      'option\'s key, not the digit.'
    ),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const result = await post('/api/agent/answer', input);

    const lang = await repLang();
    if (result.kind === 'draft') return readBack(result.draftId, result.summary, lang);
    if (result.kind === 'question' || result.kind === 'duplicate')
      return askText(result.draftId, result.question, result.options, lang);
    if (result.kind === 'parked') return { parked: true, sendExactly: tr(result.message, lang) };
    if (result.kind === 'cancelled')
      return { cancelled: true, sendExactly: tr(result.message, lang),
               nextStep: 'Send sendExactly word for word and stop. This order is closed.' };
    if (result.kind === 'change')
      return {
        sendExactly: tr(result.message, lang), replyIn: replyIn(lang),
        nextStep:
          'Send sendExactly word for word and stop. His next message is the change. Call ' +
          'draft_order for the same counter with the whole order as it now stands: the lines ' +
          'you read back, with his change applied. Put his new message in message.',
      };
    return { error: tr(result.message ?? 'that answer did not fit the question', lang), replyIn: replyIn(lang) };
  }
}
