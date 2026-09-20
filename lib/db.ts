import { Pool } from 'pg';

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
