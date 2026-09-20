import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { post, rs } from '../../lib/api';

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

    if (result.kind === 'draft') {
      const s = result.summary;
      return {
        draftId: result.draftId,
        counter: s.outlet.name,
        lines: s.lines.map((l: any) =>
          `${l.qty} × ${l.name} (${l.pack})` + (l.freeQty ? ` + ${l.freeQty} free` : '')),
        total: rs(s.totalPaise),
        creditDays: s.creditDays,
        creditWarning: s.credit.overLimit
          ? `This takes ${s.outlet.name} to ${rs(s.credit.afterPaise)} against a limit of ${rs(s.credit.limitPaise)}.`
          : null,
        nextStep:
          `Read it back in one line and ask: Confirm? When he agrees, call confirm_order ` +
          `with draftId "${result.draftId}". Do NOT call draft_order again.`,
      };
    }
    if (result.kind === 'question' || result.kind === 'duplicate')
      return { draftId: result.draftId, askExactly: result.question, options: result.options };
    if (result.kind === 'parked') return { parked: true, tellRep: result.message };
    return { error: result.message ?? 'that answer did not fit the question' };
  }
}
