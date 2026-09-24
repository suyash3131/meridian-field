import { LuaTool, User } from 'lua-cli';
import { z } from 'zod';
import { get, currentManager, thisTurn } from '../../lib/api';
import { buttons } from '../../lib/rich';

const DAY = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 } as const;
const NAME = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * A manager changes a rep's route by chat: "put City Chemist on Ramesh's
 * Monday route", "take Krishna off Sunil's Tuesday". Counters are matched the
 * same way orders match them; anything unclear is asked, never guessed. The
 * reply is the whole new route with a map link, so a wrong change is obvious.
 *
 * Right after a counter is added, the counter and the suggested routes are
 * remembered (pendingRoute): a tap on "Ramesh · Monday" or a bare "yes" puts
 * that exact counter there, and a missing rep or day is asked with the
 * closest choices to tap, not as an open question.
 */
const YES = /^\s*(yes|yeah|yep|haan|han|ha|ok|okay|sure|kar do|theek|thik)\b/i;
export default class SetRouteTool implements LuaTool {
  name = 'set_route';
  description = 'A manager adds counters to, or removes them from, a rep\'s route for a weekday. Also the answer to ' +
    '"Put it on a route?" after a counter is added: a tapped "Ramesh · Monday", a rep or day on its own, or yes.';

  inputSchema = z.object({
    rep: z.string().optional().describe('The rep\'s name as the manager said or tapped it. Leave out if not said.'),
    day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']).optional().describe('Leave out if not said.'),
    add: z.array(z.string()).optional().describe('Counters to add, as named.'),
    remove: z.array(z.string()).optional().describe('Counters to take off, as named.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const mgr = await currentManager();
    const u: any = await User.get();
    const said = (await thisTurn()).text;
    const pr = u?.pendingRoute && Date.now() - new Date(u.pendingRoute.at).getTime() < 30 * 60 * 1000 ? u.pendingRoute : null;
    const ask = (text: string, taps: string[] = []) => ({ sendExactly: text + buttons(taps),
      nextStep: 'Send sendExactly word for word, including any ::: block, and stop. On their answer, call set_route again with rep and day.' });

    // A bare "yes" to "Put it on a route?" means the first suggestion.
    let repName = input.rep, dayKey = input.day as keyof typeof DAY | undefined;
    if (!repName && !dayKey && pr?.options?.[0] && YES.test(said)) {
      repName = pr.options[0].rep; dayKey = NAME[pr.options[0].weekday].toLowerCase() as keyof typeof DAY;
    }

    const { reps = [] } = await get<{ reps: any[] }>('/api/reps');
    const mine = reps.filter((r) => !mgr.region || r.region === mgr.region);
    const want = (repName ?? '').toLowerCase().trim();
    const hit = want ? mine.filter((r) => r.name.toLowerCase().includes(want.split(/\s+/)[0]) || r.id.toLowerCase() === want) : [];
    if (hit.length !== 1) {
      // Closest reps first when there is a counter in hand, else the roster.
      const fits = pr ? (await get<any>(`/api/manager/route-fit?outletId=${pr.outletId}`).catch(() => ({ fits: [] }))).fits ?? [] : [];
      const names = [...new Set([...fits.map((f: any) => f.rep), ...mine.map((r) => r.name)])] as string[];
      return ask(`Which rep${pr ? ` for **${pr.name}**` : ''}?${hit.length > 1 ? ` "${repName}" could be ${hit.map((r) => r.name).join(' or ')}.` : ''}`,
        names.slice(0, 3).map((n) => n.split(' ')[0]));
    }
    const rep = hit[0];
    if (!dayKey) {
      if (!pr) return ask(`Which day for ${rep.name}? Monday to Saturday.`);
      const { fits = [] } = await get<any>(`/api/manager/route-fit?outletId=${pr.outletId}&repId=${rep.id}`).catch(() => ({ fits: [] }));
      const top = fits.slice(0, 3);
      const km = (f: any) => f.km == null ? 'empty route' : `${f.km} km from a stop`;
      return ask(`Which day for ${rep.name}?` + (top.length ? `\n${top.map((f: any) => `${f.day}: ${km(f)}`).join('\n')}` : ' Monday to Saturday.'),
        top.map((f: any) => f.day));
    }
    const weekday = DAY[dayKey];
    const known = (phrase: string) => pr && (pr.name.toLowerCase() === phrase.toLowerCase().trim() || pr.outletId === phrase.toUpperCase());
    const addList = input.add?.length ? input.add : pr && !input.remove?.length ? [pr.name] : [];

    const resolve = async (phrase: string) => {
      // The counter just added: its id is known, no matching (a same-named shop elsewhere can't be picked).
      if (known(phrase)) return { id: pr.outletId as string, name: pr.name as string };
      const r = await get<any>(`/api/agent/outlet?q=${encodeURIComponent(phrase)}&repId=${encodeURIComponent(rep.id)}`);
      return r.status === 'resolved' ? { id: r.outlet.id as string, name: r.outlet.name as string }
        : { error: `"${phrase}": ${r.reason ?? 'not found'}`, options: (r.candidates ?? []).map((c: any) => `${c.name}, ${c.area}`) };
    };
    const adds = await Promise.all(addList.map(resolve));
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

    if (pr && (adds as any[]).some((x) => x.id === pr.outletId)) await u.patch({ set: { pendingRoute: null } });
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
