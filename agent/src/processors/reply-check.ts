import { PostProcessor, User } from 'lua-cli';
import { rupeesIn, type TurnNote } from '../lib/guard';

/**
 * The last look at every reply before anyone sees it.
 *
 * Two things the model must never do, checked here in code rather than asked
 * for in a prompt:
 *   1. Say a rupee figure no tool produced this turn. Every price, total, due
 *      and limit comes from the CRM; one the model made up or re-did is wrong
 *      even when it happens to be right.
 *   2. Say an order is done when no order went through this turn. "Done",
 *      "placed", "Saved" are only true after confirm_order.
 *
 * If a reply breaks either, it is replaced with what the tools actually built.
 * If there is nothing to fall back on, the rep is asked to send it again.
 */
// The exact openings only confirm_order's replies use. "Cancelled… हो गया" or
// "Nothing new saved" are true statements from other tools and must pass.
const CLAIMS = /(^|\n)[\s*]*(Done|Saved) —|Already (placed|saved) ✓|(^|\n)[\s*]*(सेव )?हो गया —|पहले ही (सेव )?हो चुका है ✓/;

export function check(response: string, message: string, notes: TurnNote[]) {
  const allowed = new Set([...notes.flatMap((n) => n.rupees), ...rupeesIn(message)]);
  const invented = rupeesIn(response).filter((r) => !allowed.has(r));
  const placed = notes.some((n) => n.placed);
  const falseClaim = CLAIMS.test(response) && !placed;
  return { ok: !invented.length && !falseClaim, invented, falseClaim };
}

export default new PostProcessor({
  name: 'reply-check',
  description: 'Replace replies that invent rupee figures or claim an order that did not happen',
  priority: 10,
  execute: async (user, message, response) => {
    const u: any = (await User.get().catch(() => null)) ?? user;
    const notes: TurnNote[] = u?.turnNotes ?? [];
    const r = check(response, message, notes);
    await u?.patch?.({ set: { turnNotes: [] } }).catch(() => {});

    if (r.ok) return { modifiedResponse: response };

    console.log('reply-check replaced a reply', JSON.stringify({ invented: r.invented, falseClaim: r.falseClaim, response }));
    return { modifiedResponse: "Let me check that again. Please send it once more." };
  },
});
