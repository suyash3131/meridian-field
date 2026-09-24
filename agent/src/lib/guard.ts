import { User } from 'lua-cli';

/**
 * What the CRM actually said this turn, so the reply can be checked against it.
 *
 * Every tool reaches the CRM through post() and get() in api.ts, and every
 * rupee figure a tool shows comes from one of those answers. So each answer is
 * noted on the conversation's record: its rupee figures, and whether it was a
 * confirmed order. The reply-check post-processor reads the notes after the
 * model has written its reply, and clears them for the next turn.
 */
export type TurnNote = { rupees: string[]; placed: boolean };

/** Every ₹ figure in a piece of text, commas removed: "₹1,42,656" → "142656". */
export function rupeesIn(text: string): string[] {
  return [...String(text ?? '').matchAll(/₹\s?([\d,]+(?:\.\d+)?)/g)].map((m) => m[1].replace(/,/g, ''));
}

/** Rupee figures in a CRM answer: ₹ strings it already wrote, and every *Paise
 *  field as the whole rupees a tool would show (rs() rounds the same way). */
function rupeesOf(body: unknown): string[] {
  const out = rupeesIn(JSON.stringify(body));
  const walk = (v: any, key = '') => {
    if (Array.isArray(v)) v.forEach((x) => walk(x));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, k));
    else if (/paise$/i.test(key) && v != null && !isNaN(Number(v))) out.push(String(Math.round(Number(v) / 100)));
  };
  walk(body);
  return out;
}

export async function note(path: string, body: any): Promise<void> {
  try {
    const user: any = await User.get();
    if (!user) return;
    const placed = path.startsWith('/api/agent/confirm') && !body?.error;
    const n: TurnNote = { rupees: rupeesOf(body), placed };
    await user.patch({ set: { turnNotes: [...(user.turnNotes ?? []), n] } });
  } catch { /* a missing note makes the check stricter, never looser */ }
}

/** For a tool that formats a CRM amount itself from a field not named *Paise
 *  (the pulse's approvals carry "value"): note the ₹ it is about to show. */
export async function noteShown(shown: unknown): Promise<void> {
  try {
    const user: any = await User.get();
    if (!user) return;
    const n: TurnNote = { rupees: rupeesIn(JSON.stringify(shown)), placed: false };
    await user.patch({ set: { turnNotes: [...(user.turnNotes ?? []), n] } });
  } catch { /* stricter, never looser */ }
}
