import { LuaTool, User } from 'lua-cli';
import { z } from 'zod';
import { post, rs, currentManager, thisTurn } from '../../lib/api';
import { sendOrderMail } from '../../lib/mail';
import { buttons } from '../../lib/rich';
import { noteShown } from '../../lib/guard';
import { waiting, groupList, short, type Item } from '../../lib/decisions';

/**
 * Carry out a manager's approve or reject.
 *
 * The model does not decide, and it does not choose which request. Code does,
 * from the manager's own words this turn (the roster pre-processor strips the
 * quoted copy of our earlier message that WhatsApp attaches to a tap, which
 * once read "…or approve all" and approved six orders on one tap):
 *
 *   - the sender must be a verified manager (email address or WhatsApp number)
 *   - their words must say approve or reject, not both, and agree with the model
 *   - which: an order/approval reference in the email they replied to; a number
 *     from the list they were last shown; a shop they name; "all"; or the only
 *     one waiting. Anything else gets the list back, never a guess
 *   - more than one order is never decided on one message: it is read back
 *     with the total, and needs a yes
 *   - the CRM re-checks assignment and status under a row lock
 *
 * Approving a held order books it; the shop gets its confirmation and invoice
 * and the rep is told, by email, in the same step.
 */
const APPROVE = /\b(approve[ds]?|approval|release[ds]?|manzoor|pass kar(o|do)?)\b/i;
const REJECT = /\b(reject(ed)?|decline[ds]?|deny|refuse[ds]?|mat karo)\b/i;
const YES = /^\s*(yes|yeah|yep|haan|han|ha|ok|okay|confirm|sure|done|kar do|👍|✅)\b/i;
const NO = /^\s*(no|nope|nahi|nahin|cancel|stop|mat)\b/i;
const say = (text: string) => ({ sendExactly: text, nextStep: 'Send sendExactly word for word, including any ::: block, and stop.' });

export default class DecideApprovalTool implements LuaTool {
  name = 'decide_approval';
  description =
    'A manager replied approve or reject to something waiting on them (a held order, a change, a price ask), or yes/no ' +
    'to a "approve all N?" read-back. Call it with their decision. Code checks who they are, their exact words, and which requests.';

  inputSchema = z.object({
    decision: z.enum(['approve', 'reject']).describe('What the manager said. For a yes/no to a read-back, the read-back\'s decision.'),
    note: z.string().optional().describe('Anything they added after the word, e.g. "collect 20k first". Their words only.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const mgr = await currentManager();
    const turn = await thisTurn();
    const said = turn.text;
    const user: any = await User.get();

    // A yes / no to "approve all 6 at Sharma?"
    const held = user?.pendingDecision;
    if (held && Date.now() - new Date(held.at).getTime() < 15 * 60 * 1000) {
      if (NO.test(said)) { await user.patch({ set: { pendingDecision: null } }); return say('Not changed. Nothing was approved or rejected.'); }
      const again = (held.decision === 'approve' ? APPROVE : REJECT).test(said) && !(held.decision === 'approve' ? REJECT : APPROVE).test(said);
      if (YES.test(said) || again) {
        await user.patch({ set: { pendingDecision: null } });
        return this.carryOut(mgr.id, held.decision, held.ids, input.note);
      }
    }

    const a = APPROVE.test(said), r = REJECT.test(said);
    const decision = a && !r ? 'approve' : r && !a ? 'reject' : null;
    if (!decision) return say('Approve or reject? Reply with one of the two words.');
    if (decision !== input.decision) return say(`Your message reads as "${decision}". Nothing changed. Reply again with approve or reject.`);

    const { groups, pending } = await waiting(mgr.id);
    if (!pending.length) return say(turn.refs.length ? 'That one has already been decided. Nothing is waiting on you now. ✓' : 'Nothing is waiting on you. ✓');

    const view = user?.lastView;
    const all = /\b(all|sab|sabhi|everything)\b/i.test(said);
    // "Approve all 6" carries a count, not a line number.
    const num = all ? undefined : said.match(/\b(\d{1,2})\b/)?.[1];
    let ids: string[] = [];
    const byRef = pending.filter((p) => turn.refs.includes(p.id) || turn.refs.includes(String(p.orderId).toUpperCase()));
    if (byRef.length) ids = byRef.map((p) => p.id);
    else if (num && view?.kind === 'groups') ids = view.groups.find((g: any) => g.n === Number(num))?.ids ?? [];
    else if (num && view?.kind === 'items') ids = view.ids[Number(num) - 1] ? [view.ids[Number(num) - 1]] : [];
    if (!ids.length) {
      const named = groups.filter((g) => nameIn(g.outlet, said));
      if (named.length) ids = named.flatMap((g) => g.ids);
      else if (all) ids = view?.kind === 'items' ? view.ids : pending.map((p) => p.id);
      else if (pending.length === 1) ids = [pending[0].id];
    }
    ids = ids.filter((id) => pending.some((p) => p.id === id));   // only what is still waiting on them

    if (!ids.length) {
      await user?.patch({ set: { lastView: { kind: 'groups', groups: groups.map((g) => ({ n: g.n, ids: g.ids })) } } });
      return say(`Which one?\n\n${groupList(groups)}`);
    }

    if (ids.length > 1) {
      const chosen = pending.filter((p) => ids.includes(p.id));
      const shops = [...new Set(chosen.map((p) => p.outlet))];
      const total = chosen.reduce((s, p) => s + (p.valuePaise ?? 0), 0);
      const totalText = rs(total);
      await noteShown([totalText]);   // a sum of CRM figures, added in code
      const g = shops.length === 1 ? groups.find((x) => x.outlet === shops[0]) : null;
      const credit = decision === 'approve' && g?.kind === 'credit_override' && g.owedPaise != null && g.limitPaise != null
        ? ` The shop already owes ${rs(g.owedPaise)} of its ${rs(g.limitPaise)} limit.` : '';
      await user.patch({ set: { pendingDecision: { decision, ids, at: new Date().toISOString() } } });
      const verb = decision === 'approve' ? 'Approve' : 'Reject';
      return say(`${verb} all ${ids.length} at ${shops.length === 1 ? `*${shops[0]}*` : `${shops.length} shops`}, ${totalText} in total?${credit}` +
        buttons([`Yes, ${decision} all ${ids.length}`, 'No']));
    }

    return this.carryOut(mgr.id, decision, ids, input.note);
  }

  private async carryOut(managerId: string, decision: 'approve' | 'reject', ids: string[], note?: string) {
    const { pending } = await waiting(managerId);
    const chosen: Item[] = pending.filter((p) => ids.includes(p.id));
    const perShop = new Map<string, { n: number; paise: number; booked: number; mailed: boolean; rep: string | null; problems: string[] }>();
    for (const t of chosen.slice(0, 10)) {
      const k = t.outlet ?? 'shop';
      const s = perShop.get(k) ?? { n: 0, paise: 0, booked: 0, mailed: false, rep: t.rep, problems: [] };
      perShop.set(k, s);
      const res = await post<any>('/api/manager/decide', { managerId, approvalId: t.id, decision, note });
      if (res.error || res.already) { s.problems.push(res.error ?? `one was already ${res.status}`); continue; }
      s.n++; s.paise += t.valuePaise ?? 0;
      if (res.kind === 'credit_override' && res.orderStatus) {
        const m = await sendOrderMail(res.orderId, decision === 'approve' ? 'approved' : 'rejected');
        if (res.orderStatus === 'confirmed') s.booked++;
        s.mailed = s.mailed || !!m.rep || !!m.chemist;
      }
    }
    const lines: string[] = [];
    for (const [shop, s] of perShop) {
      const money = s.paise ? `, ${rs(s.paise)}` : '';
      if (s.paise) await noteShown([rs(s.paise)]);
      if (s.n) lines.push(decision === 'approve'
        ? `✓ Approved ${s.n === 1 ? '' : `${s.n} `}at *${shop}*${money}.${s.booked ? ` Booked; the shop has its confirmation${s.booked > 1 ? 's' : ''} and invoice${s.booked > 1 ? 's' : ''}.` : ''}${s.mailed && s.rep ? ` ${s.rep} told.` : ''}`
        : `✗ Rejected ${s.n === 1 ? '' : `${s.n} `}at *${shop}*${money}.${s.mailed && s.rep ? ` ${s.rep} told.` : ''}`);
      if (s.problems.length) lines.push(`${shop}: ${s.problems.join('; ')}.`);
    }
    const left = (await waiting(managerId)).pending.length;
    const user: any = await User.get();
    await user?.patch({ set: { lastView: null } });
    return say(lines.join('\n') + (left ? `\n\n${left} still waiting on you.` : ''));
  }
}

/** Does the message name this shop? Its distinctive word, as a whole word. */
function nameIn(outlet: string | null, said: string): boolean {
  const w = short(outlet).toLowerCase();
  return w.length >= 3 && new RegExp(`\\b${w.replace(/[^a-z0-9]/g, '')}\\b`, 'i').test(said);
}
