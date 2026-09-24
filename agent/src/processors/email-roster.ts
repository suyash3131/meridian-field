import { PreProcessor, Lua } from 'lua-cli';
import { post, senderEmail, senderPhone } from '../lib/api';
import { emailFacts } from './turn-record';

/**
 * Runs on every message before the model sees it, after voice notes and order
 * sheets have become text. The jobs the model must not be trusted with:
 *
 * 1. Who is writing. On email the sender's address, on WhatsApp the number
 *    (both verified by the channel), is looked up on the roster and the answer
 *    pinned to the conversation: a rep gets his ID bound, a manager is marked as
 *    one, a chemist is tied to their own shops. Anyone else is turned away here,
 *    with no model call at all. On the browser widget anyone can say "I am
 *    R-07"; on email or WhatsApp they can type any name, so only the address or
 *    number is believed.
 *
 * 2. What they wrote. A reply email carries the whole thread under it. Left in,
 *    yesterday's order reads as today's, so only the new text goes forward (a
 *    forward keeps the forwarded message: that is the point of forwarding it).
 *    Before that is cut, any order or approval reference anywhere in the email,
 *    quoted part included, is kept aside: "APPROVE" typed above a quoted held-
 *    order email names the order through the quote.
 *
 * 3. Data enrichment. A manager's or chemist's message goes to the model with
 *    one line in front saying who this verified sender is, so it answers a
 *    manager as a manager and a customer as a customer. Rep messages go through
 *    untouched: the order tools read the rep's own words.
 *
 * 4. The final words are saved on the conversation record, where tools that
 *    must act only on what a person actually said (a manager's approve, a
 *    manager's "yes, add it") read them.
 */
type Found = {
  id?: string; name?: string; region?: string | null; role?: string; title?: string; verifiedBy?: string;
  shops?: { id: string; name: string; area?: string }[];
};

export default new PreProcessor({
  name: 'email-roster',
  description: 'Identify email and WhatsApp senders from the roster, strip quoted email history, enrich, and record the final text',
  priority: 10,
  execute: async (user, messages, channel) => {
    const u: any = user;
    const isEmail = channel === 'email';
    const phone = isEmail ? undefined : senderPhone(u);
    const rawText = messages.filter((m: any) => m.type === 'text').map((m: any) => String(m.text ?? '')).join('\n');
    const mail = isEmail ? emailFacts(Lua.request?.webhook?.payload) : undefined;
    console.log('roster saw', JSON.stringify({ channel, phoneEnds: phone?.slice(-4) ?? null, bound: u.repId ?? u.managerId ?? u.role ?? null }));

    // The web widget: nobody is verified, nothing is bound here.
    if (!isEmail && !phone) {
      await user.patch({ set: { lastText: ownWords(rawText), lastRefs: [] } } as any).catch(() => {});
      return { action: 'proceed' };
    }

    if (!u.repId && u.role !== 'manager' && u.role !== 'chemist') {
      const email = isEmail ? senderEmail(u) : undefined;
      const found: Found = email || phone
        ? await post<Found>('/api/agent/whoami', isEmail ? { email } : { phone }).catch(() => ({}))
        : {};
      if (!found.id)
        return {
          action: 'block',
          response: isEmail
            ? 'This address is not on the Meridian roster, so I cannot take orders or share numbers from it. ' +
              'If you are on the field team, write from your work email or ask your ASM to add you. ' +
              'If you are a chemist, ask your Meridian rep to put this address on your shop.'
            : 'This number is not on the Meridian roster, so I cannot take orders or share numbers from it. ' +
              'Please ask your ASM to add your number.',
        };
      const set: Record<string, unknown> =
        found.role === 'manager'
          ? { role: 'manager', managerId: found.id, managerName: found.name, managerTitle: found.title, region: found.region ?? 'all' }
          : found.role === 'chemist'
          ? { role: 'chemist', chemistName: found.name, chemistShops: found.shops ?? [{ id: found.id, name: found.name }] }
          : { role: 'rep', repId: found.id, repName: found.name, region: found.region };
      await user.patch({ set: { ...set, identityVerifiedBy: found.verifiedBy, boundAt: new Date().toISOString() } } as any);
      Object.assign(u, set, { identityVerifiedBy: found.verifiedBy });
    }

    // References anywhere in the email, quote included, before the quote is cut.
    const refs = [...new Set(
      [...`${mail?.subject ?? ''}\n${rawText}`.matchAll(/\b(ORD-[a-z0-9]+|APR-[a-z0-9]+)\b/gi)].map((m) => m[1].toUpperCase()))];

    let cleaned = isEmail
      ? messages.map((m: any) => (m.type === 'text' ? { ...m, text: newTextOnly(m.text, mail?.subject ?? '') } : m))
      : messages;
    const finalText = ownWords(cleaned.filter((m: any) => m.type === 'text').map((m: any) => String(m.text ?? '')).join('\n'));

    // Who this is, in one line in front, for managers and chemists only.
    const who =
      u.role === 'manager' ? `[Verified sender: ${u.managerName ?? 'a manager'}, ${u.managerTitle === 'regional_head' ? 'regional head' : 'area sales manager'}` +
                             `${u.region && u.region !== 'all' ? `, ${u.region}` : ''}. This is a manager, not a rep.]`
      : u.role === 'chemist' ? `[Verified sender: ${u.chemistName ?? 'a chemist'}, a chemist shop (a customer), writing from the ${isEmail ? 'email address' : 'number'} Meridian has for: ` +
                               `${(u.chemistShops ?? []).map((s: any) => s.name).join(', ')}. Not a rep: they cannot place, change or approve orders.]`
      : null;
    if (who) {
      const i = cleaned.findIndex((m: any) => m.type === 'text');
      cleaned = i >= 0
        ? cleaned.map((m: any, j: number) => (j === i ? { ...m, text: `${who}\n${m.text}` } : m))
        : [{ type: 'text', text: who } as any, ...cleaned];
    }

    await user.patch({ set: { lastText: finalText, lastRefs: refs } } as any).catch(() => {});
    return who || isEmail ? { action: 'proceed', modifiedMessage: cleaned } : { action: 'proceed' };
  },
});

/**
 * Only what the person typed or tapped this turn, for tools that act on it.
 *
 * A WhatsApp tap or swipe-reply arrives with the message it answers attached
 * after "::: hide This is a reply to…". That attachment is OUR earlier message,
 * and it once contained "…or approve all": read as the manager's words, one tap
 * on "Approve 1" approved six orders. So it is cut off here, before any check.
 * A tap on a list row, "I selected: *Option 1* (Approve 1)", is its label alone.
 */
export function ownWords(text: string): string {
  let t = String(text ?? '').split(/\n?:::\s*hide\b/i)[0];
  t = t.replace(/^\s*I selected:\s*\*[^*]*\*\s*\((.+)\)\s*$/im, '$1')   // list row: "(label)"
       .replace(/^\s*I selected:\s*\*(.+?)\*\s*$/im, '$1');            // reply button: "*label*"
  return t.trim();
}

/**
 * What the sender actually wrote, for the model.
 *
 *  - A reply: only the new text above the quoted thread, no signature.
 *  - A forward: the note on top AND the forwarded message itself, since a rep
 *    forwarding a chemist's order is sending that order. Only the header block
 *    (From/Date/Subject/To) of the forwarded part is dropped.
 *  - Nothing in the body at all: the subject, which is where some people type.
 */
export function newTextOnly(text: string, subject = ''): string {
  const lines = String(text ?? '').split(/\r?\n/);
  const out: string[] = [];
  let forwarded = false;
  for (const line of lines) {
    if (/^\s*-{2,}\s*Forwarded message\s*-{2,}/i.test(line) || /^\s*Begin forwarded message:?\s*$/i.test(line)) {
      forwarded = true;
      out.push('Forwarded:');
      continue;
    }
    if (forwarded && /^\s*(From|Date|Sent|Subject|To|Cc):\s/i.test(line)) continue; // forwarded header block
    if (!forwarded) {
      if (/^\s*On .+wrote:\s*$/i.test(line)) break;                    // Gmail / Apple Mail
      if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;     // Outlook
      if (/^\s*From:\s.+/i.test(line) && out.length) break;            // Outlook, no banner
      if (/^--\s*$/.test(line)) break;                                   // signature delimiter
    }
    if (/^\s*>/.test(line)) continue;                                    // quoted line
    out.push(line);
  }
  const t = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (t && t !== 'Forwarded:') return t;
  const subj = String(subject ?? '').replace(/^\s*((re|fw|fwd|aw)\s*:\s*)+/i, '').trim();
  return subj || String(text ?? '').trim();   // never hand the model an empty message
}
