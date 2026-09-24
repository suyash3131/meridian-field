import { get, currentChemist, thisTurn } from './api';

/**
 * Which of the chemist's own shops this message is about, decided in code.
 *
 *  1. an order reference in the email they replied to, if that order is one
 *     of their shops'
 *  2. a shop of theirs their message names
 *  3. their only shop
 *
 * Otherwise the answer is "which one?" with their own list. A chemist can never
 * reach a shop that is not theirs: every path starts from the shops their
 * verified email or number belongs to.
 */
export async function chemistShop(named?: string): Promise<
  { id: string; name: string } | { ask: string; options: string[] }> {
  const me = await currentChemist();
  const turn = await thisTurn();
  const mine = new Map(me.shops.map((s) => [s.id, s]));

  for (const ref of turn.refs.filter((r) => r.startsWith('ORD-'))) {
    const a = await get<any>(`/api/chemist/account?orderId=${encodeURIComponent(ref)}`).catch(() => null);
    if (a?.outletId && mine.has(a.outletId)) return mine.get(a.outletId)!;
  }
  const words = `${named ?? ''} ${turn.text}`.toLowerCase();
  const core = (s: string) => s.toLowerCase().replace(/\b(chemists?|medicals?|medicos?|stores?|pharmacy|pharma|agency|drugs?)\b/g, ' ')
    .split(/\s+/).filter((w) => w.length >= 3);
  const hits = me.shops.filter((s) => { const w = core(s.name); return w.length && w.every((x) => words.includes(x)); });
  if (hits.length === 1) return hits[0];
  if (me.shops.length === 1) return me.shops[0];
  const list = (hits.length ? hits : me.shops).slice(0, 10);
  return { ask: 'Which shop is this about?', options: list.map((s) => `${s.name}${s.area ? `, ${s.area}` : ''}`) };
}
