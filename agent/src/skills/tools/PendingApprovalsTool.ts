import { LuaTool, User } from 'lua-cli';
import { z } from 'zod';
import { get, rs, currentManager } from '../../lib/api';
import { noteShown } from '../../lib/guard';
import { waiting, overview, shopCard, oneCard, short } from '../../lib/decisions';

/**
 * What is stopped, waiting on this manager: a summary of the shops, one shop's
 * card (tap a shop), or that shop's requests one at a time ("One by one").
 * What was shown is saved on the conversation, so "approve" or "approve 2"
 * later means what this manager was looking at, decided in code.
 */
export default class PendingApprovalsTool implements LuaTool {
  name = 'pending_approvals';
  description =
    'List what is waiting on this manager: orders held at a credit limit, changes and better prices reps asked for. ' +
    'Use it when a manager asks what needs them, what is stuck, on hold or waiting; when they tap or name a shop ' +
    'from that list (pass shop); and when they tap "One by one" (pass oneByOne).';

  inputSchema = z.object({
    shop: z.string().optional().describe('A shop they tapped or named from the list, e.g. "Sharma (3)" → "Sharma".'),
    oneByOne: z.boolean().optional().describe('True when they ask to go one by one / see each order.'),
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
    const user: any = await User.get();
    const said = String(user?.lastText ?? '');
    const done = (text: string) => ({ sendExactly: text,
      nextStep: 'Send sendExactly word for word, including the ::: block, and stop. On approve / reject / skip, call ' +
                'decide_approval. On a shop name, call pending_approvals with shop. On "One by one", call it with oneByOne.' });
    if (!pending.length) {
      await user?.patch({ set: { lastView: null } });
      return done('Nothing is waiting on you. ✓');
    }

    // Which shop: the one named, else the one they were just looking at, else the only one.
    const want = (input.shop ?? '').toLowerCase().replace(/\(\d+\)/, '').trim();
    const view = user?.lastView;
    const g = (want && groups.find((x) => String(x.outlet).toLowerCase().includes(want.split(' ')[0])
                                      || short(x.outlet).toLowerCase() === want.split(' ')[0]))
      ?? (view?.kind === 'items' || view?.kind === 'one' ? groups.find((x) => x.ids.some((id) => view.ids.includes(id))) : undefined)
      ?? (groups.length === 1 ? groups[0] : undefined);

    if (g && (input.oneByOne || /one by one|each|ek ek|alag/i.test(said))) {
      const card = await oneCard(g.ids, 0, pending);
      if (card) return done(card);
    }
    if (g && (want || groups.length === 1)) return done(await shopCard(g, pending));
    return done(await overview(groups, pending));
  }
}
