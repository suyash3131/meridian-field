import { Data, LuaJob } from 'lua-cli';
import { get } from '../lib/api';
import { remember, type Memory } from '../lib/memory';

/**
 * Fill the shop memory with what the team said before the memory existed.
 *
 * Live remarks are written as they happen (lib/memory.ts). This rebuilds the
 * history part from the CRM, Sundays at 6am and whenever it is triggered by
 * hand after a demo reset: it clears what an earlier backfill wrote (never a
 * live remark), then writes the last three weeks of seeded no-order reasons
 * and rival sightings, each searchable by meaning.
 */
export default new LuaJob({
  name: 'memory-backfill',
  description: 'Rebuild the per-shop memory (vector search) from the last three weeks of visit remarks',
  schedule: { type: 'cron', expression: '0 6 * * 0', timezone: 'Asia/Kolkata' },
  timeout: 300,
  retry: { maxAttempts: 1, backoffSeconds: 60 },
  execute: async () => {
    // Collect first, then delete: deleting while paging skips entries.
    const stale: string[] = [];
    for (let page = 1; page <= 40; page++) {
      const r: any = await Data.get('shop_memory', undefined, page, 50).catch(() => null);
      const rows: any[] = r?.data ?? [];
      for (const e of rows) if (!(e.data ?? e).live) stale.push(e.id);
      if (rows.length < 50) break;
    }
    for (const id of stale) await Data.delete('shop_memory', id).catch(() => {});
    const cleared = stale.length;
    const { memories = [] } = await get<{ memories: Memory[] }>('/api/agent/memory-source?days=21');
    for (const m of memories) await remember({ ...m, backfilled: true } as any);
    console.log(`memory-backfill: cleared ${cleared}, wrote ${memories.length}`);
    return { cleared, wrote: memories.length };
  },
});
