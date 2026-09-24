import { LuaTool, User } from 'lua-cli';
import { z } from 'zod';
import { currentManager } from '../../lib/api';
import { buttons } from '../../lib/rich';

/** A manager adds a rep to their team by chat. Shown back first; saved only on their yes (confirm_setup). */
export default class AddRepTool implements LuaTool {
  name = 'add_rep';
  description = 'A manager wants to add a new sales rep to their team. Shows what would be saved for them to confirm.';

  inputSchema = z.object({
    name: z.string().describe('Full name.'),
    phone: z.string().describe('WhatsApp number as given; it is how the agent will know him.'),
    email: z.string().optional(),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const mgr = await currentManager();
    const digits = input.phone.replace(/\D/g, '');
    if (digits.length < 10) return { sendExactly: 'What is his WhatsApp number, with the country code?', nextStep: 'Send sendExactly word for word and stop.' };
    const phone = '+' + (digits.length === 10 ? '91' + digits : digits);
    const user = await User.get();
    await user?.patch({ set: { pendingSetup: {
      kind: 'rep', at: new Date().toISOString(),
      data: { name: input.name.trim(), phone, email: input.email ?? null },
    } } } as any);
    return {
      sendExactly: `Add this rep to your team${mgr.region ? ` (${mgr.region})` : ''}?\n\n*${input.name.trim()}*\nWhatsApp: ${phone}` +
        (input.email ? `\nEmail: ${input.email}` : '') +
        `\n\nHe can message the agent from that number straight away. Reply *yes* to save.` + buttons(['Yes, add him', 'No']),
      nextStep: 'Send sendExactly word for word, including the ::: block, and stop. On yes, call confirm_setup.',
    };
  }
}
