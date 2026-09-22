import { NextRequest, NextResponse } from 'next/server';
import { declineDraft } from '@/lib/order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.draftId)
      return NextResponse.json({ kind: 'error', message: 'draftId is required' }, { status: 400 });
    return NextResponse.json(await declineDraft(String(b.draftId)));
  } catch (e) {
    return NextResponse.json(
      { kind: 'error', message: e instanceof Error ? e.message : 'decline failed' }, { status: 500 });
  }
}
