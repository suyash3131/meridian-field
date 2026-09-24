import { PreProcessor, Lua } from 'lua-cli';

/**
 * Runs first on every message. Two jobs.
 *
 * 1. Keep the exact words. Lua hands tools only what the model passes them, so
 *    a tool that must act on what a person actually said (a manager's
 *    "approve", a rep's "haan") would otherwise be trusting the model's copy.
 *    The raw text, and on email the subject and Message-ID, go onto the
 *    conversation record here, before the model has seen anything.
 *
 * 2. Stay out of mail loops. An out-of-office reply, a bounce, or a no-reply
 *    robot writes back to whatever wrote to it. Answering it gets another one,
 *    forever. Those are dropped silently: no reply, no model call.
 */
export default new PreProcessor({
  name: 'turn-record',
  description: 'Record the exact words of each message for the tools, and drop automatic email',
  priority: 1,
  execute: async (user, messages, channel) => {
    const text = messages
      .filter((m: any) => m.type === 'text')
      .map((m: any) => String(m.text ?? ''))
      .join('\n')
      .trim();

    const payload = Lua.request?.webhook?.payload;
    // Shape only, never content: which fields this channel's payload carries.
    if (payload && typeof payload === 'object')
      console.log('turn-record payload keys', channel, JSON.stringify(Object.keys(payload).slice(0, 40)));
    const mail = channel === 'email' ? emailFacts(payload) : undefined;
    if (mail?.automatic) {
      console.log('turn-record dropped automatic mail', JSON.stringify({ why: mail.automatic, subject: mail.subject }));
      return { action: 'block' };   // silent: nothing is sent back
    }

    await user.patch({
      set: {
        lastText: text,
        lastChannel: channel,
        lastAt: new Date().toISOString(),
        lastMail: mail ?? null,
      },
    } as any).catch(() => {});
    return { action: 'proceed' };
  },
});

export type MailFacts = {
  messageId?: string;
  references?: string[];
  subject?: string;
  from?: string;
  automatic?: string;
};

/** The parts of an inbound email the tools need, from Lua's webhook payload.
 *  The generated inbox uses snake_case, a forwarding inbox camelCase. */
export function emailFacts(p: any): MailFacts {
  if (!p || typeof p !== 'object') return {};
  const pick = (...keys: string[]) => keys.map((k) => p[k]).find((v) => v != null);
  const refs = pick('references');
  const from = addressOf(pick('from', 'sender'));
  const subject = String(pick('subject') ?? '');
  const headers = headerMap(pick('headerLines', 'header_lines', 'headers'));
  return {
    messageId: pick('messageId', 'message_id') ?? undefined,
    references: Array.isArray(refs) ? refs : typeof refs === 'string' ? refs.split(/\s+/).filter(Boolean) : undefined,
    subject,
    from,
    automatic: automaticReason(from, subject, headers),
  };
}

function addressOf(v: any): string | undefined {
  if (!v) return undefined;
  if (typeof v === 'string') return (v.match(/<([^>]+)>/)?.[1] ?? v).trim().toLowerCase();
  if (Array.isArray(v)) return addressOf(v[0]);
  if (v.address) return String(v.address).toLowerCase();
  if (v.value) return addressOf(v.value);
  if (v.text) return addressOf(v.text);
  return undefined;
}

function headerMap(h: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(h))
    for (const x of h) {
      const key = String(x?.key ?? x?.name ?? '').toLowerCase();
      const val = String(x?.line ?? x?.value ?? '');
      if (key) out[key] = val.includes(':') && x?.line ? val.slice(val.indexOf(':') + 1).trim() : val;
    }
  else if (h && typeof h === 'object')
    for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  return out;
}

/** Why this email was written by a machine, or undefined if a person wrote it. */
export function automaticReason(from = '', subject = '', headers: Record<string, string> = {}): string | undefined {
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?)[@+.-]/i.test(from)) return 'robot sender';
  const auto = headers['auto-submitted'];
  if (auto && !/^no\b/i.test(auto)) return 'auto-submitted';
  if (headers['x-autoreply'] || headers['x-autorespond']) return 'auto-reply header';
  if (/^(bulk|junk|list|auto_reply)$/i.test(headers['precedence'] ?? '')) return 'bulk precedence';
  if (/^\s*(automatic reply|auto(matic)?[- ]?reply|autoreply|out of (the )?office|ooo\b|undeliverable|undelivered mail|delivery status notification|returned mail|mail delivery (failed|subsystem)|failure notice)/i
      .test(subject)) return 'auto-reply subject';
  return undefined;
}
