import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { get, currentRep, rs, repLang } from '../../lib/api';
import { replyIn } from '../../lib/say';

/** What a rep should know in the ten seconds before he opens his mouth. */
export default class CounterBriefTool implements LuaTool {
  name = 'counter_brief';
  description =
    'Look up a counter before the rep walks in: what it owes, how much credit room is left, ' +
    'what it usually buys, and any batch on its shelf near expiry. Use it when he asks about ' +
    'a shop rather than giving you an order.';

  inputSchema = z.object({
    shop: z.string().describe('The counter name as the rep typed it.'),
    repId: z.string().optional(),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const rep = await currentRep(input.repId);
    const r = await get(
      `/api/agent/outlet?q=${encodeURIComponent(input.shop)}&repId=${encodeURIComponent(rep.id)}`);

    const lang = await repLang();
    if (r.status !== 'resolved')
      return { notFound: true, reason: r.reason, options: r.candidates ?? null };

    return {
      counter: r.outlet.name,
      owes: rs(r.credit.outstandingPaise),
      creditRoomLeft: rs(r.credit.headroomPaise),
      pastTerms: r.credit.overduePaise > 0 ? rs(r.credit.overduePaise) : null,
      lastVisitDaysAgo: r.lastVisitDaysAgo,
      usuallyBuys: r.usuallyBuys?.map((u: any) => u.name) ?? [],
      nearExpiry: r.nearExpiry?.map((n: any) => `${n.name} batch ${n.batch_no}, ${n.days} days`) ?? [],
      replyIn: replyIn(lang),
      nextStep: 'Give him at most three lines. Lead with whatever he can act on at the counter.',
    };
  }
}
