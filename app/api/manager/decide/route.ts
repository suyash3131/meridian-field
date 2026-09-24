import { NextResponse } from 'next/server';
import { decide } from '@/lib/approvals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A manager's approve / reject, carried by the agent. All checks in lib/approvals.ts. */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    if (!b.managerId || !b.approvalId || !['approve', 'reject'].includes(b.decision))
      return NextResponse.json({ error: 'managerId, approvalId and decision (approve|reject) are required' }, { status: 400 });
    const r = await decide({ managerId: String(b.managerId), approvalId: String(b.approvalId),
                             decision: b.decision, note: b.note ? String(b.note).slice(0, 300) : undefined });
    return NextResponse.json(r, { status: 'error' in r ? 403 : 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'decide failed' }, { status: 500 });
  }
}
