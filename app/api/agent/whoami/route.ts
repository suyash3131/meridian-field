import { NextRequest, NextResponse } from 'next/server';
import { one } from '@/lib/db';

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
      if (byPhone) return NextResponse.json({ ...byPhone, verifiedBy: 'phone number' });
    }

    if (b.claimedRepId) {
      const claimed = await one<{ id: string; name: string; region: string }>(
        `SELECT id, name, region FROM reps WHERE id = $1`, [String(b.claimedRepId).toUpperCase()]
      );
      if (claimed) return NextResponse.json({ ...claimed, verifiedBy: 'session' });
    }

    return NextResponse.json({ error: 'no rep matches this conversation' }, { status: 404 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'whoami failed' }, { status: 500 });
  }
}
