import { NextResponse } from 'next/server';
import { sql, one } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The site has no login, by design, so this is open to anyone who finds it.
 *  A hard ceiling keeps a curious visitor from filling the demo with shops. */
const MAX_ADDED = 40;

/** Every counter this business serves is in India. */
const inIndia = (lat: number, lng: number) => lat > 6 && lat < 37 && lng > 68 && lng < 98;

/** All active counters, for the manager's map and route planner. */
export async function GET() {
  const outlets = await sql(
    `SELECT id, name, area, region, lat, lng, credit_limit_paise, id LIKE 'OUT-N%' AS is_new
       FROM outlets WHERE status = 'active' ORDER BY region, name`);
  return NextResponse.json({ outlets });
}

/** A manager adds a counter. Its own name becomes its first alias, so the
 *  agent can resolve it the moment a rep types it. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? '').trim().replace(/\s+/g, ' ');
  const area = String(b.area ?? '').trim().replace(/\s+/g, ' ');
  const region = b.region === 'South' ? 'South' : b.region === 'North' ? 'North' : null;
  const lat = Number(b.lat), lng = Number(b.lng);
  const limitRupees = Math.round(Number(b.creditLimitRupees ?? 25000));

  if (name.length < 3 || name.length > 60) return bad('Give the counter a name, 3 to 60 letters.');
  if (area.length < 2 || area.length > 40) return bad('Give the area, like "Karol Bagh".');
  if (!region) return bad('Pick North or South.');
  if (!inIndia(lat, lng)) return bad('Drop the pin on the map where the counter is.');
  if (!(limitRupees >= 0 && limitRupees <= 500000)) return bad('Credit limit must be between ₹0 and ₹5,00,000.');

  const added = await one<{ n: number }>(`SELECT count(*)::int AS n FROM outlets WHERE id LIKE 'OUT-N%'`);
  if ((added?.n ?? 0) >= MAX_ADDED) return bad('This demo has reached its limit of new counters.');

  const dupe = await one(`SELECT id FROM outlets WHERE lower(name) = lower($1) AND lower(area) = lower($2)`, [name, area]);
  if (dupe) return bad(`${name}, ${area} is already on file.`);

  const id = 'OUT-N' + Date.now().toString(36).slice(-5).toUpperCase();
  await sql(
    `INSERT INTO outlets (id, name, area, region, lat, lng, credit_limit_paise)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, name, area, region, lat, lng, limitRupees * 100]);
  await sql(
    `INSERT INTO outlet_aliases (outlet_id, alias, source) VALUES ($1, $2, 'seed')
     ON CONFLICT DO NOTHING`, [id, name.toLowerCase()]);

  return NextResponse.json({ id });
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
