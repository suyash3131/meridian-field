import { NextRequest, NextResponse } from 'next/server';
import { answerFor } from '@/lib/analysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REGIONS = ['North', 'South'];

/**
 * The model picks the scope; this computes every number in the answer.
 * `region` is matched against a fixed list rather than interpolated, so a
 * question cannot reach the query.
 */
export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get('region') ?? '').trim().toLowerCase();
  const region = REGIONS.find((r) => r.toLowerCase() === raw) ?? null;
  return NextResponse.json(await answerFor(region));
}
