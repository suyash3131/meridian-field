import { NextRequest, NextResponse } from 'next/server';
import { confirmOrder } from '@/lib/order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.draftId)
      return NextResponse.json({ error: 'draftId is required' }, { status: 400 });
    return NextResponse.json(await confirmOrder(String(b.draftId)));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'confirm failed' }, { status: 500 });
  }
}
