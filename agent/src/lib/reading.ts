/**
 * Check the model's reading of an order against the rep's own words.
 *
 * The model splits "apollo pharmacy kb 2 baby lotion 15" into a shop, products
 * and quantities. It once read that as shop "apollo pharmacy kb 2", 15 baby
 * lotions and no terms. Lua does not hand tools the raw message, so the tool
 * asks the model to copy it verbatim, and this puts the numbers back where the
 * rep put them:
 *
 *   - a number right before a product (optionally "box", "strip", …) is its qty
 *   - that number is never part of the shop name
 *   - "15 days" / "15 din", or a bare number after the last product, is terms
 *
 * Anything it cannot find in the message is left as the model read it. The
 * read-back and "Confirm?" still stand between this and an order.
 */
export type Item = { product: string; qty: number };

const UNIT = '(?:x|box(?:es)?|strips?|bottles?|pcs?|pieces?|packs?|packets?|nos?|units?|tubes?|cartons?)';
const norm = (s: string) => s.toLowerCase().replace(/[,;:+&]/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Longest credit term anyone offers. A bigger trailing number is not terms. */
const MAX_TERMS_DAYS = 90;

export function reconcile(
  message: string | undefined,
  shop: string,
  items: Item[],
  creditDays?: number,
): { shop: string; items: Item[]; creditDays?: number; changed: string[] } {
  const changed: string[] = [];
  if (!message?.trim()) return { shop, items, creditDays, changed };
  const m = norm(message);

  // Quantities: the number the rep wrote in front of each product.
  const qtyInFront: boolean[] = [];
  const fixed = items.map((it, i) => {
    const p = norm(it.product);
    const at = p ? m.search(new RegExp(`(?:^|\\s)${esc(p)}(?=\\s|$)`)) : -1;
    const before = at < 0 ? null
      : m.slice(0, at).match(new RegExp(`(?:^|\\s)(\\d+)(?:\\s+${UNIT})?\\s*$`));
    qtyInFront[i] = !!before;
    if (!before || Number(before[1]) <= 0) return it;
    const qty = Number(before[1]);
    if (qty !== it.qty) changed.push(`${it.product}: ${it.qty} → ${qty}`);
    return { ...it, qty };
  });

  // The shop: drop a trailing number that is really the first quantity.
  let s = shop.trim();
  const tail = s.match(/\s(\d+)$/);
  if (tail && fixed.some((it) =>
      new RegExp(`(?:^|\\s)${tail[1]}(?:\\s+${UNIT})?\\s+${esc(norm(it.product))}(?=\\s|$)`).test(m))) {
    s = s.slice(0, -tail[0].length).trim();
    changed.push(`shop: "${shop}" → "${s}"`);
  }

  // Terms: said in days, or a bare number left at the very end.
  let days = creditDays;
  if (days === undefined) {
    const said = m.match(/(\d+)\s*(?:days?|din|dino)\b/);
    const last = fixed.length ? norm(fixed[fixed.length - 1].product) : '';
    // Only when the last product's qty sat in front of it: in "650 2" the 2 is the qty.
    const trailing = last && qtyInFront[fixed.length - 1] ? m.match(new RegExp(`${esc(last)}\\s+(\\d+)$`)) : null;
    const n = said ? Number(said[1]) : trailing ? Number(trailing[1]) : undefined;
    if (n && n <= MAX_TERMS_DAYS) { days = n; changed.push(`terms: ${n} days`); }
  }

  return { shop: s, items: fixed, creditDays: days, changed };
}
