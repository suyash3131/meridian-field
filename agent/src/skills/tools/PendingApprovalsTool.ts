import { LuaTool, User } from 'lua-cli';
import { z } from 'zod';
import { get, rs, currentManager } from '../../lib/api';
import { noteShown } from '../../lib/guard';
import { waiting, groupList, itemList } from '../../lib/decisions';

/**
 * What is stopped, waiting on this manager: one line per shop (six holds at
 * one counter are one decision), or, for "show each", that shop's requests
 * one by one. What was shown is saved on the conversation, so "approve 2"
 * later means the second line this manager saw, decided in code.
 */
export default class PendingApprovalsTool implements LuaTool {
  name = 'pending_approvals';
  description =
    'List what is waiting on this manager: orders held at a credit limit, changes and better prices reps asked for. ' +
    'Use it when a manager asks what needs them, what is stuck, on hold or waiting, and when they tap "Show each" ' +
    '(pass eachFor with the shop).';

  inputSchema = z.object({
    eachFor: z.string().optional().describe('Only for "show each": the shop whose requests to list one by one.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    let mgr: { id: string } | null = null;
    try { mgr = await currentManager(); } catch { /* the unverified dashboard widget */ }

    if (!mgr) {
      // Read-only on the dashboard: nobody there is verified, so nobody decides there.
      const p = await get('/api/manager/pulse');
      const out = {
        waiting: (p.approvals ?? []).map((a: any) => ({
          counter: a.outlet, rep: a.rep, worth: rs(Number(a.value)), waitingDays: a.age_days, why: a.reason,
        })),
        note: 'Say what is waiting and how long, and stop. Decisions are taken by the manager replying from their own email or WhatsApp, not here.',
      };
      await noteShown(out.waiting);   // "value" is paise but not named so
      return out;
    }

    const { groups, pending } = await waiting(mgr.id);
    const user = await User.get();
    if (!pending.length) {
      await user?.patch({ set: { lastView: null } } as any);
      return { sendExactly: 'Nothing is waiting on you. ✓', nextStep: 'Send sendExactly word for word and stop.' };
    }

    if (input.eachFor || groups.length === 1 && /show each|one by one|each|alag/i.test(String((user as any)?.lastText ?? ''))) {
      const want = (input.eachFor ?? '').toLowerCase();
      const g = groups.find((x) => want && String(x.outlet).toLowerCase().includes(want.split(' ')[0])) ?? groups[0];
      const items = pending.filter((p) => g.ids.includes(p.id));
      await user?.patch({ set: { lastView: { kind: 'items', ids: items.map((p) => p.id) } } } as any);
      return { sendExactly: itemList(items),
               nextStep: 'Send sendExactly word for word, including the ::: block, and stop. On approve / reject, call decide_approval.' };
    }

    await user?.patch({ set: { lastView: { kind: 'groups', groups: groups.map((g) => ({ n: g.n, ids: g.ids })) } } } as any);
    return {
      sendExactly: groupList(groups),
      nextStep: 'Send sendExactly word for word, including the ::: block, and stop. On approve / reject, call decide_approval. ' +
                'On "Show each", call pending_approvals with eachFor.',
    };
  }
}
