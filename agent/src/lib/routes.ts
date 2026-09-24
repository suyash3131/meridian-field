import { User } from 'lua-cli';
import { get } from './api';
import { buttons, onEmail } from './rich';

/**
 * "Put it on a route?" with real choices: the routes whose nearest stop is
 * closest to the new counter, worked out by the CRM. Tapping one puts it there;
 * a bare "yes" means the first. Remembered for set_route for 30 minutes.
 */
export async function routeOffer(outletId: string, name: string): Promise<string> {
  const { fits = [] } = await get<any>(`/api/manager/route-fit?outletId=${encodeURIComponent(outletId)}`).catch(() => ({ fits: [] }));
  const u: any = await User.get();
  const first = (n: string) => String(n).split(' ')[0];
  const options = fits.slice(0, 2);
  await u?.patch({ set: { pendingRoute: { outletId, name, at: new Date().toISOString(),
    options: options.map((f: any) => ({ repId: f.repId, rep: f.rep, weekday: f.weekday })) } } });
  if (!options.length) return 'Put it on a route? Name the rep and the day, e.g. "Ramesh, Monday".';
  const km = (f: any) => f.km == null ? 'an empty route' : f.km < 1 ? `${Math.round(f.km * 1000)} m from a stop` : `${f.km} km from a stop`;
  const [a, b] = options;
  const far = a.km != null && a.km > 25 ? `\n⚠ No route passes near it yet: the closest stop is ${a.km} km away.` : '';
  return `**Put it on a route?**\n${a.rep} · ${a.day} is closest (${km(a)}).` +
    (b ? `\nNext: ${b.rep} · ${b.day} (${km(b)}).` : '') + far +
    (onEmail() ? `\n\nReply *yes* for ${first(a.rep)} · ${a.day}, or name another rep and day.` : '\n\nOr type any rep and day.') +
    buttons([...options.map((f: any) => `${first(f.rep)} · ${f.day}`), 'Not now']);
}
