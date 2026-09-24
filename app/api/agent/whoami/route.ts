import { NextRequest, NextResponse } from 'next/server';
import { one, sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Bind a conversation to a rep, once.
 *
 * On WhatsApp the phone number is the identity and Meta has already verified
 * it, so `phone` wins whenever it matches a rep. `claimedRepId` is only ever
 * consulted when there is no phone — the browser demo — and even then it is
 * checked against the roster rather than trusted. After the first bind the
 * agent reads the rep from its own user record and stops asking.
 *
 * On email the sender's address is the identity, the same way the phone is on
 * WhatsApp. An address can belong to a manager instead of a rep: managers are
 * let in to ask about their territory, and the order tools refuse them.
 */
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const phone = b.phone ? String(b.phone).replace(/[^\d]/g, '') : '';

    if (phone) {
      const byPhone = await one<{ id: string; name: string; region: string }>(
        `SELECT id, name, region FROM reps WHERE regexp_replace(phone, '[^0-9]', '', 'g') LIKE '%' || $1`,
        [phone.slice(-10)]
      );
      if (byPhone) return NextResponse.json({ ...byPhone, role: 'rep', verifiedBy: 'phone number' });
      const mgr = await one<{ id: string; name: string; region: string | null; role: string }>(
        `SELECT id, name, region, role FROM managers WHERE regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') LIKE '%' || $1`,
        [phone.slice(-10)]
      );
      if (mgr) return NextResponse.json({ ...mgr, role: 'manager', title: mgr.role, verifiedBy: 'phone number' });
      const shops = await chemistShops('phone', phone.slice(-10));
      if (shops.length) return NextResponse.json({ id: shops[0].id, name: shops[0].name, role: 'chemist', shops, verifiedBy: 'phone number' });
      // A number WhatsApp vouches for but nobody on the roster owns is turned
      // away, like an unknown email address. It never falls through to a claim.
      if (!b.email && !b.claimedRepId)
        return NextResponse.json({ error: 'this number is not on the team roster' }, { status: 404 });
    }

    const email = b.email ? String(b.email).trim().toLowerCase() : '';
    if (email) {
      const rep = await one<{ id: string; name: string; region: string }>(
        `SELECT id, name, region FROM reps WHERE lower(email) = $1`, [email]);
      if (rep) return NextResponse.json({ ...rep, role: 'rep', verifiedBy: 'email address' });
      const mgr = await one<{ id: string; name: string; region: string | null; role: string }>(
        `SELECT id, name, region, role FROM managers WHERE lower(email) = $1`, [email]);
      if (mgr) return NextResponse.json({ ...mgr, role: 'manager', title: mgr.role, verifiedBy: 'email address' });
      // A chemist writing back about their order. They are customers, not
      // staff: let in to ask about their own shop, never to place or approve.
      const shops = await chemistShops('email', email);
      if (shops.length) return NextResponse.json({ id: shops[0].id, name: shops[0].name, role: 'chemist', shops, verifiedBy: 'email address' });
      // An unknown address is never offered the "which rep are you?" route the
      // browser demo has: anyone can type a name into an email.
      return NextResponse.json({ error: 'this address is not on the team roster' }, { status: 404 });
    }

    if (b.claimedRepId) {
      const claimed = await one<{ id: string; name: string; region: string }>(
        `SELECT id, name, region FROM reps WHERE id = $1`, [String(b.claimedRepId).toUpperCase()]
      );
      if (claimed) return NextResponse.json({ ...claimed, role: 'rep', verifiedBy: 'session' });
    }

    return NextResponse.json({ error: 'no rep matches this conversation' }, { status: 404 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'whoami failed' }, { status: 500 });
  }
}

/** The counters an address or number belongs to. One inbox can run several shops. */
function chemistShops(by: 'email' | 'phone', v: string) {
  return by === 'email'
    ? sql<{ id: string; name: string; area: string }>(
        `SELECT id, name, area FROM outlets WHERE lower(email) = $1 ORDER BY name`, [v])
    : sql<{ id: string; name: string; area: string }>(
        `SELECT id, name, area FROM outlets WHERE regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') LIKE '%' || $1 ORDER BY name`, [v]);
}
