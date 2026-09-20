import { NextResponse } from 'next/server';
import { one, sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Is the agent actually being used, or is it merely not crashing?
 *
 * Order volume tells you the product worked last month. These four numbers
 * tell you whether it will still be working next month — a rep who starts an
 * order and walks away has already decided, he just hasn't told anyone.
 */
export async function GET() {
  const [speed, questions, matching, abandoned, recent] = await Promise.all([
    one<{ median_ms: number; p90_ms: number; n: number }>(
      `SELECT
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ms_since_first)::int AS median_ms,
         PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ms_since_first)::int AS p90_ms,
         count(*)::int AS n
       FROM agent_events WHERE event = 'confirmed' AND ms_since_first IS NOT NULL`),
    one<{ avg_questions: string; zero_question_pct: number; n: number }>(
      `SELECT
         COALESCE(AVG(questions_so_far), 0)::numeric(4,2)::text AS avg_questions,
         (100.0 * count(*) FILTER (WHERE questions_so_far = 0)
            / NULLIF(count(*), 0))::int AS zero_question_pct,
         count(*)::int AS n
       FROM agent_events WHERE event = 'confirmed'`),
    one<{ auto_pct: number; n: number }>(
      `SELECT (100.0 * count(*) FILTER (WHERE match_method <> 'asked')
                 / NULLIF(count(*), 0))::int AS auto_pct,
              count(*)::int AS n
         FROM order_lines`),
    one<{ n: number; started: number }>(
      `SELECT
         (SELECT count(*)::int FROM agent_events WHERE event = 'abandoned') AS n,
         (SELECT count(DISTINCT thread_id)::int FROM agent_events WHERE event = 'message_in') AS started`),
    sql<{ phrase: string; times: number; asked: number }>(
      `SELECT matched_from AS phrase, count(*)::int AS times,
              count(*) FILTER (WHERE match_method = 'asked')::int AS asked
         FROM order_lines WHERE matched_from IS NOT NULL
         GROUP BY matched_from HAVING count(*) FILTER (WHERE match_method = 'asked') > 0
         ORDER BY count(*) FILTER (WHERE match_method = 'asked') DESC LIMIT 6`),
  ]);

  const started = abandoned?.started ?? 0;
  return NextResponse.json({
    speed: {
      medianSeconds: speed?.median_ms ? +(speed.median_ms / 1000).toFixed(1) : null,
      p90Seconds: speed?.p90_ms ? +(speed.p90_ms / 1000).toFixed(1) : null,
      sample: speed?.n ?? 0,
      target: 30,
    },
    questions: {
      perOrder: Number(questions?.avg_questions ?? 0),
      answeredWithoutAsking: questions?.zero_question_pct ?? 0,
      budget: 1,
    },
    matching: { autoResolvedPct: matching?.auto_pct ?? 0, lines: matching?.n ?? 0 },
    abandoned: {
      count: abandoned?.n ?? 0,
      started,
      pct: started ? Math.round(((abandoned?.n ?? 0) / started) * 100) : 0,
    },
    // Every phrase here is one alias away from never being asked about again.
    phrasesWeKeepAskingAbout: recent,
  });
}
