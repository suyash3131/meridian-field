import { sql, one } from './db';

// =============================================================================
// THE EIGHT O'CLOCK QUESTION
//
// "Why is the north territory down this week." The brief is explicit that the
// regional head does not want a chart, he wants an answer — so this file
// produces findings, not series.
//
// Two rules hold it together:
//
//   1. The model chooses the SCOPE. This code computes every number and ranks
//      the findings by rupee impact. No total, delta or estimate is ever handed
//      to a model to work out or restate from memory.
//
//   2. Value deltas are noisy at this volume; coverage is not. A rep who made
//      six of fifteen scheduled calls is a fact. So where a cause can be sized
//      from coverage — missed calls × what those counters normally order — it
//      is sized that way, and the estimate is labelled as one.
// =============================================================================

export type Finding = {
  code: string;
  headline: string;
  impactPaise: number;
  estimated: boolean;
  detail: Record<string, unknown>;
  lever: string | null;
};

const rs = (p: number) => '₹' + Math.round(p / 100).toLocaleString('en-IN');

// -----------------------------------------------------------------------------

/** Order value this week against last, for the scope asked about. */
async function trend(region: string | null) {
  const row = await one<{ this_week: string; last_week: string }>(
    `SELECT
       COALESCE(SUM(o.total_paise) FILTER (
         WHERE o.created_at >= now() - interval '7 days'), 0)::bigint AS this_week,
       COALESCE(SUM(o.total_paise) FILTER (
         WHERE o.created_at <  now() - interval '7 days'
           AND o.created_at >= now() - interval '14 days'), 0)::bigint AS last_week
     FROM orders o JOIN outlets ou ON ou.id = o.outlet_id
    WHERE o.status = 'confirmed' AND ($1::text IS NULL OR ou.region = $1)`,
    [region]
  );
  const thisWeek = Number(row?.this_week ?? 0);
  const lastWeek = Number(row?.last_week ?? 0);
  return {
    thisWeek, lastWeek,
    deltaPaise: thisWeek - lastWeek,
    pct: lastWeek ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : 0,
  };
}

/**
 * Scheduled calls against calls actually made, per rep.
 *
 * The denominator is the beat itself — every counter on every route day in the
 * last seven days — so this is coverage against plan, not against last week.
 */
async function coverage(region: string | null): Promise<Finding[]> {
  const rows = await sql<{
    rep_id: string; name: string; scheduled: number; made: number;
    avg_order: string; order_rate: string;
  }>(
    `WITH working_days AS (
       SELECT d::date AS day, EXTRACT(ISODOW FROM d)::int AS wd
         FROM generate_series(current_date - 6, current_date, interval '1 day') d
        WHERE EXTRACT(ISODOW FROM d) <> 7
     ),
     planned AS (
       SELECT b.rep_id, count(*)::int AS scheduled
         FROM working_days w
         JOIN beats b ON b.weekday = w.wd
         JOIN beat_outlets bo ON bo.beat_id = b.id
        GROUP BY b.rep_id
     ),
     actual AS (
       SELECT rep_id, count(*)::int AS made
         FROM visits WHERE occurred_at >= current_date - 6 GROUP BY rep_id
     ),
     economics AS (
       SELECT o.rep_id,
              AVG(o.total_paise)::bigint AS avg_order,
              (count(*)::float / NULLIF((SELECT count(*) FROM visits v
                                          WHERE v.rep_id = o.rep_id), 0)) AS order_rate
         FROM orders o WHERE o.status = 'confirmed' GROUP BY o.rep_id
     )
     SELECT r.id AS rep_id, r.name,
            COALESCE(p.scheduled, 0) AS scheduled,
            COALESCE(a.made, 0)      AS made,
            COALESCE(e.avg_order, 0) AS avg_order,
            COALESCE(e.order_rate, 0)::text AS order_rate
       FROM reps r
       LEFT JOIN planned p ON p.rep_id = r.id
       LEFT JOIN actual  a ON a.rep_id = r.id
       LEFT JOIN economics e ON e.rep_id = r.id
      WHERE ($1::text IS NULL OR r.region = $1)
      ORDER BY (COALESCE(a.made,0)::float / NULLIF(p.scheduled,0)) ASC NULLS LAST`,
    [region]
  );

  return rows
    .filter((r) => r.scheduled > 0 && r.made < r.scheduled * 0.85)
    .map((r) => {
      const missed = r.scheduled - r.made;
      const pct = Math.round((r.made / r.scheduled) * 100);
      // Missed calls × how often this rep's calls become orders × his average
      // order. An estimate, and flagged as one — but it is the only way to put
      // a rupee figure on a call that never happened.
      const impact = Math.round(missed * Number(r.order_rate) * Number(r.avg_order));
      return {
        code: 'coverage',
        headline:
          `${r.name} (${r.rep_id}) made ${r.made} of ${r.scheduled} scheduled calls — ${pct}%.`,
        impactPaise: impact,
        estimated: true,
        detail: { repId: r.rep_id, rep: r.name, scheduled: r.scheduled, made: r.made, missed, coveragePct: pct },
        lever: `${missed} counters were not called on. Sending someone to ${r.name}'s route is the largest single recoverable number here.`,
      };
    });
}

/** Orders sitting behind a credit limit, waiting on a person. */
async function creditHolds(region: string | null): Promise<Finding[]> {
  const rows = await sql<{ outlet: string; n: number; value: string; oldest_days: number }>(
    `SELECT ou.name AS outlet, count(*)::int AS n,
            SUM(o.total_paise)::bigint AS value,
            (current_date - MIN(o.created_at)::date) AS oldest_days
       FROM orders o JOIN outlets ou ON ou.id = o.outlet_id
      WHERE o.status = 'held_credit' AND ($1::text IS NULL OR ou.region = $1)
      GROUP BY ou.name ORDER BY SUM(o.total_paise) DESC`,
    [region]
  );
  return rows.map((r) => ({
    code: 'credit_hold',
    headline: `${r.outlet} has ${r.n} order${r.n > 1 ? 's' : ''} held at its credit limit, ${rs(Number(r.value))} in total, oldest ${r.oldest_days} days.`,
    impactPaise: Number(r.value),
    estimated: false,
    detail: { outlet: r.outlet, orders: r.n, oldestDays: r.oldest_days },
    lever: `Either release the hold or collect against ${r.outlet}. Until one of those happens the rep keeps calling and nothing ships.`,
  }));
}

/** Money past its terms, and whether it moved this week. */
async function collections(region: string | null): Promise<Finding[]> {
  const row = await one<{ overdue: string; week_ago: string; counters: number }>(
    `SELECT
       COALESCE(SUM(i.amount_paise) FILTER (WHERE i.due_on < current_date), 0)::bigint AS overdue,
       COALESCE(SUM(i.amount_paise) FILTER (WHERE i.due_on < current_date - 7), 0)::bigint AS week_ago,
       count(DISTINCT i.outlet_id) FILTER (WHERE i.due_on < current_date)::int AS counters
     FROM invoices i JOIN outlets ou ON ou.id = i.outlet_id
    WHERE i.status <> 'paid' AND ($1::text IS NULL OR ou.region = $1)`,
    [region]
  );
  const overdue = Number(row?.overdue ?? 0);
  if (overdue <= 0) return [];
  const weekAgo = Number(row?.week_ago ?? 0);
  const grew = overdue - weekAgo;
  return [{
    code: 'collections',
    headline: `${rs(overdue)} is past terms across ${row?.counters} counters` +
      (grew > 0 ? `, ${rs(grew)} of it newly overdue this week.` : '.'),
    // Rank on what moved this week, not on the standing balance.
    impactPaise: Math.max(0, grew),
    estimated: false,
    detail: { overduePaise: overdue, counters: row?.counters, newlyOverduePaise: grew },
    lever: 'Overdue money becomes a credit hold, which becomes a lost order. It leads the decline rather than following it.',
  }];
}

/** Counters that told a rep a rival got there first. */
async function competitor(region: string | null): Promise<Finding[]> {
  const row = await one<{ this_week: number; last_week: number; examples: string[] }>(
    // Sightings are structured rows now (brand, product, offer), written by the
    // agent's note_competitor tool and by the seed. One counter seen twice in a
    // week is one counter under pressure, not two.
    `SELECT
       count(DISTINCT c.outlet_id) FILTER (WHERE c.seen_at >= now() - interval '7 days')::int AS this_week,
       count(DISTINCT c.outlet_id) FILTER (WHERE c.seen_at <  now() - interval '7 days'
                          AND c.seen_at >= now() - interval '14 days')::int AS last_week,
       COALESCE(ARRAY_AGG(DISTINCT ou.name) FILTER (
         WHERE c.seen_at >= now() - interval '7 days'), '{}') AS examples
     FROM competitor_intel c JOIN outlets ou ON ou.id = c.outlet_id
    WHERE ($1::text IS NULL OR ou.region = $1)`,
    [region]
  );
  const now = row?.this_week ?? 0;
  if (now < 2) return [];
  const before = row?.last_week ?? 0;
  return [{
    code: 'competitor',
    headline: `${now} counters reported a rival scheme this week, against ${before} last week.`,
    // Not sized in rupees: what a competitor will eventually take is a guess,
    // and a made-up number next to real ones devalues the real ones.
    impactPaise: 0,
    estimated: false,
    detail: { thisWeek: now, lastWeek: before, counters: (row?.examples ?? []).slice(0, 6) },
    lever: now > before
      ? 'This is a leading indicator: shelf space goes before the order book does. Worth a scheme response before next cycle.'
      : null,
  }];
}

/** Counters nobody has walked into for a long time. */
async function coldCounters(region: string | null): Promise<Finding[]> {
  const rows = await sql<{ name: string; days: number; weekly: string }>(
    `WITH last_seen AS (
       SELECT ou.id, ou.name,
              current_date - COALESCE(MAX(v.occurred_at)::date, current_date - 999) AS days
         FROM outlets ou LEFT JOIN visits v ON v.outlet_id = ou.id
        WHERE ($1::text IS NULL OR ou.region = $1)
        GROUP BY ou.id, ou.name
     )
     SELECT ls.name, ls.days,
            COALESCE((SELECT AVG(o.total_paise) FROM orders o
                       WHERE o.outlet_id = ls.id AND o.status='confirmed'), 0)::bigint AS weekly
       FROM last_seen ls WHERE ls.days >= 14 ORDER BY ls.days DESC LIMIT 5`,
    [region]
  );
  // 999 is the "no visit on record" stand-in from the query above.
  return rows.map((r) => ({
    code: 'cold_counter',
    headline: r.days >= 999
      ? `${r.name} has never been called on.`
      : `${r.name} has not been called on in ${r.days} days.`,
    impactPaise: Number(r.weekly),
    estimated: true,
    detail: { outlet: r.name, daysSinceVisit: r.days >= 999 ? null : r.days },
    lever: Number(r.weekly) > 0
      ? `Worth about ${rs(Number(r.weekly))} an order when it is covered. Three weeks is long enough for a rival to take the shelf.`
      : 'No order history yet, so there is no number to put on it. Worth a first call.',
  }));
}

// -----------------------------------------------------------------------------

export type Answer = {
  scope: string;
  headline: string;
  trend: Awaited<ReturnType<typeof trend>>;
  findings: Finding[];
  biggestLever: string | null;
};

/** Every cause, computed and ranked. The model only chooses the scope. */
export async function answerFor(region: string | null): Promise<Answer> {
  const scope = region ?? 'the whole country';
  const [t, ...groups] = await Promise.all([
    trend(region),
    coverage(region),
    creditHolds(region),
    collections(region),
    competitor(region),
    coldCounters(region),
  ]);

  const findings = (groups.flat() as Finding[])
    .sort((a, b) => b.impactPaise - a.impactPaise);

  const direction = t.pct < 0 ? 'down' : t.pct > 0 ? 'up' : 'flat';
  const headline =
    `${scope} is ${rs(t.thisWeek)} this week against ${rs(t.lastWeek)} last week` +
    (direction === 'flat' ? '.' : ` — ${direction} ${Math.abs(t.pct)}%.`);

  return {
    scope,
    headline,
    trend: t,
    findings: findings.slice(0, 6),
    biggestLever: findings.find((f) => f.lever)?.lever ?? null,
  };
}
