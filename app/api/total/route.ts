/**
 * Running-total proxy. Given `dest` and `asset`, walks Horizon's payments
 * endpoint, sums matching payments, and returns a cached JSON total.
 *
 * This is the only server-side logic in Phase 1 and holds no state beyond the
 * response cache TTL.
 *
 * Runs on the default Node.js runtime: Next.js 16 deprecates
 * `export const runtime = 'edge'` for route handlers (Edge is now only for
 * Proxy). See ARCHITECTURE.md.
 */

import {
  DEFAULT_HORIZON_URL,
  HORIZON_PAGE_LIMIT,
  PAGINATION_BUDGET_MS,
  fromStroops,
  sumPayments,
  type HorizonPaymentsPage,
  type HorizonPaymentRecord,
} from '@/lib/horizon';
import { parseAsset } from '@/lib/sep7';
import { isValidDestination } from '@/lib/strkey';

/** Short TTL: fresh enough to feel live, long enough to shield Horizon. */
const CACHE_TTL_SECONDS = 30;
const STALE_WHILE_REVALIDATE_SECONDS = 120;

const CACHE_CONTROL = `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

interface TotalBody {
  dest: string;
  asset: string;
  total: string;
  count: number;
  /** False when Horizon has no such account yet. */
  funded: boolean;
  truncated: boolean;
}

function jsonTotal(body: TotalBody): Response {
  return Response.json(body, { headers: { 'Cache-Control': CACHE_CONTROL } });
}

/**
 * Zero in the same 7-decimal form as every other total. Derived from
 * fromStroops rather than written out, so it cannot drift from the format
 * sumPayments produces — callers can parse `total` one way, always.
 */
const ZERO_TOTAL = fromStroops(0n);

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);

  const dest = searchParams.get('dest');
  if (!dest || !isValidDestination(dest)) {
    return jsonError('Invalid or missing destination address.', 400);
  }

  const asset = parseAsset(searchParams.get('asset'));
  if (asset === null) {
    return jsonError('Invalid asset. Use "native" or "CODE:ISSUER".', 400);
  }

  const horizonUrl = process.env.HORIZON_URL ?? DEFAULT_HORIZON_URL;
  const assetLabel = asset.kind === 'native' ? 'native' : `${asset.code}:${asset.issuer}`;

  const records: HorizonPaymentRecord[] = [];
  let next: string | null =
    `${horizonUrl}/accounts/${dest}/payments?limit=${HORIZON_PAGE_LIMIT}&order=desc`;

  /**
   * True once we stopped early and Horizon still had more to give — so the
   * total below is a floor, not the whole history. Tracked rather than
   * inferred from the record count: only the loop knows whether it ran out of
   * budget or out of history.
   */
  let truncated = false;
  const deadline = Date.now() + PAGINATION_BUDGET_MS;

  try {
    // Walk until the history ends or the budget does. Checking before each
    // request (never mid-flight) means we always return a real, if partial,
    // answer instead of letting the function time out into a 502.
    while (next) {
      if (Date.now() >= deadline) {
        truncated = true;
        break;
      }

      const response: Response = await fetch(next, {
        headers: { Accept: 'application/json' },
      });

      // An address with no account yet is the normal state of a tip jar that
      // has never been used. Report a zero total rather than an error, so a
      // freshly shared page renders instead of breaking.
      if (response.status === 404) {
        return jsonTotal({
          dest,
          asset: assetLabel,
          total: ZERO_TOTAL,
          count: 0,
          funded: false,
          truncated: false,
        });
      }

      if (!response.ok) {
        return jsonError('Horizon request failed.', 502);
      }

      const body = (await response.json()) as HorizonPaymentsPage;
      records.push(...body._embedded.records);

      const nextHref = body._links?.next?.href;
      next = nextHref && body._embedded.records.length > 0 ? nextHref : null;
    }
  } catch {
    return jsonError('Horizon request failed.', 502);
  }

  const { total, count } = sumPayments(records, dest, asset);

  return jsonTotal({
    dest,
    asset: assetLabel,
    total,
    count,
    // Horizon answered, so the account exists — even if nothing matched.
    funded: true,
    truncated,
  });
}
