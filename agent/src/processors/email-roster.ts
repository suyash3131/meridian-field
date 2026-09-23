import { PreProcessor } from 'lua-cli';
import { post, senderEmail } from '../lib/api';

/**
 * Runs on every message before the model sees it. On email it does two jobs
 * the model must not be trusted with.
 *
 * 1. Who is writing. The sender's address is looked up on the team roster and
 *    the answer pinned to the conversation: a rep gets his ID bound, a manager
 *    is marked as one, and an address nobody knows is turned away here, with
 *    no model call at all. On the browser widget anyone can say "I am R-07";
 *    on email anyone can type a name, so the address is the only thing believed.
 *
 * 2. What they wrote. A reply email carries the whole thread under it,
 *    "On Wed, 23 Sept … wrote:" and every earlier line quoted with ">". Left in,
 *    yesterday's order reads as today's. Only the new text goes forward.
 *
 * Every other channel passes straight through.
 */
export default new PreProcessor({
  name: 'email-roster',
  description: 'Identify email senders from the team roster and strip quoted reply history',
  priority: 10,
  execute: async (user, messages, channel) => {
    if (channel !== 'email') return { action: 'proceed' };

    const u: any = user;
    if (!u.repId && u.role !== 'manager') {
      const email = senderEmail(u);
      const found = email
        ? await post<{ id?: string; name?: string; region?: string | null; role?: string; title?: string; verifiedBy?: string }>(
            '/api/agent/whoami', { email }).catch(() => ({} as any))
        : {};
      if (!found.id)
        return {
          action: 'block',
          response:
            'This address is not on the Meridian field team roster, so I cannot take orders or share ' +
            'territory numbers from it. Please write from your work email, or ask your ASM to add you.',
        };
      const set: Record<string, unknown> =
        found.role === 'manager'
          ? { role: 'manager', managerId: found.id, managerName: found.name, region: found.region ?? 'all' }
          : { role: 'rep', repId: found.id, repName: found.name, region: found.region };
      await user.patch({ set: { ...set, identityVerifiedBy: found.verifiedBy, boundAt: new Date().toISOString() } } as any);
    }

    const cleaned = messages.map((m: any) =>
      m.type === 'text' ? { ...m, text: newTextOnly(m.text) } : m);
    return { action: 'proceed', modifiedMessage: cleaned };
  },
});

/** The part of an email above the quoted thread, without the signature. */
export function newTextOnly(text: string): string {
  const lines = String(text ?? '').split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*On .+wrote:\s*$/i.test(line)) break;          // Gmail / Apple Mail
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line)) break; // Outlook
    if (/^\s*From:\s.+/i.test(line) && out.length) break;   // Outlook, no banner
    if (/^--\s*$/.test(line)) break;                        // signature delimiter
    if (/^\s*>/.test(line)) continue;                       // quoted line
    out.push(line);
  }
  const t = out.join('\n').trim();
  return t || String(text ?? '').trim();   // never hand the model an empty message
}
