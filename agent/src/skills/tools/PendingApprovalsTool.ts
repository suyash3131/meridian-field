import { LuaTool, User } from 'lua-cli';
import { z } from 'zod';
import { get, rs, currentManager } from '../../lib/api';
import { noteShown } from '../../lib/guard';
import { buttons } from '../../lib/rich';

/**
 * What is stopped, waiting on this manager.
 *
 * Numbered, and the numbering is saved on the conversation, so "approve 2"
 * later means exactly the second line this manager was shown, not whatever
 * the model thinks the second one was. On WhatsApp each line gets Approve /
 * Reject buttons.
 */
export default class PendingApprovalsTool implements LuaTool {
  name = 'pending_approvals';
  description =
    'List what is waiting on this manager: orders held at a credit limit, changes and better prices reps asked for. ' +
    'Use it when a manager asks what needs them, what is stuck, what is on hold, or what is waiting.';

  inputSchema = z.object({});

  async execute() {
    let mgr: { id: string; name: string } | null = null;
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

    const { pending = [] } = await get<{ pending: any[] }>(`/api/manager/pending?managerId=${encodeURIComponent(mgr.id)}`);
    const user = await User.get();
    await user?.patch({ set: { lastPendingList: pending.map((p) => p.id) } } as any);
    if (!pending.length)
      return { sendExactly: 'Nothing is waiting on you. ✓', nextStep: 'Send sendExactly word for word and stop.' };

    const what = (p: any) =>
      p.kind === 'credit_override' ? `${rs(p.valuePaise)} held over its credit limit`
      : p.kind === 'order_change' ? `change asked: ${p.reason}`
      : p.kind === 'price_exception' ? `better price asked: ${p.reason}`
      : p.reason;
    const shown = pending.slice(0, 8);
    const lines = shown.map((p) =>
      `${p.n}. *${p.outlet ?? 'Unknown counter'}*: ${what(p)}, ${p.ageDays ? `${p.ageDays} day${p.ageDays === 1 ? '' : 's'}` : 'today'} (${p.rep ?? 'rep'})`);
    const more = pending.length > shown.length ? `\n\n…and ${pending.length - shown.length} more.` : '';
    const one = pending.length === 1;
    return {
      sendExactly:
        `${pending.length} waiting on you:\n\n${lines.join('\n')}${more}\n\n` +
        (one ? 'Reply *approve* or *reject*.' : 'Reply *approve 1*, *reject 2*, or *approve all*.') +
        buttons(one ? ['Approve', 'Reject'] : shown.slice(0, 5).flatMap((p) => [`Approve ${p.n}`, `Reject ${p.n}`])),
      nextStep: 'Send sendExactly word for word, including the ::: block, and stop. When they reply approve or reject, call decide_approval.',
    };
  }
}
