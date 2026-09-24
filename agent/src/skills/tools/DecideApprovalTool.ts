import { LuaTool, User } from 'lua-cli';
import { z } from 'zod';
import { get, post, rs, currentManager, thisTurn } from '../../lib/api';
import { sendOrderMail } from '../../lib/mail';
import { buttons } from '../../lib/rich';

/**
 * Carry out a manager's approve or reject.
 *
 * The model does not decide, and it does not choose which request. Code does:
 *
 *   - the sender must be a verified manager (their email address or WhatsApp
 *     number, bound by the roster pre-processor)
 *   - their own words this turn must say approve or reject, and must not say
 *     both. The model's reading of the decision has to agree with them
 *   - which request: an order/approval reference in the email they replied to,
 *     or a number from the list they were last shown, or "all", or a shop name
 *     only one waiting request matches, or the only one waiting. Anything
 *     else gets the numbered list back and a question, never a guess
 *   - the CRM then checks again that it is assigned to them and still pending,
 *     under a row lock, so a double tap releases once
 *
 * Approving a held order books it; the shop gets its confirmation and invoice
 * and the rep is told, by email, in the same step.
 */
const APPROVE = /\b(approve[ds]?|approval|release[ds]?|manzoor|pass kar(o|do)?)\b/i;
const REJECT = /\b(reject(ed)?|decline[ds]?|deny|cancel(led)?|refuse[ds]?|mat karo|na(h)?i)\b/i;

export default class DecideApprovalTool implements LuaTool {
  name = 'decide_approval';
  description =
    'A manager has replied approve or reject to something waiting on them (a held order, a change, a price ask). ' +
    'Call it with their decision. Code checks who they are, what they actually wrote, and which request they mean.';

  inputSchema = z.object({
    decision: z.enum(['approve', 'reject']).describe('What the manager said.'),
    note: z.string().optional().describe('Anything they added after the word, e.g. "collect 20k first". Their words only.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const mgr = await currentManager();
    const turn = await thisTurn();
    const said = turn.text.replace(/I selected:\s*/i, '');
    const a = APPROVE.test(said), r = REJECT.test(said);
    const decision = a && !r ? 'approve' : r && !a ? 'reject' : null;
    if (!decision)
      return { sendExactly: 'Approve or reject? Reply with just one of the two words.', nextStep: 'Send sendExactly word for word and stop.' };
    if (decision !== input.decision)
      return { sendExactly: `Your message reads as "${decision}". Nothing changed. Reply again with just approve or reject.`,
               nextStep: 'Send sendExactly word for word and stop.' };

    const { pending = [] } = await get<{ pending: any[] }>(`/api/manager/pending?managerId=${encodeURIComponent(mgr.id)}`);
    const user: any = await User.get();
    const shown: string[] = Array.isArray(user?.lastPendingList) ? user.lastPendingList : [];

    let targets: any[] = [];
    const byRef = pending.filter((p) => turn.refs.includes(p.id) || turn.refs.includes(String(p.orderId).toUpperCase()));
    const num = said.match(/\b(?:approve|reject|release|decline|cancel)?\s*#?(\d{1,2})\b/i)?.[1];
    if (byRef.length) targets = byRef;
    else if (/\ball\b|\bsab\b|\bsabhi\b/i.test(said)) {
      // "approve all" is everything waiting; "approve all sharma" only Sharma's.
      const named = pending.filter((p) => matchesShop(p, said));
      targets = named.length ? named : pending;
    }
    else if (num && shown[Number(num) - 1]) targets = pending.filter((p) => p.id === shown[Number(num) - 1]);
    else {
      const named = pending.filter((p) => matchesShop(p, said));
      targets = named.length ? named : pending.length === 1 ? pending : [];
      if (named.length > 1) targets = [];
    }

    if (!targets.length) {
      if (!pending.length) {
        // The reply may be to something already decided: say so rather than nothing.
        if (turn.refs.length)
          return { sendExactly: 'That one has already been decided. Nothing is waiting on you now. ✓', nextStep: 'Send sendExactly word for word and stop.' };
        return { sendExactly: 'Nothing is waiting on you. ✓', nextStep: 'Send sendExactly word for word and stop.' };
      }
      await user?.patch({ set: { lastPendingList: pending.map((p) => p.id) } });
      const list = pending.slice(0, 8).map((p) => `${p.n}. *${p.outlet}*: ${p.valuePaise != null ? rs(p.valuePaise) : p.reason}, ${p.ageDays}d (${p.rep})`);
      return {
        sendExactly: `Which one?\n\n${list.join('\n')}\n\nReply *${decision} 1*, or *${decision} all*.` +
          buttons(pending.slice(0, 10).map((p) => `${decision === 'approve' ? 'Approve' : 'Reject'} ${p.n}`)),
        nextStep: 'Send sendExactly word for word, including the ::: block, and stop.',
      };
    }

    const done: string[] = [];
    for (const t of targets.slice(0, 10)) {
      const res = await post('/api/manager/decide', { managerId: mgr.id, approvalId: t.id, decision, note: input.note });
      if (res.error) { done.push(`${t.outlet}: ${res.error}`); continue; }
      if (res.already) { done.push(`${t.outlet}: already ${res.status}, nothing changed.`); continue; }
      let told = '';
      if (res.kind === 'credit_override' && res.orderStatus) {
        const m = await sendOrderMail(res.orderId, decision === 'approve' ? 'approved' : 'rejected');
        told = decision === 'approve'
          ? [m.chemist && 'shop has its confirmation and invoice', m.rep && `${t.rep} emailed`].filter(Boolean).join(', ')
          : (m.rep ? `${t.rep} emailed` : '');
      }
      done.push(decision === 'approve'
        ? `✓ Approved: ${t.outlet}${t.valuePaise != null ? `, ${rs(t.valuePaise)}` : ''}${res.orderStatus === 'confirmed' ? ', booked' : ''}${told ? `. ${capital(told)}.` : '.'}`
        : `✗ Rejected: ${t.outlet}${t.valuePaise != null ? `, ${rs(t.valuePaise)}` : ''}${res.orderStatus === 'cancelled' ? ', cancelled' : ''}${told ? `. ${capital(told)}.` : '.'}`);
    }
    const left = pending.length - targets.length;
    await user?.patch({ set: { lastPendingList: [] } });
    return {
      sendExactly: done.join('\n') + (left > 0 ? `\n\n${left} still waiting on you.` : ''),
      nextStep: 'Send sendExactly word for word and stop.',
    };
  }
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const GENERIC = /\b(chemists?|medicals?|medicos?|stores?|pharmacy|pharma|agency|drugs?|shop|and|the)\b/gi;

/** Does the manager's message name this request's shop? Distinctive words only. */
function matchesShop(p: any, said: string): boolean | null {
  const words = String(p.outlet ?? '').toLowerCase().replace(GENERIC, ' ').split(/\s+/).filter((w) => w.length >= 3);
  if (!words.length) return null;
  const s = said.toLowerCase();
  return words.every((w) => s.includes(w)) ? true : null;
}
