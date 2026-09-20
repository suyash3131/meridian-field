import { User } from 'lua-cli';

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

  const bound = (user as any).repId as string | undefined;
  if (bound) return { id: bound, name: ((user as any).repName as string) ?? bound };

  const phone = user._luaProfile?.mobileNumbers?.[0];
  const found = await post<{ id?: string; name?: string; region?: string; verifiedBy?: string; error?: string }>(
    '/api/agent/whoami', { phone, claimedRepId }
  );
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

/** ₹ for display only. Every number crossing this boundary is integer paise. */
export const rs = (paise: number | null | undefined): string =>
  '₹' + (Number(paise ?? 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
