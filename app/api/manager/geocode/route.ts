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
    if (link && pin) return NextResponse.json({ ...pin, source: 'maps link', label: null });
  }
  if (pin) return NextResponse.json({ ...pin, source: 'coordinates', label: null });

  // 3. A place name, looked up on OpenStreetMap, restricted to India.
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&q=${encodeURIComponent(text)}`, {
    headers: { 'user-agent': 'meridian-field-demo/1.0 (interview prototype)', 'accept-language': 'en' },
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);
  const hit = r?.ok ? (await r.json().catch(() => []))[0] : null;
  if (!hit) return NextResponse.json({ error: `could not find "${text}" on the map` }, { status: 404 });
  return NextResponse.json({ lat: Number(hit.lat), lng: Number(hit.lon), source: 'map search', label: hit.display_name });
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
