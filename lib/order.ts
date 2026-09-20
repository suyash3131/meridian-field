import { sql, one, tx, businessWeekday } from './db';
import { resolveOutlet, resolveSku, learnAlias, metres } from './match';
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
  | { kind: 'error'; message: string };

export type OrderSummary = {
  outlet: { id: string; name: string; area: string };
  lines: { name: string; pack: string; qty: number; freeQty: number; unit: number; total: number }[];
  subtotalPaise: number; schemeDiscountPaise: number; totalPaise: number;
  creditDays: number;
  credit: { limitPaise: number; outstandingPaise: number; afterPaise: number; overLimit: boolean };
  visit: { onBeat: boolean; distanceM: number | null; verification: string };
  resolvedBy: string[];
};

export async function draftOrder(proposal: Proposal): Promise<DraftResult> {
  const startedAt = Date.now();
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
    return askOnce(draftId, p, 'Which counter?',
      outletDecision.candidates.map((c) => ({
        key: c.id,
        label: `${c.name}, ${c.area}` + (c.distance_m !== null ? ` (${c.distance_m}m away)` : ''),
      })));
  }

  const outlet = outletDecision.value;
  return await buildDraft(p, outlet, [outletDecision.method], startedAt);
}

/** Continue a draft after the rep answered the one question. */
export async function answerDraft(c: Choice): Promise<DraftResult> {
  const draft = await one<{
    id: string; rep_id: string; outlet_id: string | null; raw_message: string;
    state: Record<string, unknown>; questions_asked: number; thread_id: string | null;
    gps_lat: number | null; gps_lng: number | null; photo_url: string | null;
  }>(`SELECT * FROM drafts WHERE id = $1 AND status = 'open'`, [c.draftId]);
  if (!draft) return { kind: 'error', message: 'that order is no longer open' };

  const state = draft.state as {
    pendingOutlet?: string; pendingSku?: string;
    items?: { phrase: string; qty: number }[]; creditDays?: number;
    resolvedSkus?: Record<string, string>; duplicateOf?: string;
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

  const summary: OrderSummary = {
    outlet: { id: outlet.id, name: outlet.name, area: outlet.area },
    lines: lines.map((l) => ({
      name: l.sku.name, pack: l.sku.pack_desc, qty: l.qty, freeQty: l.freeQty,
      unit: l.unitPaise, total: l.totalPaise,
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
};

export async function confirmOrder(draftId: string): Promise<CommitResult | { error: string }> {
  const draft = await one<{
    id: string; rep_id: string; outlet_id: string; raw_message: string;
    thread_id: string | null; state: Record<string, unknown>;
    gps_lat: number | null; gps_lng: number | null; photo_url: string | null;
    created_at: string;
  }>(`SELECT * FROM drafts WHERE id = $1 AND status = 'open'`, [draftId]);
  if (!draft) return { error: 'that order is no longer open' };

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

    await q(`UPDATE drafts SET status='committed', updated_at=now() WHERE id=$1`, [draftId]);

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
        status: 'held_credit' as const, orderId, visitId, totalPaise: total, approvalId,
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
      status: 'confirmed' as const, orderId, visitId, totalPaise: total,
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
}): Promise<{ visitId: string; outlet: string; verification: string; onBeat: boolean }
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

  return { visitId, outlet: outlet.name, verification, onBeat };
}
