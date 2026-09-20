import { sql } from './db';

// =============================================================================
// RESOLUTION
//
// A rep types "sharma medical 2 box 650". Four SKUs answer to "650" and two
// counters answer to "sharma". Nothing here guesses: each resolver returns
// either a decision it can defend or a shortlist for someone to choose from.
//
// The order the evidence is applied matters, so it is stated once here:
//
//   1. an exact alias is a fact          — somebody confirmed this spelling before
//   2. location is evidence              — you cannot be at two counters at once
//   3. today's route is weak evidence    — usually right, and wrong exactly when
//                                          a rep covers for a colleague who is ill
//   4. name similarity is a guess        — used only to build the shortlist
//
// Resolution by evidence costs the rep nothing. Resolution by asking costs him
// seconds he does not have, so asking is the last resort, never the first.
// =============================================================================

/** Below this, a name is too different to be worth showing anyone. */
const SIMILARITY_FLOOR = 0.28;

/** The top candidate must beat the runner-up by this much to win outright. */
const CLEAR_WIN_GAP = 0.18;

/** Inside this, the rep is standing at the counter. Phone GPS in a dense
 *  market is accurate to tens of metres, so this is deliberately generous. */
const AT_THE_COUNTER_M = 200;

/** Beyond this, location rules a counter out however close the name is. */
const NOWHERE_NEAR_M = 800;

export type Decision<T> =
  | { status: 'resolved'; value: T; confidence: number; method: string }
  | { status: 'ambiguous'; candidates: T[]; reason: string }
  | { status: 'none'; reason: string };

export type OutletMatch = {
  id: string; name: string; area: string; region: string;
  lat: number; lng: number;
  credit_limit_paise: string; credit_terms_days: number;
  score: number; exact: boolean; distance_m: number | null; on_beat: boolean;
};

export type SkuMatch = {
  id: string; name: string; brand: string; molecule: string | null;
  pack_desc: string; ptr_paise: string; mrp_paise: string;
  score: number; exact: boolean; bought_before: number;
};

/** Metres between two coordinates. Same haversine the seed uses, so the
 *  distances written into history and the ones checked live agree. */
export function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2
          + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

const normalise = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// -----------------------------------------------------------------------------
// OUTLET
// -----------------------------------------------------------------------------

export async function resolveOutlet(
  text: string,
  ctx: { repId?: string; gps?: { lat: number; lng: number }; weekday?: number }
): Promise<Decision<OutletMatch>> {
  const q = normalise(text);
  if (!q) return { status: 'none', reason: 'no shop name in the message' };

  const rows = await sql<OutletMatch>(
    `WITH scored AS (
       SELECT o.id, o.name, o.area, o.region, o.lat, o.lng,
              o.credit_limit_paise, o.credit_terms_days,
              GREATEST(
                COALESCE(MAX(similarity(a.alias, $1)), 0),
                similarity(lower(o.name), $1)
              )::float                                   AS score,
              COALESCE(bool_or(a.alias = $1), false)     AS exact
         FROM outlets o
         LEFT JOIN outlet_aliases a ON a.outlet_id = o.id
        WHERE o.status = 'active'
        GROUP BY o.id
     )
     SELECT * FROM scored WHERE score >= $2 OR exact
     ORDER BY exact DESC, score DESC LIMIT 8`,
    [q, SIMILARITY_FLOOR]
  );
  if (!rows.length) return { status: 'none', reason: `no counter matches "${text}"` };

  // Which of these is on the rep's route today? Weak evidence, but free.
  let onBeat = new Set<string>();
  if (ctx.repId && ctx.weekday) {
    const beat = await sql<{ outlet_id: string }>(
      `SELECT bo.outlet_id FROM beat_outlets bo
         JOIN beats b ON b.id = bo.beat_id
        WHERE b.rep_id = $1 AND b.weekday = $2`,
      [ctx.repId, ctx.weekday]
    );
    onBeat = new Set(beat.map((b) => b.outlet_id));
  }

  const scored = rows.map((r) => {
    const distance_m = ctx.gps ? metres(ctx.gps.lat, ctx.gps.lng, r.lat, r.lng) : null;
    const on_beat = onBeat.has(r.id);
    let score = r.exact ? 1 : r.score;
    if (on_beat) score += 0.08;
    if (distance_m !== null) {
      if (distance_m <= AT_THE_COUNTER_M) score += 0.5;
      else if (distance_m >= NOWHERE_NEAR_M) score -= 0.5;
    }
    return { ...r, score, distance_m, on_beat };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const [top, next] = scored;

  // Standing at one counter and nowhere near the other settles it outright.
  // This is the whole reason "sharma medical" never has to be disambiguated
  // by asking: the two Sharmas are 2.1 km apart.
  if (top.distance_m !== null && top.distance_m <= AT_THE_COUNTER_M &&
      (!next || (next.distance_m ?? Infinity) >= NOWHERE_NEAR_M))
    return { status: 'resolved', value: top, confidence: 0.99, method: 'location' };

  if (top.exact && (!next || !next.exact))
    return { status: 'resolved', value: top, confidence: 0.95, method: 'known spelling' };

  if (!next || top.score - next.score >= CLEAR_WIN_GAP)
    return { status: 'resolved', value: top, confidence: Math.min(0.94, top.score), method: 'name' };

  return {
    status: 'ambiguous',
    candidates: scored.slice(0, 4),
    reason: `"${text}" matches ${scored.length} counters and nothing separates them`,
  };
}

// -----------------------------------------------------------------------------
// SKU
// -----------------------------------------------------------------------------

export async function resolveSku(
  text: string,
  ctx: { outletId?: string }
): Promise<Decision<SkuMatch>> {
  const q = normalise(text);
  if (!q) return { status: 'none', reason: 'no product in the message' };

  // `bought_before` is how often this counter has ordered this SKU. A counter
  // that has taken the 10x10 pack of Dolomed eleven times is not suddenly
  // asking for the 5x10, so history breaks ties that a name never could.
  const rows = await sql<SkuMatch>(
    `WITH scored AS (
       SELECT s.id, s.name, s.brand, s.molecule, s.pack_desc, s.ptr_paise, s.mrp_paise,
              GREATEST(
                COALESCE(MAX(similarity(a.alias, $1)), 0),
                similarity(lower(s.name), $1),
                COALESCE(similarity(lower(s.molecule), $1), 0)
              )::float                               AS score,
              COALESCE(bool_or(a.alias = $1), false) AS exact
         FROM skus s
         LEFT JOIN sku_aliases a ON a.sku_id = s.id
        WHERE s.active
        GROUP BY s.id
     )
     SELECT sc.*,
            COALESCE((SELECT count(*) FROM order_lines ol
                        JOIN orders o ON o.id = ol.order_id
                       WHERE ol.sku_id = sc.id AND o.outlet_id = $3
                         AND o.status = 'confirmed'), 0)::int AS bought_before
       FROM scored sc
      WHERE sc.score >= $2 OR sc.exact
      ORDER BY sc.exact DESC, sc.score DESC LIMIT 8`,
    [q, SIMILARITY_FLOOR, ctx.outletId ?? null]
  );
  if (!rows.length) return { status: 'none', reason: `no product matches "${text}"` };

  const scored = rows
    // A counter that has taken this exact pack five times has told us which
    // one it means, more reliably than any spelling could. Capped so history
    // can break a tie but never override an outright name match.
    .map((r) => ({ ...r, score: (r.exact ? 1 : r.score) + Math.min(0.25, r.bought_before * 0.05) }))
    // Ties broken by id so the same question always lists its options in the
    // same order. A list that reshuffles between the asking and the answering
    // is a trap for anyone who replies with a number.
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const [top, next] = scored;

  if (!next || top.score - next.score >= CLEAR_WIN_GAP)
    return {
      status: 'resolved',
      value: top,
      confidence: Math.min(0.97, top.score),
      method: top.exact ? 'known name' : top.bought_before > 0 ? 'usual pack here' : 'name',
    };

  return {
    status: 'ambiguous',
    candidates: scored.slice(0, 4),
    reason: `"${text}" matches ${scored.length} products`,
  };
}

/**
 * Record a spelling that a human confirmed. This is the only way the alias
 * tables grow: a rep's phrasing becomes permanent once someone has verified
 * it, so the matcher needs fewer questions every week without a code change.
 */
export async function learnAlias(
  kind: 'outlet' | 'sku', id: string, phrase: string
): Promise<void> {
  const table = kind === 'outlet' ? 'outlet_aliases' : 'sku_aliases';
  const col = kind === 'outlet' ? 'outlet_id' : 'sku_id';
  const alias = normalise(phrase);
  if (!alias) return;
  await sql(
    `INSERT INTO ${table} (${col}, alias, source, hits) VALUES ($1, $2, 'learned', 1)
     ON CONFLICT (${col}, alias) DO UPDATE SET hits = ${table}.hits + 1`,
    [id, alias]
  );
}
