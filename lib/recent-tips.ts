/**
 * The sanitized, public view of recent payments into a tip jar.
 *
 * A Horizon payment record carries far more than a tip feed should ever show:
 * the full sender address, the transaction hash, the raw memo bytes, the fee
 * account, the envelope XDR. This module is the single place that decides what
 * leaves the server, so the browser is never handed a raw Horizon record to
 * begin with — a feed that renders only a projection cannot leak a field
 * someone forgot to hide in the markup.
 *
 * Two rules come straight from the PRD's memo-privacy risk:
 *
 *   - Only MEMO_TEXT is shown. MEMO_ID, MEMO_HASH and MEMO_RETURN are routing
 *     and binary values; rendering them is meaningless to a reader at best and
 *     a decoded byte dump at worst.
 *   - The sender is truncated before serialisation, not at render time.
 *
 * Kept out of the route handler so it can be tested against recorded Horizon
 * fixtures without standing up a server or touching the network.
 */

import { isMatchingPayment, type HorizonPaymentRecord } from './horizon';
import type { Asset } from './sep7';
import { truncateAddress } from './strkey';

/** Tips returned when the caller does not ask for a specific count. */
export const DEFAULT_FEED_LIMIT = 5;

/**
 * Ceiling on `limit`. A feed is a glance at the last few tips, not a history
 * export (that is PRD P3), and every extra entry is another Horizon page the
 * route may have to walk to fill.
 */
export const MAX_FEED_LIMIT = 25;

/**
 * Display cap for a memo. Stellar's MEMO_TEXT is 28 bytes, so a well-formed
 * memo is already under this — the cap is what stops a multi-byte or otherwise
 * surprising value from stretching a row.
 */
export const MEMO_MAX_LENGTH = 28;

/**
 * Code-point ranges stripped from a memo before display.
 *
 * A memo is attacker-supplied text from a stranger's wallet. React escapes
 * markup, so this is not about script injection — it is about characters that
 * change how the text around them renders: a newline breaks a memo out of its
 * row, and a right-to-left override silently reorders the rest of the line.
 *
 * Written as ranges rather than a regex literal so each one can say what it
 * covers; a character class of invisible characters is unreviewable by eye.
 */
const UNSAFE_MEMO_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f], // C0 controls — newline and tab among them
  [0x007f, 0x009f], // DEL and the C1 controls
  [0x00ad, 0x00ad], // soft hyphen
  [0x200b, 0x200f], // zero-width space/joiners, LTR and RTL marks
  [0x2028, 0x202e], // line/paragraph separators, bidi embeddings and overrides
  [0x2060, 0x206f], // word joiner, invisible operators, deprecated format chars
  [0xfeff, 0xfeff], // zero-width no-break space (BOM)
  [0xfff9, 0xfffb], // interlinear annotation marks
];

function isUnsafeMemoChar(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return UNSAFE_MEMO_RANGES.some(([low, high]) => code >= low && code <= high);
}

/** The transaction Horizon embeds when a payments query uses `join=transactions`. */
export interface JoinedTransaction {
  memo?: string;
  memo_type?: string;
}

export interface JoinedPaymentRecord extends HorizonPaymentRecord {
  transaction?: JoinedTransaction;
}

export interface JoinedPaymentsPage {
  _links?: { next?: { href: string } };
  _embedded: { records: JoinedPaymentRecord[] };
}

/** One row of the feed. Every field here is safe to serialise to a visitor. */
export interface TipEntry {
  /** Sender, already truncated — the full address never leaves the server. */
  from: string;
  /** Horizon's 7-decimal amount string, unchanged. */
  amount: string;
  /** ISO-8601 UTC, straight from the payment's `created_at`. */
  at: string;
  /** Sanitized MEMO_TEXT, or null for every other memo type and for none. */
  memo: string | null;
}

/**
 * Clean a MEMO_TEXT value for display, or null if nothing printable is left.
 *
 * Exported separately from `sanitizeMemo` so the text handling can be tested
 * directly against hostile input — the memo values a real ledger happens to
 * contain are not the ones worth worrying about.
 */
export function sanitizeMemoText(raw: string): string | null {
  // Unsafe characters become spaces rather than vanishing, so a zero-width
  // space between two words leaves two words, not one fused token.
  const collapsed = Array.from(raw)
    .map((character) => (isUnsafeMemoChar(character) ? ' ' : character))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  // Real ledger data contains empty text memos; they are not a message.
  if (collapsed === '') return null;

  if (collapsed.length <= MEMO_MAX_LENGTH) return collapsed;
  return `${collapsed.slice(0, MEMO_MAX_LENGTH - 1)}…`;
}

/**
 * The memo to show for a payment: MEMO_TEXT only, sanitized. Anything else —
 * no memo, an ID memo, a hash or return memo, a missing join — is null.
 */
export function sanitizeMemo(transaction: JoinedTransaction | undefined): string | null {
  if (transaction?.memo_type !== 'text') return null;
  if (typeof transaction.memo !== 'string') return null;
  return sanitizeMemoText(transaction.memo);
}

/**
 * Project one Horizon record into a feed entry, or null if it is not a tip
 * into this jar in this asset.
 *
 * Reuses `isMatchingPayment` so the feed and the running total can never
 * disagree about what counts as a tip — including the rule that a credit asset
 * is never conflated with native, or with the same code from another issuer.
 */
export function toTipEntry(
  record: JoinedPaymentRecord,
  dest: string,
  asset: Asset,
): TipEntry | null {
  if (!isMatchingPayment(record, dest, asset)) return null;
  if (!record.amount || !record.from || !record.created_at) return null;

  return {
    from: truncateAddress(record.from),
    amount: record.amount,
    at: record.created_at,
    memo: sanitizeMemo(record.transaction),
  };
}

/**
 * The most recent `limit` tips, in the order Horizon returned them.
 *
 * Callers query Horizon with `order=desc`, so "the first `limit` matches" is
 * already "the most recent `limit`"; this does not re-sort, which leaves ties
 * in the ledger's own order rather than an arbitrary one.
 */
export function toRecentTips(
  records: JoinedPaymentRecord[],
  dest: string,
  asset: Asset,
  limit: number,
): TipEntry[] {
  const tips: TipEntry[] = [];

  for (const record of records) {
    if (tips.length >= limit) break;
    const entry = toTipEntry(record, dest, asset);
    if (entry) tips.push(entry);
  }

  return tips;
}

/**
 * Parse the `limit` query param: the default when absent, a number inside
 * [1, MAX_FEED_LIMIT], or null for anything else.
 *
 * Rejects rather than clamps. A caller asking for 500 tips has a different
 * idea of what this endpoint is than the endpoint does, and quietly handing
 * back 25 would hide that.
 */
export function parseFeedLimit(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return DEFAULT_FEED_LIMIT;
  if (!/^\d+$/.test(raw)) return null;

  const limit = Number(raw);
  if (limit < 1 || limit > MAX_FEED_LIMIT) return null;
  return limit;
}
