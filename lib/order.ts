import { sql, one, tx, businessWeekday, BUSINESS_TZ } from './db';
import { resolveOutlet, resolveSku, learnAlias, metres, GENERIC } from './match';
import type { OutletMatch, SkuMatch } from './match';

// =============================================================================
// THE ORDER ENGINE
//
// Everything a model must not decide lives in this file, and none of it is
// reachable from a prompt. The division:
//
//   the model   reads a sentence and proposes { shop, [{ phrase, qty }] }
//   this file   resolves, prices, applies schemes, checks credit, checks the
//               route, checks for a double-send, and writes the visit
//
// No arithmetic is ever returned to the model for it to redo. Totals are
// computed once, here, in integer paise, and echoed back verbatim.
// =============================================================================

/** A rep with a pharmacist waiting will answer one question. Never two. */
export const QUESTION_BUDGET = 1;

/** Two identical orders inside this window are probably one order sent twice. */
const DOUBLE_SEND_MINUTES = 10;

/** Within this, we treat the rep as standing at the counter. */
const AT_THE_COUNTER_M = 200;

export type Proposal = {
  repId: string;
  shopPhrase: string;
  items: { phrase: string; qty: number }[];
  creditDays?: number;
  gps?: { lat: number; lng: number };
  photoUrl?: string;
  threadId?: string;
  rawMessage: string;
};

export type Choice = { draftId: string; pick: string };

type Line = {
  sku: SkuMatch; qty: number; unitPaise: number; totalPaise: number;
  freeQty: number; schemeId: string | null; matchedFrom: string;
  confidence: number; method: string;
};

const nowIso = () => new Date().toISOString();
const newId = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// -----------------------------------------------------------------------------

async function logEvent(e: {
  repId?: string; threadId?: string; event: string;
  orderId?: string; visitId?: string; ms?: number; questions?: number;
  meta?: unknown;
}) {
  await sql(
    `INSERT INTO agent_events (rep_id, thread_id, event, order_id, visit_id,
                               ms_since_first, questions_so_far, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.repId ?? null, e.threadId ?? null, e.event, e.orderId ?? null,
     e.visitId ?? null, e.ms ?? null, e.questions ?? 0,
     e.meta ? JSON.stringify(e.meta) : null]
  );
}

/** How stale a position may be and still describe where the rep is standing. */
const POSITION_FRESH_MINUTES = 15;

/**
 * The rep's last published position, read server-side. Nothing the model says
 * can reach this: `draft_order` has no coordinate in its schema, so location
 * enters the system through a device or not at all.
 */
export async function lastPosition(repId: string) {
  const row = await one<{ lat: number; lng: number; photo_url: string | null; age_s: number }>(
    `SELECT lat, lng, photo_url, EXTRACT(EPOCH FROM (now() - at))::int AS age_s
       FROM rep_positions WHERE rep_id = $1`, [repId]);
  if (!row) return null;
  if (row.age_s > POSITION_FRESH_MINUTES * 60) return null;
  return { lat: row.lat, lng: row.lng, photoUrl: row.photo_url ?? undefined };
}

/** What this counter owes right now. The single number credit decisions use. */
export async function outstanding(outletId: string): Promise<number> {
  const row = await one<{ due: string }>(
    `SELECT COALESCE(SUM(amount_paise), 0)::bigint AS due
       FROM invoices WHERE outlet_id = $1 AND status <> 'paid'`,
    [outletId]
  );
  return Number(row?.due ?? 0);
}

/**
 * Is this counter on the rep's route today? Recorded, never used to block —
 * reps cover for each other and a colleague off sick must not stop the work.
 *
 * Beats run Monday to Saturday. On a Sunday there is no route to be off, so
 * asking the question flags every single visit, which is noise dressed as a
 * finding. With no beat for the day we ask the only question still worth
 * asking: is this counter in the rep's territory at all.
 */
async function beatPosition(repId: string, outletId: string, weekday: number) {
  const today = await one<{ seq: number }>(
    `SELECT bo.seq FROM beat_outlets bo JOIN beats b ON b.id = bo.beat_id
      WHERE b.rep_id = $1 AND b.weekday = $2 AND bo.outlet_id = $3`,
    [repId, weekday, outletId]
  );
  if (today) return { onBeat: true, seq: today.seq, noRouteToday: false };

  const hasRoute = await one<{ n: string }>(
    `SELECT count(*)::text AS n FROM beats WHERE rep_id = $1 AND weekday = $2`,
    [repId, weekday]
  );
  if (Number(hasRoute?.n ?? 0) > 0) return { onBeat: false, seq: null, noRouteToday: false };

  const inTerritory = await one<{ seq: number }>(
    `SELECT bo.seq FROM beat_outlets bo JOIN beats b ON b.id = bo.beat_id
      WHERE b.rep_id = $1 AND bo.outlet_id = $2 LIMIT 1`,
    [repId, outletId]
  );
  return { onBeat: !!inTerritory, seq: inTerritory?.seq ?? null, noRouteToday: true };
}

/** rep + counter + the sorted set of (sku, qty). Same hand, same order. */
const fingerprint = (repId: string, outletId: string, lines: Line[]) =>
  [repId, outletId, ...lines.map((l) => `${l.sku.id}x${l.qty}`).sort()].join('|');

// -----------------------------------------------------------------------------
// PRICING — the only place money is calculated
// -----------------------------------------------------------------------------

async function priceLine(sku: SkuMatch, qty: number) {
  const unitPaise = Number(sku.ptr_paise);
  const scheme = await one<{ id: string; buy_qty: number; free_qty: number }>(
    `SELECT id, buy_qty, free_qty FROM schemes
      WHERE (sku_id = $1 OR category = (SELECT category FROM skus WHERE id = $1))
        AND current_date BETWEEN valid_from AND valid_to
      ORDER BY sku_id NULLS LAST LIMIT 1`,
    [sku.id]
  );
  const freeQty = scheme ? Math.floor(qty / scheme.buy_qty) * scheme.free_qty : 0;
  return {
    unitPaise,
    totalPaise: unitPaise * qty,
    freeQty,
    schemeId: scheme?.id ?? null,
  };
}

// -----------------------------------------------------------------------------
// DRAFT
// -----------------------------------------------------------------------------

export type DraftResult =
  | { kind: 'question'; draftId: string; question: string; options: { key: string; label: string }[] }
  | { kind: 'parked'; draftId: string; message: string }
  | { kind: 'draft'; draftId: string; summary: OrderSummary }
  | { kind: 'duplicate'; draftId: string; question: string; options: { key: string; label: string }[] }
  | { kind: 'cancelled'; draftId: string; message: string }
  | { kind: 'change'; draftId: string; message: string }
  | { kind: 'error'; message: string };

export type OrderSummary = {
  outlet: { id: string; name: string; area: string };
  lines: { name: string; pack: string; qty: number; freeQty: number; unit: number; total: number;
           /** Set when the quantity is far above what is normally ordered. */
           unusual?: { usual: number; basis: 'this_shop' | 'all_shops' } }[];
  subtotalPaise: number; schemeDiscountPaise: number; totalPaise: number;
  creditDays: number;
  credit: { limitPaise: number; outstandingPaise: number; afterPaise: number; overLimit: boolean };
  visit: { onBeat: boolean; distanceM: number | null; verification: string };
  resolvedBy: string[];
};

// -----------------------------------------------------------------------------
// Drafts nobody answered.
//
// A rep who is interrupted at the counter walks away from a read-back, and the
// order is lost without anyone knowing. After half an hour a draft is closed
// and counted as abandoned, so Agent health shows it. There is no timer: a
// rep's stale drafts are swept when he next starts an order, and the health
// page counts the ones not swept yet. A yes that arrives later is refused,
// because prices, stock and credit may have moved since he read the slip.
// -----------------------------------------------------------------------------

export const DRAFT_TIMEOUT_MIN = 30;
const TIMED_OUT = `That order timed out after ${DRAFT_TIMEOUT_MIN} minutes. Send it again.`;

async function sweepStale(repId: string) {
  const gone = await sql<{ id: string; thread_id: string | null }>(
    `UPDATE drafts SET status='abandoned', state = state || '{"expired":true}'::jsonb, updated_at=now()
      WHERE rep_id=$1 AND status='open' AND updated_at < now() - interval '${DRAFT_TIMEOUT_MIN} minutes'
      RETURNING id, thread_id`, [repId]);
  for (const d of gone)
    await logEvent({ repId, threadId: d.thread_id ?? undefined, event: 'abandoned', meta: { reason: 'no_reply' } });
}

/** True, and the draft closed, if nobody has touched it for too long. */
async function expiredNow(d: { id: string; rep_id: string; thread_id: string | null; updated_at: string }) {
  if (Date.now() - new Date(d.updated_at).getTime() < DRAFT_TIMEOUT_MIN * 60_000) return false;
  await sweepStale(d.rep_id);
  return true;
}

export async function draftOrder(proposal: Proposal): Promise<DraftResult> {
  const startedAt = Date.now();
  await sweepStale(proposal.repId);
  // Evidence is fetched, never accepted. Anything the caller passed as `gps`
  // is ignored in favour of what the rep's own device last published.
  const fix = await lastPosition(proposal.repId);
  const p: Proposal = {
    ...proposal,
    gps: fix ? { lat: fix.lat, lng: fix.lng } : undefined,
    photoUrl: fix?.photoUrl ?? proposal.photoUrl,
  };
  const weekday = businessWeekday();  // 1 = Monday
  await logEvent({ repId: p.repId, threadId: p.threadId, event: 'message_in', ms: 0 });

  const outletDecision = await resolveOutlet(p.shopPhrase, {
    repId: p.repId, gps: p.gps, weekday,
  });

  if (outletDecision.status === 'none')
    return { kind: 'error', message: outletDecision.reason };

  if (outletDecision.status === 'ambiguous') {
    const draftId = await openDraft(p, null, { pendingOutlet: p.shopPhrase });
    // A name we have never heard of reads differently from two names that
    // both fit: the rep should know it was not simply a typo we could not place.
    return askOnce(draftId, p,
      outletDecision.unknown ? `No counter called "${p.shopPhrase}" on file. Which one is it?` : 'Which counter?',
      outletDecision.candidates.map((c) => ({
        key: c.id,
        label: `${c.name}, ${c.area}` + awayLabel(c.distance_m),
      })));
  }

  const outlet = outletDecision.value;
  return await buildDraft(p, outlet, [outletDecision.method], startedAt);
}

/** " (240m away)", " (12.2 km away)", or nothing for a shop in another city. */
function awayLabel(m: number | null): string {
  if (m === null || m > 50_000) return '';
  return m < 1000 ? ` (${m}m away)` : ` (${(m / 1000).toFixed(1)} km away)`;
}

/** Continue a draft after the rep answered the one question. */
export async function answerDraft(c: Choice): Promise<DraftResult> {
  const draft = await one<{
    id: string; rep_id: string; outlet_id: string | null; raw_message: string;
    state: Record<string, unknown>; questions_asked: number; thread_id: string | null;
    gps_lat: number | null; gps_lng: number | null; photo_url: string | null; updated_at: string;
  }>(`SELECT * FROM drafts WHERE id = $1 AND status = 'open'`, [c.draftId]);
  if (!draft) return { kind: 'error', message: 'that order is no longer open' };
  if (await expiredNow(draft)) return { kind: 'error', message: TIMED_OUT };

  const state = draft.state as {
    pendingOutlet?: string; pendingSku?: string;
    items?: { phrase: string; qty: number }[]; creditDays?: number;
    resolvedSkus?: Record<string, string>; duplicateOf?: string; declined?: boolean;
  };

  const p: Proposal = {
    repId: draft.rep_id,
    shopPhrase: state.pendingOutlet ?? '',
    items: state.items ?? [],
    creditDays: state.creditDays,
    gps: draft.gps_lat != null && draft.gps_lng != null
      ? { lat: draft.gps_lat, lng: draft.gps_lng } : undefined,
    photoUrl: draft.photo_url ?? undefined,
    threadId: draft.thread_id ?? undefined,
    rawMessage: draft.raw_message,
  };

  // The rep said no to the read-back, then chose what that no meant.
  if (state.declined) {
    await sql(`UPDATE drafts SET state = state || '{"declined":false}'::jsonb, updated_at=now()
                WHERE id=$1`, [c.draftId]);
    if (c.pick === 'cancel') {
      // Counted with the other drafts that never became an order, so a rep
      // cancelling often is visible on Agent health rather than silent.
      await sql(`UPDATE drafts SET status='abandoned', updated_at=now() WHERE id=$1`, [c.draftId]);
      await logEvent({ repId: draft.rep_id, threadId: draft.thread_id ?? undefined,
                       event: 'abandoned', meta: { reason: 'rep_cancelled' } });
      return { kind: 'cancelled', draftId: c.draftId, message: 'Cancelled. Nothing sent.' };
    }
    // The draft stays open: his next message is the change, redrafted in full.
    return { kind: 'change', draftId: c.draftId, message: 'What to change? Send just that, like "2 calci d3".' };
  }

  // The rep confirmed a double-send was in fact a second, real order.
  if (state.duplicateOf) {
    if (c.pick === 'same') {
      await sql(`UPDATE drafts SET status='abandoned', updated_at=now() WHERE id=$1`, [c.draftId]);
      return { kind: 'error', message: 'Kept the first one. Nothing new saved.' };
    }
    const outlet = await outletById(draft.outlet_id!);
    return await buildDraft(p, outlet, ['rep confirmed a second order'], Date.now(), true, c.draftId);
  }

  // The rep picked a counter.
  if (state.pendingOutlet && !draft.outlet_id) {
    const outlet = await outletById(c.pick);
    if (!outlet) return { kind: 'error', message: 'unknown counter' };
    await learnAlias('outlet', outlet.id, state.pendingOutlet);
    return await buildDraft(p, outlet, ['rep chose'], Date.now(), false, c.draftId);
  }

  // The rep picked a product.
  if (state.pendingSku) {
    const resolved = { ...(state.resolvedSkus ?? {}), [state.pendingSku]: c.pick };
    await learnAlias('sku', c.pick, state.pendingSku);
    await sql(`UPDATE drafts SET state = state || $2::jsonb, updated_at=now() WHERE id=$1`,
      [c.draftId, JSON.stringify({ resolvedSkus: resolved, pendingSku: null })]);
    const outlet = await outletById(draft.outlet_id!);
    return await buildDraft(p, outlet, ['rep chose'], Date.now(), false, c.draftId, resolved);
  }

  return { kind: 'error', message: 'nothing was waiting on an answer' };
}

/**
 * The rep said no to the read-back without saying why. "No" can mean drop it
 * or fix it, and guessing either wrong costs him an order or a phone call, so
 * he gets both as a choice. This is not a resolution question and does not
 * spend the one-question budget: the order was already fully understood.
 */
export async function declineDraft(draftId: string): Promise<DraftResult> {
  const open = await one<{ id: string; outlet: string | null }>(
    `SELECT d.id, ou.name AS outlet FROM drafts d LEFT JOIN outlets ou ON ou.id = d.outlet_id
      WHERE d.id = $1 AND d.status = 'open'`, [draftId]);
  if (!open) return { kind: 'error', message: 'that order is no longer open' };
  await sql(`UPDATE drafts SET state = state || '{"declined":true}'::jsonb, updated_at=now()
              WHERE id=$1`, [draftId]);
  return {
    kind: 'question', draftId, question: open.outlet ? `Not placed: ${open.outlet}.` : 'Not placed.',
    options: [{ key: 'cancel', label: 'Cancel order' }, { key: 'change', label: 'Change something' }],
  };
}

async function outletById(id: string) {
  return (await one<OutletMatch>(
    `SELECT id, name, area, region, lat, lng, credit_limit_paise, credit_terms_days,
            1::float AS score, true AS exact, NULL::int AS distance_m, false AS on_beat
       FROM outlets WHERE id = $1`, [id]))!;
}

async function openDraft(p: Proposal, outletId: string | null, state: object): Promise<string> {
  const id = newId('DR');
  await sql(
    `INSERT INTO drafts (id, rep_id, outlet_id, thread_id, raw_message, state,
                         gps_lat, gps_lng, photo_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, p.repId, outletId, p.threadId ?? null, p.rawMessage,
     JSON.stringify({ items: p.items, creditDays: p.creditDays, ...state }),
     p.gps?.lat ?? null, p.gps?.lng ?? null, p.photoUrl ?? null]
  );
  return id;
}

/**
 * Spend the question, or park the order.
 *
 * The budget is a column on the drafts row, so it survives across turns and no
 * amount of persuasion raises it. It covers RESOLUTION questions only — which
 * counter, which pack — because those are the ones that multiply.
 *
 * A duplicate check is not one of those. Bad signal and a re-tapped send is
 * routine, and a rep who hit one ambiguity and then double-sent would otherwise
 * be parked for doing nothing wrong. It gets its own single allowance, and it is
 * still capped: two safety questions in one order is the same failure.
 */
async function askOnce(
  draftId: string, p: Proposal, question: string,
  options: { key: string; label: string }[],
  kind: 'resolution' | 'safety' = 'resolution'
): Promise<DraftResult> {
  const row = await one<{ questions_asked: number; state: { safetyAsked?: boolean } }>(
    `SELECT questions_asked, state FROM drafts WHERE id = $1`, [draftId]);
  const asked = row?.questions_asked ?? 0;

  if (kind === 'safety') {
    if (row?.state?.safetyAsked) {
      await sql(`UPDATE drafts SET status='parked', updated_at=now() WHERE id=$1`, [draftId]);
      return { kind: 'parked', draftId,
        message: 'Saved this one — too many things to check. Your ASM will call. Move on.' };
    }
    await sql(`UPDATE drafts SET state = state || '{"safetyAsked":true}'::jsonb,
               updated_at = now() WHERE id = $1`, [draftId]);
    await logEvent({ repId: p.repId, threadId: p.threadId, event: 'question_asked', questions: asked });
    return { kind: 'question', draftId, question, options };
  }

  if (asked >= QUESTION_BUDGET) {
    await sql(`UPDATE drafts SET status='parked', updated_at=now() WHERE id=$1`, [draftId]);
    await logEvent({ repId: p.repId, threadId: p.threadId, event: 'abandoned', questions: asked });
    return {
      kind: 'parked', draftId,
      message: 'Saved this one — too many things to check. Your ASM will call. Move on.',
    };
  }

  await sql(`UPDATE drafts SET questions_asked = questions_asked + 1, updated_at=now()
              WHERE id=$1`, [draftId]);
  await logEvent({ repId: p.repId, threadId: p.threadId, event: 'question_asked', questions: asked + 1 });
  return { kind: 'question', draftId, question, options };
}

// -----------------------------------------------------------------------------

/**
 * What a counter normally orders of each product: its own median over past
 * orders, or every counter's median when it has too little history.
 *
 * A typo like "500" for "50" is the one mistake the read-back does not catch
 * well, because the slip looks right apart from one number. Nothing is
 * blocked: a big order can be real. The slip just points at the number.
 */
async function usualQuantities(outletId: string, skuIds: string[]) {
  const rows = await sql<{ sku_id: string; here: number | null; n_here: number; everywhere: number | null }>(
    `SELECT ol.sku_id,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY ol.qty) FILTER (WHERE o.outlet_id = $1) AS here,
            count(*) FILTER (WHERE o.outlet_id = $1)::int AS n_here,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY ol.qty) AS everywhere
       FROM order_lines ol JOIN orders o ON o.id = ol.order_id
      WHERE o.status IN ('confirmed','held_credit') AND ol.sku_id = ANY($2)
      GROUP BY ol.sku_id`, [outletId, skuIds]);
  return new Map(rows.map((r) => [r.sku_id,
    r.n_here >= 2 && r.here != null
      ? { usual: Math.round(r.here), basis: 'this_shop' as const }
      : { usual: Math.round(r.everywhere ?? 0), basis: 'all_shops' as const }]));
}

/** Five times the usual and at least ten more: "10 instead of 2" is not worth a flag. */
function unusualQty(qty: number, u?: { usual: number; basis: 'this_shop' | 'all_shops' }) {
  if (!u || u.usual <= 0) return undefined;
  return qty >= u.usual * 5 && qty - u.usual >= 10 ? u : undefined;
}

async function buildDraft(
  p: Proposal, outlet: OutletMatch, resolvedBy: string[], startedAt: number,
  skipDuplicateCheck = false, existingDraftId?: string,
  preResolved: Record<string, string> = {}
): Promise<DraftResult> {
  const draftId = existingDraftId ?? await openDraft(p, outlet.id, {});
  if (existingDraftId)
    await sql(`UPDATE drafts SET outlet_id=$2, updated_at=now() WHERE id=$1`, [draftId, outlet.id]);

  // ---- products ----
  const lines: Line[] = [];
  for (const item of p.items) {
    const forced = preResolved[item.phrase];
    const decision = forced
      ? { status: 'resolved' as const, value: await skuById(forced), confidence: 1, method: 'rep chose' }
      : await resolveSku(item.phrase, { outletId: outlet.id });

    if (decision.status === 'none')
      return { kind: 'error', message: `I don't stock anything called "${item.phrase}".` };

    if (decision.status === 'ambiguous') {
      await sql(`UPDATE drafts SET state = state || $2::jsonb, updated_at=now() WHERE id=$1`,
        [draftId, JSON.stringify({ pendingSku: item.phrase })]);
      return askOnce(draftId, p, `Which "${item.phrase}"?`,
        decision.candidates.map((c) => ({ key: c.id, label: `${c.name} — ${c.pack_desc}` })));
    }

    const sku = decision.value;
    const priced = await priceLine(sku, item.qty);
    lines.push({
      sku, qty: item.qty, ...priced,
      matchedFrom: item.phrase, confidence: decision.confidence, method: decision.method,
    });
  }

  if (!lines.length) return { kind: 'error', message: 'no products in that message' };

  // ---- the same order, twice ----
  if (!skipDuplicateCheck) {
    const fp = fingerprint(p.repId, outlet.id, lines);
    const twin = await one<{ id: string; created_at: string }>(
      `SELECT id, created_at FROM orders
        WHERE fingerprint = $1 AND status IN ('confirmed','held_credit')
          AND created_at > now() - ($2 || ' minutes')::interval
        ORDER BY created_at DESC LIMIT 1`,
      [fp, String(DOUBLE_SEND_MINUTES)]
    );
    if (twin) {
      const mins = Math.max(1, Math.round((Date.now() - new Date(twin.created_at).getTime()) / 60000));
      await sql(`UPDATE drafts SET state = state || $2::jsonb, updated_at=now() WHERE id=$1`,
        [draftId, JSON.stringify({ duplicateOf: twin.id })]);
      await logEvent({ repId: p.repId, threadId: p.threadId, event: 'duplicate_suspected', orderId: twin.id });
      const dup = await askOnce(draftId, p,
        `Same order went in ${mins} min ago. Is this a second one?`,
        [{ key: 'same', label: 'Same order — ignore this' },
         { key: 'new', label: 'No, this is a new order' }],
        'safety');
      return dup.kind === 'question' ? { ...dup, kind: 'duplicate' as const } : dup;
    }
  }

  // ---- money: computed once, here ----
  const subtotalPaise = lines.reduce((s, l) => s + l.totalPaise, 0);
  const schemeDiscountPaise = lines.reduce((s, l) => s + l.unitPaise * l.freeQty, 0);
  const totalPaise = subtotalPaise;             // free goods, not a price cut
  const creditDays = p.creditDays ?? outlet.credit_terms_days;

  const owed = await outstanding(outlet.id);
  const limit = Number(outlet.credit_limit_paise);
  const afterPaise = owed + totalPaise;

  const { onBeat, seq, noRouteToday } = await beatPosition(
    p.repId, outlet.id, businessWeekday());
  const distanceM = p.gps ? metres(p.gps.lat, p.gps.lng, outlet.lat, outlet.lng) : null;
  const verification =
    distanceM === null ? 'unverified'
    : distanceM <= AT_THE_COUNTER_M ? 'verified'
    : 'flagged';

  const usual = await usualQuantities(outlet.id, lines.map((l) => l.sku.id));
  const summary: OrderSummary = {
    outlet: { id: outlet.id, name: outlet.name, area: outlet.area },
    lines: lines.map((l) => ({
      name: l.sku.name, pack: l.sku.pack_desc, qty: l.qty, freeQty: l.freeQty,
      unit: l.unitPaise, total: l.totalPaise,
      unusual: unusualQty(l.qty, usual.get(l.sku.id)),
    })),
    subtotalPaise, schemeDiscountPaise, totalPaise, creditDays,
    credit: { limitPaise: limit, outstandingPaise: owed, afterPaise, overLimit: afterPaise > limit },
    visit: { onBeat, distanceM, verification },
    resolvedBy: [...resolvedBy, ...lines.map((l) => `${l.matchedFrom} → ${l.method}`)],
  };

  await sql(
    `UPDATE drafts SET state = state || $2::jsonb, updated_at=now() WHERE id=$1`,
    [draftId, JSON.stringify({
      lines: lines.map((l) => ({
        skuId: l.sku.id, qty: l.qty, unitPaise: l.unitPaise, totalPaise: l.totalPaise,
        freeQty: l.freeQty, schemeId: l.schemeId, matchedFrom: l.matchedFrom,
        confidence: l.confidence, method: l.method,
      })),
      outletId: outlet.id, creditDays, beatSeq: seq, onBeat, noRouteToday, distanceM, verification,
      fingerprint: fingerprint(p.repId, outlet.id, lines),
    })]
  );
  await logEvent({
    repId: p.repId, threadId: p.threadId, event: 'draft_built',
    ms: Date.now() - startedAt, meta: { draftId, totalPaise },
  });

  return { kind: 'draft', draftId, summary };
}

async function skuById(id: string): Promise<SkuMatch> {
  return (await one<SkuMatch>(
    `SELECT id, name, brand, molecule, pack_desc, ptr_paise, mrp_paise,
            1::float AS score, true AS exact, 0 AS bought_before
       FROM skus WHERE id = $1`, [id]))!;
}

// =============================================================================
// COMMIT
// =============================================================================

export type CommitResult = {
  status: 'confirmed' | 'held_credit';
  orderId: string;
  visitId: string;
  totalPaise: number;
  message: string;
  approvalId?: string;
  /** He said yes again to an order that already went through. */
  already?: boolean;
  /** Named in every reply, so two orders in one message can be told apart. */
  outlet?: string;
};

/**
 * A yes for a draft that is no longer open. On bad signal a rep taps "haan"
 * twice, or sends it again because he never saw "Done". "No longer open" reads
 * like a failure and he re-enters the whole order, so say what actually
 * happened to it.
 */
async function alreadyDone(draftId: string): Promise<CommitResult | { error: string }> {
  const d = await one<{ status: string; rep_id: string; state: { orderId?: string; fingerprint?: string; expired?: boolean } }>(
    `SELECT status, rep_id, state FROM drafts WHERE id = $1`, [draftId]);
  if (!d) return { error: 'that order is no longer open' };
  if (d.status === 'abandoned' && d.state.expired) return { error: TIMED_OUT };
  if (d.status === 'abandoned') return { error: 'That order was cancelled. Nothing was sent.' };
  if (d.status === 'parked') return { error: 'That one is already with your ASM.' };
  if (d.status !== 'committed') return { error: 'that order is no longer open' };

  // Drafts committed before the order id was kept on them are found by
  // fingerprint: same rep, same counter, same lines.
  const o = await one<{ id: string; status: 'confirmed' | 'held_credit'; total_paise: string; visit_id: string; outlet: string }>(
    d.state.orderId
      ? `SELECT o.id, o.status, o.total_paise, o.visit_id, ou.name AS outlet
           FROM orders o JOIN outlets ou ON ou.id = o.outlet_id WHERE o.id = $1`
      : `SELECT o.id, o.status, o.total_paise, o.visit_id, ou.name AS outlet
           FROM orders o JOIN outlets ou ON ou.id = o.outlet_id
          WHERE o.fingerprint = $1 AND o.rep_id = $2 ORDER BY o.created_at DESC LIMIT 1`,
    d.state.orderId ? [d.state.orderId] : [d.state.fingerprint ?? '', d.rep_id]);
  if (!o) return { error: 'that order is no longer open' };
  return {
    status: o.status, orderId: o.id, visitId: o.visit_id, totalPaise: Number(o.total_paise),
    message: 'Already placed.', already: true, outlet: o.outlet,
  };
}

export async function confirmOrder(draftId: string): Promise<CommitResult | { error: string }> {
  const draft = await one<{
    id: string; rep_id: string; outlet_id: string; raw_message: string;
    thread_id: string | null; state: Record<string, unknown>;
    gps_lat: number | null; gps_lng: number | null; photo_url: string | null;
    created_at: string; updated_at: string;
  }>(`SELECT * FROM drafts WHERE id = $1 AND status = 'open'`, [draftId]);
  if (!draft) return await alreadyDone(draftId);
  if (await expiredNow(draft)) return { error: TIMED_OUT };

  const s = draft.state as {
    lines?: { skuId: string; qty: number; unitPaise: number; totalPaise: number;
              freeQty: number; schemeId: string | null; matchedFrom: string;
              confidence: number; method: string }[];
    creditDays?: number; beatSeq?: number | null; onBeat?: boolean;
    distanceM?: number | null; verification?: string; fingerprint?: string;
    noRouteToday?: boolean;
  };
  if (!s.lines?.length) return { error: 'nothing priced on that order yet' };

  const outlet = await one<{ credit_limit_paise: string; name: string }>(
    `SELECT credit_limit_paise, name FROM outlets WHERE id = $1`, [draft.outlet_id]);
  if (!outlet) return { error: 'unknown counter' };

  const subtotal = s.lines.reduce((a, l) => a + l.totalPaise, 0);
  const discount = s.lines.reduce((a, l) => a + l.unitPaise * l.freeQty, 0);
  const total = subtotal;

  const outletName = outlet.name;
  const limit = Number(outlet.credit_limit_paise);
  const terms = s.creditDays ?? 15;

  return await tx(async (q) => {
    // --- the visit. Written by the same code path as the work, never claimed.
    const visitId = newId('V');
    await q(
      `INSERT INTO visits (id, outlet_id, rep_id, occurred_at, outcome, on_beat, beat_seq,
                           gps_lat, gps_lng, gps_distance_m, photo_url, verification,
                           verification_note, raw_message)
       VALUES ($1,$2,$3,now(),'order',$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [visitId, draft.outlet_id, draft.rep_id, s.onBeat ?? false, s.beatSeq ?? null,
       draft.gps_lat, draft.gps_lng, s.distanceM ?? null, draft.photo_url,
       s.verification ?? 'unverified',
       s.verification === 'flagged' ? `location ${s.distanceM}m from counter`
         : s.onBeat === false && !s.noRouteToday ? 'counter is not on today\u2019s route'
         : null,
       draft.raw_message]
    );

    // --- the credit decision. A comparison, not a judgement.
    const owedRows = await q<{ due: string }>(
      `SELECT COALESCE(SUM(amount_paise), 0)::bigint AS due
         FROM invoices WHERE outlet_id = $1 AND status <> 'paid'`,
      [draft.outlet_id]
    );
    const owed = Number(owedRows[0]?.due ?? 0);
    const overLimit = owed + total > limit;

    const orderId = newId('ORD');
    await q(
      `INSERT INTO orders (id, outlet_id, rep_id, visit_id, status, credit_terms_days,
                           subtotal_paise, scheme_discount_paise, total_paise,
                           fingerprint, source_message, created_at, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),$12)`,
      [orderId, draft.outlet_id, draft.rep_id, visitId,
       overLimit ? 'held_credit' : 'confirmed',
       terms, subtotal, discount, total,
       s.fingerprint ?? null, draft.raw_message, overLimit ? null : nowIso()]
    );

    for (const l of s.lines!)
      await q(
        `INSERT INTO order_lines (order_id, sku_id, qty, unit_price_paise, line_total_paise,
                                  scheme_id, free_qty, matched_from, match_confidence, match_method)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [orderId, l.skuId, l.qty, l.unitPaise, l.totalPaise, l.schemeId, l.freeQty,
         l.matchedFrom, l.confidence, l.method]
      );

    await q(`UPDATE drafts SET status='committed', state = state || $2::jsonb, updated_at=now()
              WHERE id=$1`, [draftId, JSON.stringify({ orderId })]);

    if (overLimit) {
      // The order is kept, not thrown away: rejecting it loses the sale and the
      // data. It is also not approved, because that is money. It waits for a
      // person, and the person is told now rather than at the end of the month.
      const approvalId = newId('APR');
      const asmRows = await q<{ asm_id: string }>(
        `SELECT asm_id FROM reps WHERE id = $1`, [draft.rep_id]);
      await q(
        `INSERT INTO approvals (id, kind, subject_id, outlet_id, requested_by, assigned_to,
                                reason, status)
         VALUES ($1,'credit_override',$2,$3,$4,$5,$6,'pending')`,
        [approvalId, orderId, draft.outlet_id, draft.rep_id, asmRows[0]?.asm_id ?? 'M-01',
         `Takes ${outletName} to ${rsPaise(owed + total)} against a limit of ${rsPaise(limit)}`]
      );
      await logEventIn(q, {
        repId: draft.rep_id, threadId: draft.thread_id ?? undefined,
        event: 'credit_held', orderId, visitId,
        ms: Date.now() - new Date(draft.created_at).getTime(),
      });
      return {
        status: 'held_credit' as const, orderId, visitId, totalPaise: total, approvalId, outlet: outletName,
        message: `Saved and sent for approval — this takes ${outletName} past its credit limit. Visit recorded.`,
      };
    }

    // `$N::int` matters: without the cast Postgres cannot resolve `date + $N`
    // and fails with "operator is not unique: date + unknown".
    await q(
      `INSERT INTO invoices (id, order_id, outlet_id, amount_paise, issued_on, due_on, status)
       VALUES ($1,$2,$3,$4, current_date + 2, current_date + 2 + $5::int, 'open')`,
      [newId('INV'), orderId, draft.outlet_id, total, terms]
    );
    await logEventIn(q, {
      repId: draft.rep_id, threadId: draft.thread_id ?? undefined,
      event: 'confirmed', orderId, visitId,
      ms: Date.now() - new Date(draft.created_at).getTime(),
    });

    return {
      status: 'confirmed' as const, orderId, visitId, totalPaise: total, outlet: outletName,
      message: 'Order placed. Visit recorded.',
    };
  });
}

const rsPaise = (p: number) => '₹' + Math.round(p / 100).toLocaleString('en-IN');

/** logEvent, but on the caller's transaction so it rolls back with everything else. */
async function logEventIn(
  q: <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>,
  e: { repId?: string; threadId?: string; event: string; orderId?: string;
       visitId?: string; ms?: number; questions?: number; meta?: unknown }
) {
  await q(
    `INSERT INTO agent_events (rep_id, thread_id, event, order_id, visit_id,
                               ms_since_first, questions_so_far, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.repId ?? null, e.threadId ?? null, e.event, e.orderId ?? null,
     e.visitId ?? null, e.ms ?? null, e.questions ?? 0,
     e.meta ? JSON.stringify(e.meta) : null]
  );
}

// =============================================================================
// A VISIT WITH NO ORDER
//
// Roughly a third of counters give no order on a given day. If attendance only
// came from orders, every one of those reps would start typing one-strip orders
// to get credit for the call — which would poison the most valuable data in the
// system to measure a less valuable one. So a stated reason is a first-class
// outcome, and it is often worth more than the order: "Cipla gave him 10+3" is
// how you find out you are losing a shelf, a month before the numbers say so.
// =============================================================================

export async function logVisit(v: {
  repId: string; shopPhrase: string; outcome: 'no_order' | 'stock_note' | 'competitor';
  reason: string; gps?: { lat: number; lng: number }; photoUrl?: string;
  threadId?: string; rawMessage: string;
}): Promise<{ visitId: string; outlet: string; outletId: string; region: string; verification: string; onBeat: boolean }
          | { error: string; options?: { key: string; label: string }[] }> {
  const weekday = businessWeekday();
  const fix = await lastPosition(v.repId);
  v = { ...v, gps: fix ? { lat: fix.lat, lng: fix.lng } : undefined,
        photoUrl: fix?.photoUrl ?? v.photoUrl };
  const decision = await resolveOutlet(v.shopPhrase, { repId: v.repId, gps: v.gps, weekday });

  if (decision.status === 'none') return { error: decision.reason };
  if (decision.status === 'ambiguous')
    return {
      error: decision.reason,
      options: decision.candidates.map((c) => ({ key: c.id, label: `${c.name}, ${c.area}` })),
    };

  const outlet = decision.value;
  const { onBeat, seq } = await beatPosition(v.repId, outlet.id, weekday);
  const distanceM = v.gps ? metres(v.gps.lat, v.gps.lng, outlet.lat, outlet.lng) : null;
  const verification =
    distanceM === null ? 'unverified'
    : distanceM <= AT_THE_COUNTER_M ? 'verified'
    : 'flagged';

  const visitId = newId('V');
  await sql(
    `INSERT INTO visits (id, outlet_id, rep_id, occurred_at, outcome, no_order_reason,
                         on_beat, beat_seq, gps_lat, gps_lng, gps_distance_m, photo_url,
                         verification, verification_note, raw_message)
     VALUES ($1,$2,$3,now(),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [visitId, outlet.id, v.repId, v.outcome, v.reason, onBeat, seq,
     v.gps?.lat ?? null, v.gps?.lng ?? null, distanceM, v.photoUrl ?? null,
     verification,
     verification === 'flagged' ? `location ${distanceM}m from counter` : null,
     v.rawMessage]
  );
  await logEvent({ repId: v.repId, threadId: v.threadId, event: 'confirmed', visitId });

  return { visitId, outlet: outlet.name, outletId: outlet.id, region: outlet.region, verification, onBeat };
}

/**
 * Which of his own orders a request is about. His open slips (when a slip can
 * be the subject) and today's placed orders, newest first. If he named a shop,
 * only that shop's: "the apollo order" must never land on Bansal Chemist just
 * because Bansal was the last thing he touched. Names and known nicknames are
 * compared on their distinctive words, never on "chemist" or "medical".
 */
async function findRepSubject(repId: string, shop: string | undefined, withDrafts: boolean) {
  const rows = await sql<{ id: string; outlet_id: string; outlet: string; total: string;
                           is_draft: boolean; aliases: string[] | null }>(
    `SELECT * FROM (
       SELECT d.id, d.outlet_id, ou.name AS outlet, true AS is_draft, d.updated_at AS at,
              (SELECT COALESCE(SUM((l->>'totalPaise')::bigint), 0)
                 FROM jsonb_array_elements(COALESCE(d.state->'lines', '[]'::jsonb)) l) AS total
         FROM drafts d JOIN outlets ou ON ou.id = d.outlet_id
        WHERE $2::boolean AND d.rep_id = $1 AND d.status = 'open'
          AND d.updated_at >= now() - interval '${DRAFT_TIMEOUT_MIN} minutes'
       UNION ALL
       SELECT o.id, o.outlet_id, ou.name, false, o.created_at, o.total_paise
         FROM orders o JOIN outlets ou ON ou.id = o.outlet_id
        WHERE o.rep_id = $1 AND o.status IN ('confirmed','held_credit')
          AND (o.created_at AT TIME ZONE '${BUSINESS_TZ}')::date
              = (now() AT TIME ZONE '${BUSINESS_TZ}')::date
     ) x
     LEFT JOIN LATERAL (SELECT array_agg(lower(alias)) AS aliases
                          FROM outlet_aliases WHERE outlet_id = x.outlet_id) a ON true
     ORDER BY x.at DESC`, [repId, withDrafts]);
  const words = (shop ?? '').toLowerCase().replace(GENERIC, ' ')
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
  if (!words.length) return rows[0] ?? null;
  return rows.find((r) => {
    const names = [r.outlet.toLowerCase(), ...(r.aliases ?? [])];
    return words.some((w) => names.some((n) => n.split(/[^a-z0-9]+/).includes(w)));
  }) ?? null;
}

/**
 * The rep wants to fix an order he has already placed.
 *
 * A placed order is a record the distributor may already be acting on, so
 * nothing here edits or cancels it. The request goes to his ASM with his own
 * words, and the order stays exactly as placed until a person decides. The
 * alternative, redrafting it, would quietly create a second order.
 */
export async function requestOrderChange(p: {
  repId: string; change: string; orderId?: string; shop?: string;
}): Promise<{ kind: 'sent'; orderId: string; outlet: string; totalPaise: number }
         | { kind: 'error'; message: string }> {
  // His own order only, and only one placed today: yesterday's is past fixing
  // from the counter.
  const byId = p.orderId ? await one<{ id: string; outlet_id: string; outlet: string; total: string }>(
    `SELECT o.id, o.outlet_id, ou.name AS outlet, o.total_paise AS total
       FROM orders o JOIN outlets ou ON ou.id = o.outlet_id
      WHERE o.id = $1 AND o.rep_id = $2 AND o.status IN ('confirmed','held_credit')`,
    [p.orderId, p.repId]) : null;
  const order = byId ?? await findRepSubject(p.repId, p.shop, false);
  if (!order) return { kind: 'error', message: 'No order placed today to change.' };

  const asm = await one<{ asm_id: string }>(`SELECT asm_id FROM reps WHERE id = $1`, [p.repId]);
  await sql(
    `INSERT INTO approvals (id, kind, subject_id, outlet_id, requested_by, assigned_to, reason, status)
     VALUES ($1,'order_change',$2,$3,$4,$5,$6,'pending')`,
    [newId('APR'), order.id, order.outlet_id, p.repId, asm?.asm_id ?? 'M-01',
     `Rep asks: "${p.change.trim().slice(0, 200)}"`]);
  return { kind: 'sent', orderId: order.id, outlet: order.outlet, totalPaise: Number(order.total) };
}

/**
 * The shop wants a better price. Nothing here changes one: adjust_price is
 * blocked outright, and a rep at a counter is the wrong person to decide it.
 * The ask goes to his ASM in his words, against the slip he has open at that
 * counter or else his last order today, so the ASM sees what it is worth.
 */
export async function requestPriceException(p: {
  repId: string; ask: string; shop?: string;
}): Promise<{ kind: 'sent'; outlet: string; totalPaise: number; onDraft: boolean }
         | { kind: 'error'; message: string }> {
  const subject = await findRepSubject(p.repId, p.shop, true);
  if (!subject) return { kind: 'error', message: 'Send the order first, then ask for the price.' };

  const asm = await one<{ asm_id: string }>(`SELECT asm_id FROM reps WHERE id = $1`, [p.repId]);
  await sql(
    `INSERT INTO approvals (id, kind, subject_id, outlet_id, requested_by, assigned_to, reason, status)
     VALUES ($1,'price_exception',$2,$3,$4,$5,$6,'pending')`,
    [newId('APR'), subject.id, subject.outlet_id, p.repId, asm?.asm_id ?? 'M-01',
     `Rep asks: "${p.ask.trim().slice(0, 200)}"`]);
  return { kind: 'sent', outlet: subject.outlet, totalPaise: Number(subject.total), onDraft: subject.is_draft };
}
