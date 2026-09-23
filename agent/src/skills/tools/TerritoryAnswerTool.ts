import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { get } from '../../lib/api';

/**
 * The eight o'clock question.
 *
 * The only thing the model decides here is the scope. Every number in the
 * reply — the totals, the deltas, the rupee size of each cause, the ranking —
 * is computed server-side and handed back finished. The model's job is to say
 * it in the order a tired regional head can act on, and nothing else.
 */
export default class TerritoryAnswerTool implements LuaTool {
  name = 'territory_answer';
  description =
    'Explain how a territory is performing and why. Use it for any question about whether ' +
    'the number will land, why a region is up or down, which rep is stuck, or where the ' +
    'business is leaking. Returns a headline and the causes already ranked by rupee impact.';

  inputSchema = z.object({
    region: z.enum(['North', 'South', 'all']).describe(
      'Which territory the question is about. Use "all" when no region is named.'
    ),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const q = input.region === 'all' ? '' : `?region=${encodeURIComponent(input.region)}`;
    const a = await get(`/api/manager/answer${q}`);
    const money = (f: any) => f.impactPaise > 0
      ? (f.estimated ? 'about ' : '') + '₹' + Math.round(f.impactPaise / 100).toLocaleString('en-IN')
      : null;

    // The whole reply, built here. Every figure is the server's, in the server's
    // order, and each cause is its own paragraph: email and the chat widget both
    // fold single line breaks, which ran the causes together into one block.
    const sendExactly = [
      `**${a.headline}**`,
      ...a.findings.map((f: any) => {
        const m = money(f);
        const said = m && f.headline.includes(m.replace('about ', ''));
        return `- ${f.headline}` + (m && !said ? ` (${m})` : '');
      }),
      a.biggestLever ? `**First thing:** ${a.biggestLever}` : '',
    ].filter(Boolean).join('\n\n');

    return {
      sendExactly,
      nextStep: 'Send sendExactly word for word, nothing before or after it, and stop.',
      headline: a.headline,
      causesInOrder: a.findings.map((f: any) => ({
        cause: f.headline,
        worth: f.impactPaise > 0
          ? (f.estimated ? 'about ' : '') + '₹' + Math.round(f.impactPaise / 100).toLocaleString('en-IN')
          : null,
        estimate: f.estimated,
        doThis: f.lever,
      })),
      biggestLever: a.biggestLever,
      howToAnswer:
        'Lead with the headline. Then the causes in the order given, one line each, with the ' +
        'rupee figure attached. Finish with the single biggest lever. Say "about" wherever a ' +
        'figure is an estimate. Do not add a number of your own and do not offer a chart.',
    };
  }
}
