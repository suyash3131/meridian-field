import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { get } from '../../lib/api';
import { noteShown } from '../../lib/guard';

/** What is stopped, waiting on a person. */
export default class PendingApprovalsTool implements LuaTool {
  name = 'pending_approvals';
  description =
    'List the orders held at a credit limit and anything else waiting on a manager\'s ' +
    'decision. Use it when someone asks what needs them, what is stuck, or what is waiting.';

  inputSchema = z.object({});

  async execute() {
    const p = await get('/api/manager/pulse');
    const out = {
      waiting: (p.approvals ?? []).map((a: any) => ({
        counter: a.outlet, rep: a.rep,
        worth: '₹' + Math.round(Number(a.value) / 100).toLocaleString('en-IN'),
        waitingDays: a.age_days, why: a.reason,
      })),
      // Stated plainly so the model does not offer to do it.
      note: 'You cannot approve any of these. Say what is waiting and how long, and stop there.',
    };
    // "value" is paise but not named so; the reply check must still know these came from the CRM.
    await noteShown(out.waiting);
    return out;
  }
}
