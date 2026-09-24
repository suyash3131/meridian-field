import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { get, currentManager } from '../../lib/api';

const DAY = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 } as const;
const NAME = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * A manager changes a rep's route by chat: "put City Chemist on Ramesh's
 * Monday route", "take Krishna off Sunil's Tuesday". Counters are matched the
 * same way orders match them; anything unclear is asked, never guessed. The
 * reply is the whole new route with a map link, so a wrong change is obvious.
 */
export default class SetRouteTool implements LuaTool {
  name = 'set_route';
  description = 'A manager adds counters to, or removes them from, a rep\'s route for a weekday.';

  inputSchema = z.object({
    rep: z.string().describe('The rep\'s name as the manager said it.'),
    day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']),
    add: z.array(z.string()).optional().describe('Counters to add, as named.'),
    remove: z.array(z.string()).optional().describe('Counters to take off, as named.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const mgr = await currentManager();
    const { reps = [] } = await get<{ reps: any[] }>('/api/reps');
    const mine = reps.filter((r) => !mgr.region || r.region === mgr.region);
    const want = input.rep.toLowerCase();
    const hit = mine.filter((r) => r.name.toLowerCase().includes(want) || r.id.toLowerCase() === want);
    if (hit.length !== 1)
      return { sendExactly: `Which rep? ${mine.map((r) => r.name).join(', ')}.`, nextStep: 'Send sendExactly word for word and stop.' };
    const rep = hit[0];
    const weekday = DAY[input.day];

    const resolve = async (phrase: string) => {
      const r = await get<any>(`/api/agent/outlet?q=${encodeURIComponent(phrase)}&repId=${encodeURIComponent(rep.id)}`);
      return r.status === 'resolved' ? { id: r.outlet.id as string, name: r.outlet.name as string }
        : { error: `"${phrase}": ${r.reason ?? 'not found'}`, options: (r.candidates ?? []).map((c: any) => `${c.name}, ${c.area}`) };
    };
    const adds = await Promise.all((input.add ?? []).map(resolve));
    const rems = await Promise.all((input.remove ?? []).map(resolve));
    const unclear = [...adds, ...rems].filter((x: any) => x.error) as any[];
    if (unclear.length)
      return { sendExactly: unclear.map((u) => u.error + (u.options.length ? `. Did you mean: ${u.options.slice(0, 4).join(' / ')}?` : '')).join('\n'),
               nextStep: 'Send sendExactly word for word and stop.' };

    const { stops = [] } = await get<{ stops: string[] }>(`/api/manager/routes?repId=${rep.id}&weekday=${weekday}`);
    const out = new Set((rems as any[]).map((x) => x.id));
    const next = [...stops.filter((s) => !out.has(s)), ...(adds as any[]).map((x) => x.id).filter((id) => !stops.includes(id))];
    const saved = await fetchPut({ repId: rep.id, weekday, outletIds: next });
    if (saved.error) return { sendExactly: `Not changed: ${saved.error}`, nextStep: 'Send sendExactly word for word and stop.' };

    const map = await get<any>(`/api/rep/route-map?repId=${rep.id}&weekday=${weekday}`);
    return {
      sendExactly: `✓ ${rep.name}'s ${NAME[weekday]} route, ${map.stops.length} stops:\n\n` +
        map.stops.map((s: any) => `${s.n}. ${s.name}, ${s.area}`).join('\n') +
        (map.links?.[0] ? `\n\n🗺 ${map.links[0]}` : ''),
      nextStep: 'Send sendExactly word for word and stop.',
    };
  }
}

async function fetchPut(body: unknown): Promise<any> {
  const base = process.env.CRM_API_BASE ?? 'https://meridian-sigma-gules.vercel.app';
  const r = await fetch(`${base}/api/manager/routes`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ error: 'the route service did not answer' }));
}
