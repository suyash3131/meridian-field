import { User } from 'lua-cli';
import { type Lang, readBackText, replyIn, tr } from './say';

/**
 * The CRM this agent writes into. Every rule that matters — which counter,
 * which pack, what it costs, whether the credit holds, whether the visit is
 * real — lives behind this URL, not in a prompt. These tools are wrappers.
 */
const BASE = process.env.CRM_API_BASE ?? 'https://meridian-sigma-gules.vercel.app';

export async function post<T = any>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export async function get<T = any>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  return (await res.json()) as T;
}

/**
 * Who is at this counter.
 *
 * Identity is read from the conversation's own record, never from a tool
 * argument, because an argument is whatever the model was told and the record
 * is what the server verified. On WhatsApp the phone number settles it. In the
 * browser demo there is no phone, so the first message may name a rep — that
 * claim is checked against the roster and then pinned to the record, and every
 * turn after it is read back rather than asked for again.
 */
export async function currentRep(claimedRepId?: string): Promise<{ id: string; name: string }> {
  const user = await User.get();
  if (!user) throw new Error('No rep is attached to this conversation.');

  if ((user as any).role === 'manager')
    throw new Error('This address belongs to a manager. Orders are placed by reps; ask me about the territory instead.');

  const bound = (user as any).repId as string | undefined;
  if (bound) return { id: bound, name: ((user as any).repName as string) ?? bound };

  const phone = user._luaProfile?.mobileNumbers?.[0];
  const email = senderEmail(user);
  const found = await post<{ id?: string; name?: string; region?: string; role?: string; verifiedBy?: string; error?: string }>(
    '/api/agent/whoami', { phone, email, claimedRepId }
  );
  if (found.role === 'manager')
    throw new Error('This address belongs to a manager. Orders are placed by reps; ask me about the territory instead.');
  if (!found.id)
    throw new Error("I don't know which rep this is. Open the rep view and pick your name.");

  await user.patch({
    set: {
      repId: found.id,
      repName: found.name,
      region: found.region,
      identityVerifiedBy: found.verifiedBy,
      boundAt: new Date().toISOString(),
    },
  });
  return { id: found.id, name: found.name! };
}

/** The address an email conversation came from, as Lua's profile records it.
 *  Undefined on every other channel. */
export function senderEmail(user: any): string | undefined {
  const e = user?._luaProfile?.emailAddresses?.[0];
  const addr = typeof e === 'string' ? e : e?.address;
  return addr ? String(addr).toLowerCase() : undefined;
}

/** ₹ for display only. Every number crossing this boundary is integer paise. */
export const rs = (paise: number | null | undefined): string =>
  '₹' + (Number(paise ?? 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });

/** The language this rep chose in the app, read from the CRM, never from the
 *  model. Anything unexpected falls back to English. */
export async function repLang(): Promise<Lang> {
  try {
    const user = await User.get();
    const id = (user as any)?.repId as string | undefined;
    if (!id) return 'en';
    const r = await get<{ lang?: string }>(`/api/rep/lang?repId=${encodeURIComponent(id)}`);
    return r.lang === 'hi' ? 'hi' : 'en';
  } catch { return 'en'; }
}

/**
 * The exact words the rep sees. Built here, not by the model, so the model
 * has nothing to paraphrase: it once replaced the resolved counter with the
 * rep's own spelling, and once invented four products for a question.
 */
export function readBack(draftId: string, s: any, lang: Lang = 'en') {
  return {
    draftId,
    sendExactly: readBackText(s, lang),
    replyIn: replyIn(lang),
    nextStep:
      `Send sendExactly to the rep word for word, nothing before or after it, and stop. ` +
      `When he agrees — yes, ok, haan, thik hai, ha, a tick — call confirm_order with ` +
      `draftId "${draftId}". Do NOT call draft_order again: this order already exists.`,
  };
}

export function askText(draftId: string, question: string, options: { key: string; label: string }[], lang: Lang = 'en') {
  return {
    draftId,
    sendExactly: [tr(question, lang), ...options.map((o, i) => `${i + 1}. ${tr(o.label, lang)}`)].join('\n'),
    optionKeys: options.map((o, i) => ({ number: i + 1, key: o.key })),
    replyIn: replyIn(lang),
    nextStep:
      'Send sendExactly to the rep word for word and stop. When he replies with a number, ' +
      'call answer_choice with the matching key from optionKeys.',
  };
}
