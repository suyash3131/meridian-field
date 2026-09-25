import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { post, afterAnswer, repLang } from '../../lib/api';
import { sent } from '../../lib/guard';

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
    return sent(afterAnswer(result, await repLang()));
  }
}
