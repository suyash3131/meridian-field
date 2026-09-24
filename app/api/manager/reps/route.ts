import { NextResponse } from 'next/server';
import { one, sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A manager adds a rep to their own team. The manager id comes from the
 * agent's verified record of who is asking; the rep lands in that manager's
 * region, reporting to them. The phone number is how WhatsApp will know him,
 * so it must be new to the roster.
 */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? '').trim().replace(/\s+/g, ' ');
  const phoneDigits = String(b.phone ?? '').replace(/\D/g, '');
  const email = b.email ? String(b.email).trim().toLowerCase() : null;

  const mgr = await one<{ id: string; region: string | null; role: string }>(
    `SELECT id, region, role FROM managers WHERE id = $1`, [String(b.managerId ?? '')]);
  if (!mgr) return bad('Only a manager can add a rep.');
  const region = mgr.region ?? (b.region === 'South' ? 'South' : b.region === 'North' ? 'North' : null);
  if (!region) return bad('Say which region, North or South.');
  if (name.length < 3 || name.length > 40) return bad('Give the rep a full name.');
  if (phoneDigits.length < 10) return bad('Give his WhatsApp number, with the country code.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('That email address does not look right.');

  const phone = '+' + (phoneDigits.length === 10 ? '91' + phoneDigits : phoneDigits);
  const taken = await one<{ who: string }>(
    `SELECT name AS who FROM reps WHERE regexp_replace(phone, '[^0-9]', '', 'g') LIKE '%' || $1
     UNION ALL SELECT name FROM managers WHERE regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') LIKE '%' || $1
     LIMIT 1`, [phoneDigits.slice(-10)]);
  if (taken) return bad(`That number already belongs to ${taken.who}.`);

  const [n] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM reps`);
  if (n.n >= 60) return bad('This demo has reached its limit of reps.');
  const asmId = mgr.role === 'asm' ? mgr.id
    : (await one<{ id: string }>(`SELECT id FROM managers WHERE role = 'asm' AND region = $1 LIMIT 1`, [region]))?.id;
  const id = `R-${String(100 + n.n).padStart(2, '0')}`;
  await sql(`INSERT INTO reps (id, name, phone, asm_id, region, email) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, name, phone, asmId, region, email]);
  return NextResponse.json({ id, name, region, phone });
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
