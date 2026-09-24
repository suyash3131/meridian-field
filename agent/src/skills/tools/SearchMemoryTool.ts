import { LuaTool, User } from 'lua-cli';
import { z } from 'zod';
import { searchMemory } from '../../lib/memory';

/**
 * Search what the field team has said about shops, by meaning. "Which shops
 * complained about expiry?" finds "purana batch, expiry paas hai" although no
 * word is shared. The words returned are the reps' and chemists' own.
 */
export default class SearchMemoryTool implements LuaTool {
  name = 'search_memory';
  description =
    'Search what reps and chemists have said about shops, by meaning: complaints, expiry, delivery problems, ' +
    'preferences, rivals, anything remembered. Use it for questions like "which shops complained about X", ' +
    '"who mentioned Y", "anything about Z at Sharma".';

  inputSchema = z.object({
    question: z.string().describe('What to look for, in the words they used.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const u: any = await User.get();
    const region = u?.role === 'manager' ? u.region : u?.region;
    const hits = await searchMemory(input.question, region, 8);
    if (!hits.length)
      return { sendExactly: 'Nothing on file matches that.', nextStep: 'Send sendExactly word for word and stop.' };
    const day = (iso?: string) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '';
    const shops = new Set(hits.map((h) => h.outlet));
    return {
      sendExactly: `${shops.size} shop${shops.size === 1 ? '' : 's'} on file:\n\n` +
        hits.map((h) => `• *${h.outlet}*, ${day(h.at)} (${h.by}): "${h.text}"`).join('\n'),
      nextStep: 'Send sendExactly word for word and stop. These are remembered remarks, found by meaning; say so if asked how.',
    };
  }
}
