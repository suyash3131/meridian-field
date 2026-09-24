import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where a counter is, from what a manager can give on a phone: a Google Maps
 * link (they tap Share in Maps), a pair of coordinates, or a name and area to
 * look up on OpenStreetMap. The answer is only ever a proposal: the manager
 * sees the pin and says yes before anything is saved.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const text = (u.searchParams.get('q') ?? '').trim();
  if (!text) return NextResponse.json({ error: 'nothing to look up' }, { status: 400 });

  // 1. Coordinates written out, or inside a full Maps URL ("@28.65,77.19" / "q=28.65,77.19").
  let pin = coords(text);
  // 2. A short share link (maps.app.goo.gl/…): follow the redirect, read the coordinates.
  if (!pin) {
    const link = text.match(/https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.[a-z.]+|www\.google\.[a-z.]+\/maps)\S*/i)?.[0];
    if (link) pin = await followLink(link);
    if (link && pin) return NextResponse.json({ ...pin, source: 'maps link', label: null, exact: true });
  }
  if (pin) return NextResponse.json({ ...pin, source: 'coordinates', label: null, exact: true });

  // Near where this manager's counters are: Delhi for North, Bengaluru for South.
  const near = u.searchParams.get('region') === 'South' ? { lat: 12.936, lng: 77.609, city: 'Bengaluru' }
             : { lat: 28.68, lng: 77.165, city: 'Delhi' };

  // 3. A place name, looked up on OpenStreetMap, restricted to India.
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&q=${encodeURIComponent(text)}`, {
    headers: { 'user-agent': 'meridian-field-demo/1.0 (interview prototype)', 'accept-language': 'en' },
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);
  const hit = r?.ok ? (await r.json().catch(() => []))[0] : null;
  if (hit && inIndia(Number(hit.lat), Number(hit.lon)))
    return NextResponse.json({ lat: Number(hit.lat), lng: Number(hit.lon), source: 'map search', label: hit.display_name,
      // Only a shop or pharmacy found by name is the place itself. A road or a
      // locality is where the shop is near, and is said to be so.
      exact: PLACE.has(hit.category), kind: hit.category === 'highway' ? 'road' : 'area' });

  // 4. Typed in a hurry ("Rajendr nagar"): Photon, OpenStreetMap's typo-tolerant
  //    search, biased toward the manager's own city. Only for an area: fuzzy on a
  //    shop name found "Shiv Krishna Hospital" in another city's Rajendra Nagar.
  if (u.searchParams.get('strict') === '1')
    return NextResponse.json({ error: `could not find "${text}" on the map` }, { status: 404 });
  const ph = await fetch(`https://photon.komoot.io/api/?limit=1&lat=${near.lat}&lon=${near.lng}&q=${encodeURIComponent(text)}`, {
    headers: { 'user-agent': 'meridian-field-demo/1.0 (interview prototype)' }, signal: AbortSignal.timeout(6000),
  }).catch(() => null);
  const f = ph?.ok ? (await ph.json().catch(() => ({})))?.features?.[0] : null;
  const [lng, lat] = f?.geometry?.coordinates ?? [];
  if (f && inIndia(lat, lng))
    return NextResponse.json({ lat, lng, source: 'map search', exact: PLACE.has(f.properties?.osm_key),
      kind: f.properties?.osm_key === 'highway' ? 'road' : 'area',
      label: [f.properties?.name, f.properties?.district ?? f.properties?.city ?? near.city].filter(Boolean).join(', ') });
  return NextResponse.json({ error: `could not find "${text}" on the map` }, { status: 404 });
}

function coords(s: string) {
  const m = s.match(/(?:@|q=|ll=|query=|^|\s)(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{2,3}\.\d{3,})/)
         ?? s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return lat > 6 && lat < 37 && lng > 68 && lng < 98 ? { lat, lng } : null;
}

async function followLink(url: string) {
  let at = url;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(at, { redirect: 'manual', signal: AbortSignal.timeout(5000) }).catch(() => null);
    const next = r?.headers.get('location');
    const found = coords(decodeURIComponent(next ?? at));
    if (found) return found;
    if (!next) {
      const body = r ? await r.text().catch(() => '') : '';
      return coords(body.slice(0, 20000));
    }
    at = next.startsWith('http') ? next : new URL(next, at).toString();
  }
  return null;
}

const PLACE = new Set(['amenity', 'shop', 'healthcare']);

const inIndia = (lat: number, lng: number) => lat > 6 && lat < 37 && lng > 68 && lng < 98;
