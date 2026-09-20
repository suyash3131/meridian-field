import { Pool } from 'pg';

/** Where the business actually operates. Not where the servers are. */
export const BUSINESS_TZ = 'Asia/Kolkata';

/**
 * The weekday as the rep experiences it, 1 = Monday … 7 = Sunday.
 * `new Date().getDay()` on Vercel is UTC and quietly disagrees with the
 * database for five and a half hours a day.
 */
export function businessWeekday(at: Date = new Date()): number {
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TZ, weekday: 'short',
  }).format(at);
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(day) + 1;
}

// Lazy, module-level pool. `next build` evaluates top-level module code, so a
// pool constructed at import time crashes the build before DATABASE_URL exists.
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 10_000,
    });

    // Every counter, rep and manager in this business is in India; the database
    // is in us-east-1. Left in UTC, `current_date` rolls over at 5:30am IST, so
    // for the first five and a half hours of every working day the system is
    // looking at yesterday's route — which is precisely when reps start work.
    // Set once per connection so every `now()` and `current_date` in the app
    // means what a rep in Karol Bagh means by it.
    pool.on('connect', (client) => {
      client.query(`SET TIME ZONE '${BUSINESS_TZ}'`).catch(() => {});
    });
  }
  return pool;
}

export async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await getPool().query(text, params);
  return res.rows as T[];
}

export async function one<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await sql<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Run several statements as one unit.
 *
 * Confirming an order writes a visit, an order, its lines and an invoice. A
 * failure partway through leaves a confirmed order with no receivable against
 * it — money that exists in one table and not in another, which is how books
 * stop reconciling. Either all of it lands or none of it does.
 */
export async function tx<T>(
  fn: (q: <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const q = async <R,>(text: string, params: unknown[] = []) =>
      (await client.query(text, params)).rows as R[];
    const out = await fn(q);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Money lives as integer paise everywhere. Format only at the edges. */
export const rs = (paise: number | string | null | undefined): string =>
  '₹' + (Number(paise ?? 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
