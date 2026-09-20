import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The rep's phone publishes its own position here, once per counter.
 * Nothing in the conversation reaches this endpoint: the agent has no tool
 * that accepts a coordinate, so a location can only ever come from a device,
 * never from a sentence. On WhatsApp this is the location attachment; in the
 * browser it is navigator.geolocation.
 */
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const lat = Number(b.lat), lng = Number(b.lng);
    if (!b.repId || !Number.isFinite(lat) || !Number.isFinite(lng))
      return NextResponse.json({ error: 'repId, lat and lng are required' }, { status: 400 });
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180)
      return NextResponse.json({ error: 'coordinates out of range' }, { status: 400 });

    await sql(
      `INSERT INTO rep_positions (rep_id, lat, lng, accuracy_m, photo_url, at)
       VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (rep_id) DO UPDATE SET
         lat = EXCLUDED.lat, lng = EXCLUDED.lng,
         accuracy_m = EXCLUDED.accuracy_m,
         photo_url = COALESCE(EXCLUDED.photo_url, rep_positions.photo_url),
         at = now()`,
      [String(b.repId), lat, lng,
       b.accuracyM != null ? Math.round(Number(b.accuracyM)) : null,
       b.photoUrl ? String(b.photoUrl) : null]
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'position failed' }, { status: 500 });
  }
}
