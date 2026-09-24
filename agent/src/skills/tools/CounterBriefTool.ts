import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { get, currentRep, repLang } from '../../lib/api';
import { briefText } from '../../lib/say';
import { recall } from '../../lib/memory';

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

    // What the team said here before, newest first: the thing a new rep never knows.
    const past = await recall(r.outlet.id, 2);
    const day = (iso?: string) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '';
    const remembered = past.length
      ? '\n' + past.map((m) => `${lang === 'hi' ? 'याद रखें' : 'Remember'} (${day(m.at)}, ${m.by}): "${m.text}"`).join('\n')
      : '';

    return {
      counter: r.outlet.name,
      sendExactly: briefText({
        counter: r.outlet.name,
        owesPaise: r.credit.outstandingPaise,
        roomPaise: r.credit.headroomPaise,
        overduePaise: r.credit.overduePaise,
        nearExpiry: r.nearExpiry ?? [],
        usuallyBuys: r.usuallyBuys?.map((u: any) => u.name) ?? [],
      }, lang) + remembered,
      lastVisitDaysAgo: r.lastVisitDaysAgo,
      nextStep: 'Send sendExactly to the rep word for word and stop.',
    };
  }
}
