/**
 * Horizon payment-record handling for the running total.
 *
 * Kept out of the route handler so it can be tested against recorded Horizon
 * fixtures without standing up a server or touching the network.
 */

import type { Asset } from './sep7';

export const DEFAULT_HORIZON_URL = 'https://horizon.stellar.org';

/** Horizon page size cap. */
export const HORIZON_PAGE_LIMIT = 200;

/**
 * How long the route may spend walking Horizon before it stops and returns
 * what it has.
 *
 * This replaces a fixed page cap, which bounded the *number* of requests but
 * not the *time* they take: a busy account's per-page latency alone could
 * outrun the serverless function timeout, so the request 502'd instead of
 * returning a partial total. A wall-clock budget bounds the thing that
 * actually runs out. Sized to leave headroom under the platform timeout for
 * the in-flight page plus summing and serialising the response.
 */
export const PAGINATION_BUDGET_MS = 8_000;

/**
 * The subset of a Horizon payment record we rely on. Horizon returns more
 * fields; typing only what we read keeps fixtures honest about what matters.
 */
export interface HorizonPaymentRecord {
  id: string;
  type: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  from?: string;
  to?: string;
  amount?: string;
  starting_balance?: string;
  account?: string;
  created_at?: string;
}

export interface HorizonPaymentsPage {
  _links?: { next?: { href: string } };
  _embedded: { records: HorizonPaymentRecord[] };
}

/** True if a record is a payment *to* `dest` in `asset`. */
export function isMatchingPayment(
  record: HorizonPaymentRecord,
  dest: string,
  asset: Asset,
): boolean {
  // `create_account` funds an account rather than paying it, and
  // `path_payment_strict_*` credit the destination in the *destination* asset.
  if (record.type !== 'payment' && !record.type.startsWith('path_payment')) {
    return false;
  }

  if (record.to !== dest) return false;

  if (asset.kind === 'native') {
    return record.asset_type === 'native';
  }

  // Never conflate a credit asset with native, or with the same code from a
  // different issuer — both must match. See PRD "Risks".
  return (
    record.asset_type !== 'native' &&
    record.asset_code === asset.code &&
    record.asset_issuer === asset.issuer
  );
}

/**
 * Sum matching payment amounts.
 *
 * Amounts are summed in integer stroops (1 XLM = 10^7 stroops) to avoid float
 * drift across many records, then rendered back to a 7-decimal string.
 */
export function sumPayments(
  records: HorizonPaymentRecord[],
  dest: string,
  asset: Asset,
): { total: string; count: number } {
  let stroops = 0n;
  let count = 0;

  for (const record of records) {
    if (!isMatchingPayment(record, dest, asset)) continue;
    if (!record.amount) continue;

    stroops += toStroops(record.amount);
    count += 1;
  }

  return { total: fromStroops(stroops), count };
}

/** Parse a Horizon decimal amount string into stroops. */
export function toStroops(amount: string): bigint {
  const [whole, fraction = ''] = amount.split('.');
  const padded = (fraction + '0000000').slice(0, 7);
  return BigInt(whole) * 10_000_000n + BigInt(padded || '0');
}

/** Render stroops back to Horizon's 7-decimal string form. */
export function fromStroops(stroops: bigint): string {
  const whole = stroops / 10_000_000n;
  const fraction = (stroops % 10_000_000n).toString().padStart(7, '0');
  return `${whole}.${fraction}`;
}
