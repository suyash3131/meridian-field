import { Data, LuaJob } from 'lua-cli';
import { get } from '../lib/api';
import { remember, type Memory } from '../lib/memory';

/**
 * Fill the shop memory with what the team said before the memory existed.
 *
 * Live remarks are written as they happen (lib/memory.ts). This rebuilds the
 * history part from the CRM, Sundays at 6am and whenever it is triggered by
 * hand after a demo reset: it clears the collection, then writes the last
 * three weeks of no-order reasons and rival sightings, each searchable by
 * meaning.
 */
export default new LuaJob({
  name: 'memory-backfill',
  description: 'Rebuild the per-shop memory (vector search) from the last three weeks of visit remarks',
  schedule: { type: 'cron', expression: '0 6 * * 0', timezone: 'Asia/Kolkata' },
  timeout: 300,
  retry: { maxAttempts: 1, backoffSeconds: 60 },
  execute: async () => {
    let cleared = 0;
    for (let guard = 0; guard < 40; guard++) {
      const page: any = await Data.get('shop_memory', undefined, 1, 50).catch(() => null);
      const rows: any[] = page?.data ?? [];
      if (!rows.length) break;
      for (const e of rows) { await Data.delete('shop_memory', e.id).catch(() => {}); cleared++; }
    }
    const { memories = [] } = await get<{ memories: Memory[] }>('/api/agent/memory-source?days=21');
    for (const m of memories) await remember(m);
    console.log(`memory-backfill: cleared ${cleared}, wrote ${memories.length}`);
    return { cleared, wrote: memories.length };
  },
});
