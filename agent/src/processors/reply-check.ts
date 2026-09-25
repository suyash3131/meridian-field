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

/**
 * A tool's tap buttons, restored if the model left them out. It has sent the
 * choices as a plain or numbered list instead, which on WhatsApp is only text
 * he has to type back. Restored only when the reply is exactly that tool's
 * text with the buttons flattened into a list: a note left over from an
 * earlier turn, or two slips in one reply, never match that, so nothing the
 * tools did not write this turn can come back.
 */
const flat = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}₹]/gu, '');

export function withButtons(response: string, notes: TurnNote[]): string {
  if (response.includes('::: actions')) return response;
  const said = flat(response);
  const match = notes.map((n) => n.buttons).filter((b): b is string => {
    if (!b) return false;
    const [body, block] = b.split('::: actions');
    const labels = (block ?? '').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)).join('');
    if (!said.startsWith(flat(body))) return false;
    const rest = said.slice(flat(body).length).replace(/\d/g, '');
    return rest === '' || rest === flat(labels).replace(/\d/g, '');
  });
  if (!match.length) return response;
  console.log('reply-check restored buttons', JSON.stringify({ response }));
  return match[match.length - 1];
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

    if (r.ok) return { modifiedResponse: withButtons(response, notes) };

    console.log('reply-check replaced a reply', JSON.stringify({ invented: r.invented, falseClaim: r.falseClaim, response }));
    return { modifiedResponse: "Let me check that again. Please send it once more." };
  },
});
