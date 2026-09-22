import { NextRequest, NextResponse } from 'next/server';
import { requestPriceException } from '@/lib/order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.repId || !b.ask)
      return NextResponse.json({ kind: 'error', message: 'repId and ask are required' }, { status: 400 });
    return NextResponse.json(await requestPriceException({ repId: String(b.repId), ask: String(b.ask), shop: b.shop ? String(b.shop) : undefined }));
  } catch (e) {
    return NextResponse.json(
      { kind: 'error', message: e instanceof Error ? e.message : 'price request failed' }, { status: 500 });
  }
}
