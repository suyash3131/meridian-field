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
  const placed = path.startsWith('/api/agent/confirm') && !body?.error;
  await addNote({ rupees: rupeesOf(body), placed });
}

/** For a tool that formats a CRM amount itself from a field not named *Paise
 *  (the pulse's approvals carry "value"): note the ₹ it is about to show. */
export async function noteShown(shown: unknown): Promise<void> {
  await addNote({ rupees: rupeesIn(JSON.stringify(shown)), placed: false });
}

/**
 * Add one note to the list. The model often calls two tools at once (a
 * chemist's "can you deliver by 11? and what do we owe?" is two), and two
 * read-add-write rounds at the same instant keep only one of them: the check
 * then called the other tool's real ₹ figures invented. So after writing, read
 * back and, if this note was lost to the other write, add it again.
 */
async function addNote(n: TurnNote): Promise<void> {
  const tag = Math.random().toString(36).slice(2);
  const mine = { ...n, tag };
  try {
    for (let i = 0; i < 4; i++) {
      const user: any = await User.get();
      if (!user) return;
      const notes: any[] = user.turnNotes ?? [];
      if (notes.some((x) => x?.tag === tag)) return;
      await user.patch({ set: { turnNotes: [...notes, mine] } });
      await new Promise((r) => setTimeout(r, 60 + Math.random() * 120));
    }
  } catch { /* a missing note makes the check stricter, never looser */ }
}
