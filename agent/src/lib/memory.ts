import { Data } from 'lua-cli';

/**
 * What the field team has learned about each shop, kept in Lua's own Data
 * store and searchable by meaning (vector search).
 *
 * Postgres holds everything that must be exact: orders, credit, money. This
 * holds the soft things a good rep remembers and a new one never knows:
 * "complained about Dolomed expiry", "owner only there after 4pm", "Cipla
 * gave him 10+3". Exact lookups by shop feed the counter brief; searches by
 * meaning let a manager ask "which shops complained about expiry?" and find
 * "batch was near expiry" and "purana stock" too, which no keyword would.
 *
 * A memory is never a number the agent does maths with. Money stays in the CRM.
 */
const COLLECTION = 'shop_memory';

export type Memory = {
  outletId: string; outlet: string; region?: string | null;
  kind: 'remark' | 'no_order' | 'competitor' | 'chemist' | 'change' | 'preference';
  text: string; by: string; at?: string;
};

export async function remember(m: Memory): Promise<void> {
  try {
    const at = m.at ?? new Date().toISOString();
    await Data.create(COLLECTION, { ...m, at }, {
      searchText: `${m.outlet}: ${m.text}`,
      index: ['outletId'],
    });
  } catch (e) {
    // A memory is a courtesy to the next visit. Losing one never fails the turn.
    console.log('memory not saved', String(e));
  }
}

/** The latest few things remembered about one shop, newest first. */
export async function recall(outletId: string, n = 3): Promise<Memory[]> {
  try {
    const r: any = await Data.get(COLLECTION, { outletId } as any, 1, 20);
    const rows: Memory[] = (r?.data ?? []).map((e: any) => (e.data ?? e) as Memory);
    return rows.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, n);
  } catch { return []; }
}

/** Shops whose memories mean something like the question. */
export async function searchMemory(question: string, region?: string | null, n = 8): Promise<(Memory & { score: number })[]> {
  try {
    const hits = await Data.search(COLLECTION, question, 25, 0.35);
    return hits
      .map((h: any) => ({ ...(h.data ?? h), score: Number(h.score ?? 0) }))
      .filter((m: any) => !region || region === 'all' || !m.region || m.region === region)
      .slice(0, n);
  } catch { return []; }
}
