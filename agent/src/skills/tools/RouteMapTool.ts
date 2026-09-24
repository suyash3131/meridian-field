import { LuaTool, User } from 'lua-cli';
import { z } from 'zod';
import { get, currentRep } from '../../lib/api';

const DAY = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 } as const;

/**
 * A day's route as a Google Maps link: tap it on WhatsApp and Maps opens with
 * directions through every stop, in order. A rep gets his own route; a
 * manager can ask for any rep on their team.
 */
export default class RouteMapTool implements LuaTool {
  name = 'route_map';
  description =
    'Show a route for a day with a map link that opens directions through every stop in order. ' +
    'A rep asking "aaj ka route", "my route", "map". A manager asking for a rep\'s route.';

  inputSchema = z.object({
    day: z.enum(['today', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']).optional(),
    rep: z.string().optional().describe('Managers only: the rep\'s name as they said it.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const u: any = await User.get();
    let repId: string;
    if (u?.role === 'manager') {
      if (!input.rep) return { sendExactly: 'Whose route?', nextStep: 'Send sendExactly word for word and stop.' };
      const { reps = [] } = await get<{ reps: any[] }>('/api/reps');
      const want = input.rep.toLowerCase();
      const mine = reps.filter((r) => !u.region || u.region === 'all' || r.region === u.region);
      const hit = mine.filter((r) => r.name.toLowerCase().includes(want) || r.id.toLowerCase() === want);
      if (hit.length !== 1)
        return { sendExactly: `Which rep? ${mine.map((r) => r.name).join(', ')}.`, nextStep: 'Send sendExactly word for word and stop.' };
      repId = hit[0].id;
    } else repId = (await currentRep()).id;

    const weekday = input.day && input.day !== 'today' ? DAY[input.day] : '';
    const r = await get<any>(`/api/rep/route-map?repId=${encodeURIComponent(repId)}&weekday=${weekday}`);
    if (r.error) return { error: r.error };
    if (!r.stops.length)
      return { sendExactly: `${r.rep} has no route on ${r.day}.`, nextStep: 'Send sendExactly word for word and stop.' };
    const who = u?.role === 'manager' ? `${r.rep}, ${r.day}` : `${r.day}`;
    return {
      sendExactly: `*${who}*: ${r.stops.length} stops\n\n` +
        r.stops.map((s: any) => `${s.n}. ${s.name}, ${s.area}`).join('\n') +
        `\n\n🗺 ${r.links.length > 1 ? r.links.map((l: string, i: number) => `Part ${i + 1}: ${l}`).join('\n') : `Directions: ${r.links[0]}`}`,
      nextStep: 'Send sendExactly word for word and stop.',
    };
  }
}
