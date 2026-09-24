import { User } from 'lua-cli';
import { get, rs } from './api';
import { buttons, onEmail } from './rich';

/**
 * What waits on a manager, laid out so one glance says what to decide.
 *
 * WhatsApp shows up to three tap buttons under a message; a fourth turns them
 * into a pop-up list whose rows read "Option 1 / Approve 1", and a list takes
 * one tap only, so "reject 1 and 2" cannot be picked there. So every view
 * here offers at most three buttons, and a decision is either the whole shop
 * at once or one order at a time, never a pick-several list:
 *
 *   - several shops waiting → a short summary, tap a shop
 *   - one shop              → its card: Approve all / Reject all / One by one
 *   - one by one            → one order per message: Approve / Reject / Skip
 *
 * The CRM does the grouping and the sums; this only lays them out. What was
 * shown is saved on the conversation (lastView), so "approve", "approve 2" or
 * "all" later mean what this manager was looking at, decided in code.
 */
export type Group = {
  n: number; outlet: string | null; outletId: string | null; kind: string; count: number; ids: string[];
  totalPaise: number; oldestDays: number; reps: string[]; limitPaise: number | null; owedPaise: number | null;
};
export type Item = { n: number; id: string; kind: string; orderId: string; outlet: string | null; rep: string | null;
                     reason: string; items: string | null; valuePaise: number | null; ageDays: number };

/** What the manager is looking at: the shops, one shop's requests, or one request of a walk-through. */
export type View =
  | { kind: 'groups'; groups: { n: number; ids: string[] }[] }
  | { kind: 'items'; ids: string[] }
  | { kind: 'one'; ids: string[]; i: number };

export async function waiting(managerId: string): Promise<{ groups: Group[]; pending: Item[] }> {
  const r = await get<any>(`/api/manager/pending?managerId=${encodeURIComponent(managerId)}`);
  return { groups: r.groups ?? [], pending: r.pending ?? [] };
}

export async function setView(view: View | null) {
  const u: any = await User.get();
  await u?.patch({ set: { lastView: view } });
}

const when = (d: number) => (d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`);
export const short = (outlet: string | null) =>
  String(outlet ?? 'shop').replace(/\b(medical|medicals|store|stores|chemist|chemists|pharmacy|medicos|agency)\b/gi, '').trim().split(/\s+/)[0] || 'shop';
const people = (reps: string[]) => reps.length ? reps.join(', ') : 'a rep';

/** "3 orders on hold", "a change to a placed order", … */
function what(kind: string, n: number): string {
  if (kind === 'credit_override') return n === 1 ? '1 order on hold' : `${n} orders on hold`;
  if (kind === 'order_change') return n === 1 ? 'A change to a placed order' : `${n} changes to placed orders`;
  if (kind === 'price_exception') return n === 1 ? 'A better price asked for' : `${n} better prices asked for`;
  return n === 1 ? '1 request' : `${n} requests`;
}

/** Why a credit hold is held, in one sentence. */
function whyHeld(g: Group): string {
  return g.kind === 'credit_override' && g.limitPaise != null && g.owedPaise != null
    ? `Held because the shop already owes ${rs(g.owedPaise)} on a ${rs(g.limitPaise)} credit limit.` : '';
}

/** Whatever is waiting, in the view that fits: one shop's card, or the summary. */
export async function overview(groups: Group[], pending: Item[], title = '**Waiting on you**'): Promise<string> {
  if (!groups.length) { await setView(null); return 'Nothing else is waiting on you. ✓'; }
  if (groups.length === 1) return shopCard(groups[0], pending, title);
  return summary(groups, title);
}

/** Several shops: one short block each, tap a shop to open it. */
export async function summary(groups: Group[], title = '**Waiting on you**'): Promise<string> {
  await setView({ kind: 'groups', groups: groups.map((g) => ({ n: g.n, ids: g.ids })) });
  const shown = groups.slice(0, 6);
  const blocks = shown.map((g) => {
    const money = g.totalPaise ? ` · ${rs(g.totalPaise)}` : '';
    const over = g.kind === 'credit_override' ? ' · over credit limit' : '';
    return `${g.n}. **${g.outlet}**\n${what(g.kind, g.count)}${money}${over}`;
  });
  const more = groups.length > shown.length ? `\n\n…and ${groups.length - shown.length} more.` : '';
  const total = groups.reduce((a, g) => a + g.count, 0);
  const how = onEmail() ? 'Reply with a shop\'s name to see it, or *approve 1* / *reject 2*.' : 'Tap a shop to decide.';
  return `${title} · ${total} at ${groups.length} shops\n\n${blocks.join('\n\n')}${more}\n\n${how}` +
    buttons(groups.slice(0, 3).map((g) => `${short(g.outlet)} (${g.count})`));
}

/** One shop: what is waiting, why, and the three ways to decide it. */
export async function shopCard(g: Group, pending: Item[], title = '**Waiting on you**'): Promise<string> {
  const items = pending.filter((p) => g.ids.includes(p.id));
  await setView({ kind: 'items', ids: items.map((p) => p.id) });
  const money = g.totalPaise ? ` · ${rs(g.totalPaise)}${g.count > 1 ? ' in total' : ''}` : '';
  const only = g.count === 1 ? items[0] : null;
  const detail = only ? (only.kind === 'credit_override' ? only.items : only.reason) : null;
  const lines = [
    `${title}`,
    '',
    `**${g.outlet}**`,
    `${what(g.kind, g.count)}${money}`,
    detail ?? '',
    whyHeld(g),
    `Sent by ${people(g.reps)}, ${g.count > 1 && g.oldestDays > 0 ? `the oldest ${when(g.oldestDays)}` : when(g.oldestDays)}.`,
  ].filter((l, i) => i < 2 || l);
  if (g.count === 1)
    return lines.join('\n') + (onEmail() ? '\n\nReply *approve* or *reject*.' : '') + buttons(['Approve', 'Reject']);
  return lines.join('\n') +
    (onEmail() ? `\n\nReply *approve all*, *reject all*, or *one by one*.` : '') +
    buttons([`Approve all ${g.count}`, `Reject all ${g.count}`, 'One by one']);
}

/** One request of a walk-through, with Approve / Reject / Skip. */
export async function oneCard(ids: string[], i: number, pending: Item[]): Promise<string | null> {
  // Step past anything decided meanwhile (from the dashboard, or by the regional head).
  while (i < ids.length && !pending.some((p) => p.id === ids[i])) i++;
  if (i >= ids.length) return null;
  const p = pending.find((x) => x.id === ids[i])!;
  await setView({ kind: 'one', ids, i });
  const detail = p.kind === 'credit_override' ? p.items : p.reason;
  return [
    `**${p.outlet}** · ${i + 1} of ${ids.length}`,
    `${p.valuePaise != null ? `${rs(p.valuePaise)} · ` : ''}${p.rep ?? 'a rep'} · ${when(p.ageDays)}`,
    detail ?? '',
  ].filter(Boolean).join('\n') +
    (onEmail() ? '\n\nReply *approve*, *reject* or *skip*.' : '') + buttons(['Approve', 'Reject', 'Skip']);
}
