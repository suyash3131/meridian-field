import { Data, AI } from 'lua-cli';

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
  /** A few plain English words for what the remark means. Reps write Hinglish,
   *  and the embedding model matches English questions to Hinglish poorly: an
   *  expiry complaint scored 0.70 against 0.69 for "stock bhara hai". With the
   *  gist beside the words, meaning is what gets matched. */
  gist?: string;
};

/** Saves one memory. True only if the store accepted it: a tool never says
 *  "remembered" for something that was not. */
export async function remember(m: Memory): Promise<boolean> {
  try {
    const at = m.at ?? new Date().toISOString();
    // The plain searchText form: this runtime rejects the options object.
    // `live` marks what the agent heard as it happened; a rebuild of the history
    // (jobs/memory-backfill.ts) replaces everything else, never these.
    const live = !(m as any).backfilled;
    // The remark (and its gist) alone: a shop name in it made every "which
    // shops…" question match everything equally.
    await Data.create(COLLECTION, { ...m, at, live }, m.gist ? `${m.gist}. ${m.text}` : m.text);
    return true;
  } catch (e) {
    // A memory is a courtesy to the next visit. Losing one never fails the turn.
    console.log('memory not saved', String(e));
    return false;
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

/**
 * Remarks that answer the question, grouped. Retrieve, then re-rank.
 *
 *  1. Recall: vector search on a few phrasings of the question (a lone word
 *     embeds poorly; a whole question drags in every remark about a shop),
 *     each remark keeping its best score. The top distinct remarks are the
 *     candidates.
 *  2. Re-rank: the embedding model scores almost everything 0.69–0.75 on these
 *     short Hinglish remarks ("shop closed" scored 0.73 for "expiry"), so no
 *     cut-off separates right from wrong. A small fast model reads the
 *     candidates and says which actually answer the question. Nothing it says
 *     reaches the person: it only picks from remarks already on file.
 *  3. The same words about the same shop on several visits become one line.
 *
 * A question nothing answers gets nothing, not the least-bad remark.
 */
export async function searchMemory(question: string, region?: string | null, n = 8):
    Promise<(Memory & { score: number; times: number })[]> {
  try {
    const topic = question.toLowerCase()
      .replace(/\b(which|what|who|where|when|any|anyone|anything|all|shops?|stores?|counters?|chemists?|customers?|mentioned?|said|told|complain(ed|ts?|ing)?|unhappy|about|regarding|that|there|was|were|is|are|has|have|had|the|a|an|or|and|did|do|does|of|on|in|at|to|for|with|us|we|our)\b/g, ' ')
      .replace(/[^\p{L}\p{N}+%\s]/gu, ' ').replace(/\s+/g, ' ').trim() || question;
    const phrasings = [...new Set([question, topic, `shop remark: ${topic}`])];
    const best = new Map<string, Memory & { score: number }>();
    for (const q of phrasings)
      for (const h of await Data.search(COLLECTION, q, 40, 0.2).catch(() => [] as any[])) {
        const e: any = h, id = String(e.id);
        const m = { ...(e.data ?? e), score: Number(e.score ?? 0) } as Memory & { score: number };
        if (!best.has(id) || best.get(id)!.score < m.score) best.set(id, m);
      }
    const hits = [...best.values()].sort((a, b) => b.score - a.score)
      .filter((m) => !region || region === 'all' || !m.region || m.region === region);
    if (!hits.length) return [];

    // Distinct remarks, best first: these are what the re-ranker reads.
    const distinct: string[] = [];
    for (const h of hits) { const t = h.text.trim(); if (!distinct.includes(t)) distinct.push(t); if (distinct.length >= 15) break; }
    const keep = await rerank(question, distinct);
    console.log('memory search', JSON.stringify({ question, candidates: distinct.length, kept: keep.map((t) => t.slice(0, 50)) }));
    if (!keep.length) return [];

    const grouped = new Map<string, Memory & { score: number; times: number }>();
    for (const h of hits.filter((h) => keep.includes(h.text.trim()))) {
      const k = `${h.outletId}|${h.text.trim().toLowerCase()}`;
      const g = grouped.get(k);
      if (!g) grouped.set(k, { ...h, times: 1 });
      else { g.times++; if (String(h.at) > String(g.at)) g.at = h.at; }
    }
    return [...grouped.values()].slice(0, n);
  } catch { return []; }
}

/** Which candidate remarks answer the question. Returns a subset of them, exactly. */
async function rerank(question: string, candidates: string[]): Promise<string[]> {
  try {
    const r = await AI.generate({
      model: 'google/gemini-3.8-flash',
      temperature: 0,
      messages: [{ role: 'user', content:
        `Question from a sales manager: "${question}"\n\n` +
        `Remarks field reps and chemists made about pharmacy shops (Hindi/English mix):\n` +
        candidates.map((c, i) => `${i + 1}. ${c}`).join('\n') +
        `\n\nWhich remarks are about what the question asks, directly or clearly indirectly (a rival ` +
        `taking shelf space is about rivals; an old batch is about expiry)? Leave out remarks that only ` +
        `share a word. Reply with the numbers only, comma separated, or NONE.` }] as any,
    });
    const text = String(r.text ?? '').trim();
    if (/none/i.test(text)) return [];
    const nums = [...text.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((i) => i >= 1 && i <= candidates.length);
    return [...new Set(nums)].map((i) => candidates[i - 1]);
  } catch (e) {
    console.log('memory rerank failed', String(e));
    return [];
  }
}
