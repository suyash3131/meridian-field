import { NextRequest, NextResponse } from 'next/server';
import { logVisit } from '@/lib/order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OUTCOMES = ['no_order', 'stock_note', 'competitor'] as const;

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const outcome = OUTCOMES.includes(b.outcome) ? b.outcome : 'no_order';
    if (!b.repId || !b.shopPhrase)
      return NextResponse.json({ error: 'repId and shopPhrase are required' }, { status: 400 });
    if (!b.reason || !String(b.reason).trim())
      // A visit with no order and no reason is indistinguishable from a rep at
      // home tapping a button. The reason IS the evidence, so it is required.
      return NextResponse.json({ error: 'a reason is required for a no-order visit' }, { status: 400 });

    return NextResponse.json(await logVisit({
      repId: String(b.repId),
      shopPhrase: String(b.shopPhrase),
      outcome,
      reason: String(b.reason),
      gps: b.gps?.lat != null ? { lat: Number(b.gps.lat), lng: Number(b.gps.lng) } : undefined,
      photoUrl: b.photoUrl ? String(b.photoUrl) : undefined,
      threadId: b.threadId ? String(b.threadId) : undefined,
      rawMessage: String(b.rawMessage ?? b.reason),
    }));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'visit failed' }, { status: 500 });
  }
}
