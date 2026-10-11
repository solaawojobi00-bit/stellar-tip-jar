/**
 * Rules for a jar's suggested amounts, shared by everything that edits them.
 *
 * `parseSuggestedAmounts` in lib/sep7.ts answers "what does this query param
 * mean" and drops anything it dislikes without saying why. A settings UI needs
 * the other half: which single value is wrong, and what to tell the creator
 * about it. Both halves must agree, so the predicate lives here once and the
 * parser stays the only reader of the wire format.
 */

/**
 * How many suggested amounts a jar may carry. The tip page imposes no limit,
 * but past a handful the chips stop being a shortcut and start being a menu,
 * so every editor declines to generate more.
 */
export const MAX_SUGGESTED_AMOUNTS = 5;

/**
 * What a jar suggests when its link says nothing, from the design handoff.
 * `parseSuggestedAmounts` intentionally returns [] for an absent param — the
 * default belongs to the product, not to the parser.
 */
export const DEFAULT_SUGGESTED_AMOUNTS = ['5', '25', '100'];

/**
 * Why a single typed amount is unusable, or null when it is fine. An empty
 * field is not an error: it is a row nobody has filled in yet, and shouting at
 * someone for a box they just added would be wrong.
 *
 * Accepts exactly what `parseSuggestedAmounts` accepts, so nothing the UI
 * reports as valid is silently dropped by the page that renders it.
 */
export function amountError(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return null;
  if (!/^\d+(\.\d+)?$/.test(value)) return 'Numbers only — for example 25 or 2.5.';
  if (!/^\d+(\.\d{1,7})?$/.test(value)) return 'Stellar amounts carry at most 7 decimal places.';
  if (Number(value) <= 0) return 'Must be more than zero.';
  return null;
}

/**
 * The rows of a settings form reduced to the list a tip link carries: blank
 * and invalid rows dropped, duplicates collapsed, capped at the maximum.
 *
 * Duplicates are collapsed numerically, so "5" and "5.0" are one chip rather
 * than two identical buttons — the tip page keys its chips by their amount, so
 * a repeat would be both useless to a visitor and a duplicate React key.
 */
export function normaliseAmounts(rows: readonly string[]): string[] {
  const kept: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const value = row.trim();
    if (value === '' || amountError(value) !== null) continue;

    const key = String(Number(value));
    if (seen.has(key)) continue;

    seen.add(key);
    kept.push(value);
    if (kept.length === MAX_SUGGESTED_AMOUNTS) break;
  }

  return kept;
}
