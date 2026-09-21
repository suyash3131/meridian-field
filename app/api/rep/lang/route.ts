import { NextResponse } from 'next/server';
import { one, sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The language a rep chose in the app. The agent's tools read this and
 *  write their replies in it, so it never rests on the model remembering. */
export async function GET(req: Request) {
  const repId = new URL(req.url).searchParams.get('repId') ?? '';
  const r = await one<{ lang: string }>(`SELECT lang FROM reps WHERE id = $1`, [repId]);
  return NextResponse.json({ lang: r?.lang ?? 'en' });
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const lang = b.lang === 'hi' ? 'hi' : 'en';
  const rows = await sql(`UPDATE reps SET lang = $2 WHERE id = $1 RETURNING id`, [String(b.repId ?? ''), lang]);
  if (!rows.length) return NextResponse.json({ error: 'no such rep' }, { status: 404 });
  return NextResponse.json({ lang });
}
