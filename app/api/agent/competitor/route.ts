import { NextResponse } from 'next/server';
import { one, businessWeekday } from '@/lib/db';
import { resolveOutlet, resolveSku } from '@/lib/match';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One sighting of a rival at a counter: from a rep's message, a voice note, or
 * a photo of a rival's scheme leaflet. The model proposes brand / product /
 * offer from what it read; the shop and our competing product go through the
 * same matchers as an order, and the raw words are stored beside the reading.
 */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const brand = String(b.brand ?? '').trim().slice(0, 40);
    if (!b.repId || brand.length < 2) return bad('repId and a rival brand are required');

    let outletId: string | null = b.outletId ? String(b.outletId) : null;
    let outlet: string | null = null;
    if (!outletId) {
      const d = await resolveOutlet(String(b.shopPhrase ?? ''), { repId: String(b.repId), weekday: businessWeekday() });
      if (d.status === 'none') return bad(d.reason);
      if (d.status === 'ambiguous')
        return NextResponse.json({ error: d.reason, options: d.candidates.map((c) => ({ key: c.id, label: `${c.name}, ${c.area}` })) }, { status: 400 });
      outletId = d.value.id; outlet = d.value.name;
    } else outlet = (await one<{ name: string }>(`SELECT name FROM outlets WHERE id = $1`, [outletId]))?.name ?? null;
    if (!outlet) return bad('unknown counter');

    // Which of ours it hits, only when the matcher is sure. A wrong link is worse than none.
    let ourSku: { id: string; name: string } | null = null;
    const what = String(b.ourProduct ?? b.product ?? '').trim();
    if (what) {
      const s = await resolveSku(what, { outletId });
      if (s.status === 'resolved' && s.confidence >= 0.6) ourSku = { id: s.value.id, name: s.value.name };
    }

    const id = `CI-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    await one(
      `INSERT INTO competitor_intel (id, outlet_id, rep_id, brand, product, offer, our_sku_id, raw, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [id, outletId, String(b.repId), brand, b.product ? String(b.product).slice(0, 60) : null,
       b.offer ? String(b.offer).slice(0, 40) : null, ourSku?.id ?? null,
       String(b.raw ?? '').slice(0, 500) || `${brand} ${b.offer ?? ''}`.trim(),
       ['rep', 'chemist', 'photo'].includes(b.source) ? b.source : 'rep']);

    const [seen] = [await one<{ n: number }>(
      `SELECT count(DISTINCT outlet_id)::int AS n FROM competitor_intel
        WHERE lower(brand) = lower($1) AND seen_at >= now() - interval '7 days'`, [brand])];
    return NextResponse.json({ id, outletId, outlet, brand, ourProduct: ourSku?.name ?? null, countersThisWeek: seen?.n ?? 1 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'competitor failed' }, { status: 500 });
  }
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
