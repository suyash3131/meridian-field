import { NextRequest, NextResponse } from 'next/server';
import { answerDraft } from '@/lib/order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.draftId || !b.pick)
      return NextResponse.json({ kind: 'error', message: 'draftId and pick are required' }, { status: 400 });
    return NextResponse.json(await answerDraft({ draftId: String(b.draftId), pick: String(b.pick) }));
  } catch (e) {
    return NextResponse.json(
      { kind: 'error', message: e instanceof Error ? e.message : 'answer failed' }, { status: 500 });
  }
}
