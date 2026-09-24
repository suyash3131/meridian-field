import { LuaTool, User } from 'lua-cli';
import { z } from 'zod';
import { get, currentManager } from '../../lib/api';
import { noteShown } from '../../lib/guard';
import { buttons, onEmail } from '../../lib/rich';

/**
 * A manager adds a counter by chat: "add Krishna Medical, Karol Bagh, limit 25k".
 *
 * Nothing is saved here. The place is found (a Google Maps link they shared,
 * coordinates, or a map search on the name and area), and the manager is shown
 * exactly what would be saved, with a pin to tap. Only their own "yes"
 * (confirm_setup) saves it. A counter already on file with a similar name
 * close by is pointed out before anything else.
 */
export default class AddCounterTool implements LuaTool {
  name = 'add_counter';
  description =
    'A manager wants to add a new counter (chemist shop). Finds it on the map and shows what would be saved for them to confirm. ' +
    'Also use it again when they send a Google Maps link or location to correct the pin.';

  inputSchema = z.object({
    name: z.string().describe('Shop name as the manager wrote it.'),
    area: z.string().describe('Locality, e.g. "Karol Bagh".'),
    place: z.string().optional().describe('A Google Maps link, coordinates or address they gave, verbatim.'),
    creditLimitRupees: z.number().int().min(0).max(500000).optional().describe('"25k" is 25000. Default 25000.'),
    region: z.enum(['North', 'South']).optional().describe('Only for the regional head; an ASM\'s own region is used otherwise.'),
    email: z.string().optional().describe('The chemist\'s email, if given.'),
    phone: z.string().optional().describe('The chemist\'s WhatsApp number, if given.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const mgr = await currentManager();
    const region = mgr.region ?? input.region;
    if (!region) return { sendExactly: 'North or South?', nextStep: 'Send sendExactly word for word and stop.' };

    const tries = [input.place, `${input.name}, ${input.area}`, input.area].filter(Boolean) as string[];
    let pin: any = null;
    for (const q of tries) {
      // Exact search for the shop by name; typo-tolerant only for the area.
      const strict = q === `${input.name}, ${input.area}` ? '&strict=1' : '';
      pin = await get<any>(`/api/manager/geocode?region=${region}${strict}&q=${encodeURIComponent(q)}`).catch(() => null);
      if (pin?.lat) {
        pin.from = q === input.place ? (pin.source === 'map search' ? 'the address you gave' : 'your link') : q === input.area ? `the centre of ${input.area}` : 'a map search';
        if (q === input.area) pin.exact = false;
        break;
      }
    }
    if (!pin?.lat)
      return { sendExactly: `I couldn't find "${input.area}" on the map. Send the shop's location (📎 → Location) or its Google Maps link.`,
               nextStep: 'Send sendExactly word for word and stop.' };

    // Already on file, close by? Say so before anything else.
    const { outlets = [] } = await get<{ outlets: any[] }>('/api/manager/outlets');
    const core = (s: string) => s.toLowerCase().replace(/\b(chemists?|medicals?|medicos?|stores?|pharmacy|pharma|agency|drugs?)\b/g, '').trim();
    const near = outlets.find((o) => core(o.name) && core(o.name) === core(input.name) && metres(o.lat, o.lng, pin.lat, pin.lng) < 1500);

    const name = tidy(input.name), area = tidy(input.area);
    const limit = input.creditLimitRupees ?? 25000;
    const limitText = '₹' + limit.toLocaleString('en-IN');
    await noteShown([limitText]);   // the manager's own figure, echoed back, not computed
    const user = await User.get();
    await user?.patch({ set: { pendingSetup: {
      kind: 'counter', at: new Date().toISOString(),
      data: { name, area, region, lat: pin.lat, lng: pin.lng,
              creditLimitRupees: limit, email: input.email ?? null, phone: input.phone ?? null },
    } } } as any);

    const map = `https://www.google.com/maps?q=${pin.lat.toFixed(5)},${pin.lng.toFixed(5)}`;
    // Free map search knows roads and localities, rarely a small shop. When the
    // pin is only the road or the area, say so plainly and make fixing it one step.
    const found = pin.label ? String(pin.label).split(',').slice(0, 2).join(',').trim() : '';
    const where = pin.exact
      ? `📍 ${found ? `Found on the map: ${found}` : `Pin from ${pin.from}`}`
      : `📍 Approximate pin: ${pin.from.startsWith('the centre') ? pin.from : pin.kind === 'road' && found ? `on ${found}` : found ? `near ${found}` : pin.from}, not at the shop itself. The map doesn't list this shop.`;
    const how = pin.exact ? '' : '\n\nFor the exact spot, send the shop\'s location (📎 → Location) or its Google Maps link. Or save it now and fix the pin later.';
    return {
      sendExactly:
        (near ? `⚠ ${near.name}, ${near.area} is already on file nearby (${near.id}). Same shop?\n\n` : '') +
        `**Add this counter?**\n\n**${name}** · ${area} · ${region}\nCredit limit ${limitText}` +
        (input.email ? `\nChemist email: ${input.email}` : '') + (input.phone ? `\nChemist WhatsApp: ${input.phone}` : '') +
        `\n\n${where}\n${map}${how}` +
        (onEmail() ? '\n\nReply *yes* to save or *no* to drop it.' : '') +
        buttons(pin.exact ? ['Yes, add it', 'No'] : ['Save with this pin', 'Send exact pin', 'Cancel']),
      nextStep: 'Send sendExactly word for word, including the ::: block, and stop. On yes / save / no / cancel / "send exact pin", call confirm_setup.',
    };
  }
}

/** "city chemist" → "City Chemist"; a name typed with capitals is kept as typed. */
function tidy(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t === t.toLowerCase() ? t.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : t;
}

function metres(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000, r = (d: number) => (d * Math.PI) / 180;
  const x = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
