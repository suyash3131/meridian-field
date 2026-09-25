import { User } from 'lua-cli';
import { type Lang, choiceText, readBackText, replyIn, tr } from './say';
import { note } from './guard';

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
  const out = await res.json();
  await note(path, out);
  return out as T;
}

export async function get<T = any>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  const out = await res.json();
  await note(path, out);
  return out as T;
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

  const phone = senderPhone(user);
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

/** The number a WhatsApp conversation came from, digits only. Undefined on
 *  the web widget, which has no phone behind it. */
export function senderPhone(user: any): string | undefined {
  const n = user?._luaProfile?.mobileNumbers?.[0];
  const num = typeof n === 'string' ? n : n?.number ?? n?.mobileNumber;
  const digits = num ? String(num).replace(/[^\d]/g, '') : '';
  return digits.length >= 10 ? digits : undefined;
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
      `Send sendExactly to the rep word for word, including the ::: block at the end, nothing before or after it, and stop. ` +
      `When he agrees — yes, ok, haan, thik hai, ha, a tick, or a tap on "Confirm" / "कन्फ़र्म" — call confirm_order with ` +
      `draftId "${draftId}". A tap on "Change" / "बदलें" is decline_order with pick "change"; a tap on "Cancel" / ` +
      `"रद्द करें" is decline_order with pick "cancel". Do NOT call draft_order again: this order already exists.`,
  };
}

export function askText(draftId: string, question: string, options: { key: string; label: string }[], lang: Lang = 'en') {
  return {
    draftId,
    sendExactly: choiceText(tr(question, lang), options.map((o) => tr(o.label, lang))),
    optionKeys: options.map((o, i) => ({ number: i + 1, label: tr(o.label, lang), key: o.key })),
    replyIn: replyIn(lang),
    nextStep:
      'Send sendExactly to the rep word for word, including any ::: block, and stop. When he replies ' +
      'with a number or taps an option ("I selected: *Sharma Medical*"), call answer_choice with the key from ' +
      'optionKeys whose number or label matches.',
  };
}

/**
 * The manager asking, from the conversation's verified record: bound by the
 * roster pre-processor from their email address or WhatsApp number. Never from
 * a tool argument: "I am Vikram" in a message changes nothing here.
 */
export async function currentManager(): Promise<{ id: string; name: string; region: string | null }> {
  const u: any = await User.get();
  if (u?.role !== 'manager' || !u.managerId)
    throw new Error('Only a Meridian manager can do that, and only from their own email or WhatsApp number.');
  return { id: u.managerId, name: u.managerName ?? u.managerId, region: u.region && u.region !== 'all' ? u.region : null };
}

/** The chemist writing, and the shops their verified email or number belongs to. */
export async function currentChemist(): Promise<{ name: string; shops: { id: string; name: string; area?: string }[] }> {
  const u: any = await User.get();
  if (u?.role !== 'chemist' || !Array.isArray(u.chemistShops) || !u.chemistShops.length)
    throw new Error('This is for a shop writing from the email or number Meridian has on file for it.');
  return { name: u.chemistName ?? u.chemistShops[0].name, shops: u.chemistShops };
}

/** Exactly what the person sent this turn, as the pre-processors left it, and
 *  any order or approval references in the email (including its quoted part). */
export async function thisTurn(): Promise<{ text: string; refs: string[]; channel: string }> {
  const u: any = await User.get();
  return { text: String(u?.lastText ?? ''), refs: Array.isArray(u?.lastRefs) ? u.lastRefs : [], channel: String(u?.lastChannel ?? '') };
}

/** What /api/agent/answer sent back, turned into what the rep sees. Shared by
 *  answer_choice and by a Change / Cancel tap on the slip. */
export function afterAnswer(result: any, lang: Lang) {
  if (result.kind === 'draft') return readBack(result.draftId, result.summary, lang);
  if (result.kind === 'question' || result.kind === 'duplicate')
    return askText(result.draftId, result.question, result.options, lang);
  if (result.kind === 'parked') return { parked: true, sendExactly: tr(result.message, lang) };
  if (result.kind === 'cancelled')
    return { cancelled: true, sendExactly: tr(result.message, lang),
             nextStep: 'Send sendExactly word for word and stop. This order is closed.' };
  if (result.kind === 'change')
    return {
      sendExactly: tr(result.message, lang), replyIn: replyIn(lang),
      nextStep:
        'Send sendExactly word for word and stop. His next message is the change. Call ' +
        'draft_order for the same counter with the whole order as it now stands: the lines ' +
        'you read back, with his change applied. Put his new message in message.',
    };
  return { error: tr(result.message ?? 'that answer did not fit the question', lang), replyIn: replyIn(lang) };
}
