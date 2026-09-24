import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { get, rs } from '../../lib/api';
import { User } from 'lua-cli';

/**
 * What rivals are doing, from what reps saw at the counter, written in code.
 * Per brand: how many counters against the period before, the offers and
 * products named, which of ours they hit, where, and the latest words a rep
 * used. Then what our orders at those same counters did, so the manager sees
 * whether the pressure is costing money yet.
 */
export default class CompetitorWatchTool implements LuaTool {
  name = 'competitor_watch';
  description =
    'Answer a manager asking what competitors or rivals are doing: which brands, what offers, where, ' +
    'how fast it is spreading, and whether it is hurting our orders there.';

  inputSchema = z.object({
    days: z.number().int().min(1).max(90).optional().describe('Period to look at; default 7.'),
    region: z.enum(['North', 'South']).optional().describe('Only if they name one; otherwise their own region.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const u: any = await User.get();
    const region = input.region ?? (u?.region && u.region !== 'all' ? u.region : '');
    const days = input.days ?? 7;
    const r = await get<any>(`/api/manager/competitors?days=${days}&region=${encodeURIComponent(region)}`);
    const where = region || 'all regions';
    if (!r.brands?.length)
      return { sendExactly: `No rival sightings in ${where} in the last ${days} days.`, nextStep: 'Send sendExactly word for word and stop.' };

    const period = days === 7 ? 'this week' : `the last ${days} days`;
    const before = days === 7 ? 'the week before' : 'the period before';
    const blocks = r.brands.slice(0, 5).map((b: any) => {
      const trend = b.counters_before === 0 ? 'new' : b.counters_now > b.counters_before ? `up from ${b.counters_before}` : b.counters_now < b.counters_before ? `down from ${b.counters_before}` : 'same as before';
      const what = [b.offers.length && b.offers.join(', '), b.products.length && `on ${b.products.join(', ')}`].filter(Boolean).join(' ');
      const vs = b.ours.length ? ` Hits our ${b.ours.join(', ')}.` : '';
      const shops = b.shops.slice(0, 4).join(', ') + (b.shops.length > 4 ? ` +${b.shops.length - 4} more` : '');
      return `*${b.brand}*: ${b.counters_now} counter${b.counters_now === 1 ? '' : 's'} (${trend}). ${what ? capital(what) + '.' : ''}${vs}\n` +
             `At ${shops}. Latest, ${b.last_seen}: "${b.latest}"`;
    });
    const m = r.oursAtThoseCounters;
    const change = m.beforePaise > 0 ? Math.round(((m.nowPaise - m.beforePaise) / m.beforePaise) * 100) : null;
    const money = `Our orders at those counters: ${rs(m.nowPaise)} ${period} against ${rs(m.beforePaise)} ${before}` +
      (change === null ? '.' : change < 0 ? `, down ${-change}%.` : change > 0 ? `, up ${change}%.` : ', flat.');
    return {
      sendExactly: `Rivals in ${where}, ${period}:\n\n${blocks.join('\n\n')}\n\n${money}`,
      nextStep: 'Send sendExactly word for word and stop. Every figure is from the CRM.',
    };
  }
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
