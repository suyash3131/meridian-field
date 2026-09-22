import { NextRequest, NextResponse } from 'next/server';
import { requestOrderChange } from '@/lib/order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.repId || !b.change)
      return NextResponse.json({ kind: 'error', message: 'repId and change are required' }, { status: 400 });
    return NextResponse.json(await requestOrderChange({
      repId: String(b.repId), change: String(b.change), orderId: b.orderId ? String(b.orderId) : undefined,
    }));
  } catch (e) {
    return NextResponse.json(
      { kind: 'error', message: e instanceof Error ? e.message : 'change request failed' }, { status: 500 });
  }
}
