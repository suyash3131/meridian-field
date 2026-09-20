import { NextRequest, NextResponse } from 'next/server';
import { draftOrder } from '@/lib/order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The model proposes; this endpoint decides. Everything it is given is treated
// as a claim: the shop is a phrase, not an id, and the quantities are numbers
// the resolver still has to attach to a real SKU at a real price.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.repId || !b.shopPhrase)
      return NextResponse.json({ kind: 'error', message: 'repId and shopPhrase are required' }, { status: 400 });

    const result = await draftOrder({
      repId: String(b.repId),
      shopPhrase: String(b.shopPhrase),
      items: Array.isArray(b.items)
        ? b.items.map((i: { phrase: string; qty: number }) => ({
            phrase: String(i.phrase), qty: Math.max(1, Math.trunc(Number(i.qty) || 1)),
          }))
        : [],
      creditDays: b.creditDays != null ? Math.trunc(Number(b.creditDays)) : undefined,
      gps: b.gps?.lat != null ? { lat: Number(b.gps.lat), lng: Number(b.gps.lng) } : undefined,
      photoUrl: b.photoUrl ? String(b.photoUrl) : undefined,
      threadId: b.threadId ? String(b.threadId) : undefined,
      rawMessage: String(b.rawMessage ?? ''),
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { kind: 'error', message: e instanceof Error ? e.message : 'draft failed' }, { status: 500 });
  }
}
