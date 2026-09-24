import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Links that open without a login but cannot be guessed.
 *
 * An invoice has to be fetchable by Lua (to attach it to an email) and by a
 * chemist's WhatsApp, neither of which can log in. So the link carries a
 * signature of what it points at: change the order id and the signature no
 * longer matches. The key never leaves the server.
 */
const key = () => process.env.LINK_SECRET || process.env.DATABASE_URL || 'dev-only';

export function sign(value: string): string {
  return createHmac('sha256', key()).update(value).digest('base64url').slice(0, 22);
}

export function verify(value: string, token: string | null): boolean {
  if (!token) return false;
  const a = Buffer.from(sign(value)), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const BASE = process.env.PUBLIC_BASE_URL || 'https://meridian-sigma-gules.vercel.app';

/** The public, signed invoice link for an order. */
export function invoiceUrl(orderId: string): string {
  return `${BASE}/api/invoice?orderId=${encodeURIComponent(orderId)}&t=${sign('invoice:' + orderId)}`;
}
