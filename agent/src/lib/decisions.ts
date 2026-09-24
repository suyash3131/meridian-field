import { get, rs } from './api';
import { buttons } from './rich';

/**
 * What waits on a manager, as they see it: one line per shop and kind, not one
 * per order. Six holds at Sharma are one decision. The CRM does the grouping
 * and the sums; this only lays them out.
 */
export type Group = {
  n: number; outlet: string | null; outletId: string | null; kind: string; count: number; ids: string[];
  totalPaise: number; oldestDays: number; reps: string[]; limitPaise: number | null; owedPaise: number | null;
};
export type Item = { n: number; id: string; kind: string; orderId: string; outlet: string | null; rep: string | null;
                     reason: string; valuePaise: number | null; ageDays: number };

export async function waiting(managerId: string): Promise<{ groups: Group[]; pending: Item[] }> {
  const r = await get<any>(`/api/manager/pending?managerId=${encodeURIComponent(managerId)}`);
  return { groups: r.groups ?? [], pending: r.pending ?? [] };
}

const days = (d: number) => (d <= 0 ? 'today' : d === 1 ? '1 day' : `${d} days`);
export const short = (outlet: string | null) =>
  String(outlet ?? 'shop').replace(/\b(medical|medicals|store|stores|chemist|chemists|pharmacy|medicos|agency)\b/gi, '').trim().split(/\s+/)[0] || 'shop';

function what(g: Group): string {
  const n = g.count;
  if (g.kind === 'credit_override') return `${n === 1 ? '1 order' : `${n} orders`} over its credit limit`;
  if (g.kind === 'order_change') return `${n === 1 ? 'a change' : `${n} changes`} to placed orders`;
  if (g.kind === 'price_exception') return `${n === 1 ? 'a better price' : `${n} better prices`} asked`;
  return `${n} request${n === 1 ? '' : 's'}`;
}

/** The grouped list, with the buttons that act on it. */
export function groupList(groups: Group[]): string {
  const blocks = groups.slice(0, 5).map((g) => {
    const money = g.kind === 'credit_override' ? `${rs(g.totalPaise)} · ` : '';
    const credit = g.kind === 'credit_override' && g.limitPaise != null && g.owedPaise != null
      ? `\nAlready owes ${rs(g.owedPaise)} of its ${rs(g.limitPaise)} limit` : '';
    return `${groups.length > 1 ? `${g.n}. ` : ''}*${g.outlet}*: ${what(g)}\n${money}oldest ${days(g.oldestDays)} · ${g.reps.join(', ')}${credit}`;
  });
  const more = groups.length > 5 ? `\n\n…and ${groups.length - 5} more shops.` : '';
  const total = groups.reduce((a, g) => a + g.count, 0);
  const acts = groups.length === 1
    ? (groups[0].count === 1 ? ['Approve', 'Reject'] : [`Approve all ${groups[0].count}`, `Reject all ${groups[0].count}`, 'Show each'])
    : groups.slice(0, 4).flatMap((g) => [`Approve ${g.n} (${short(g.outlet)})`, `Reject ${g.n} (${short(g.outlet)})`]);
  return `*Waiting on you* (${total})\n\n${blocks.join('\n\n')}${more}` + buttons(acts);
}

/** One shop's requests, one line each, for "show each". */
export function itemList(items: Item[]): string {
  const lines = items.slice(0, 10).map((p, i) =>
    `${i + 1}. ${p.valuePaise != null ? rs(p.valuePaise) : p.reason} · ${days(p.ageDays)}`);
  return `*${items[0]?.outlet}*, one by one:\n\n${lines.join('\n')}\n\nReply *approve 2* or *reject 3*.` +
    buttons(items.slice(0, 5).flatMap((_, i) => [`Approve ${i + 1}`, `Reject ${i + 1}`]));
}
