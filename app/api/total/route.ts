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
  MAX_PAGES,
  sumPayments,
  type HorizonPaymentsPage,
  type HorizonPaymentRecord,
} from '@/lib/horizon';
import { parseAsset } from '@/lib/sep7';
import { isValidDestination } from '@/lib/strkey';

/** Short TTL: fresh enough to feel live, long enough to shield Horizon. */
const CACHE_TTL_SECONDS = 30;
const STALE_WHILE_REVALIDATE_SECONDS = 120;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

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

  const records: HorizonPaymentRecord[] = [];
  let next: string | null =
    `${horizonUrl}/accounts/${dest}/payments?limit=${HORIZON_PAGE_LIMIT}&order=desc`;

  try {
    // Lookback is capped at MAX_PAGES: an unbounded history walk is the main
    // Horizon rate-limit risk called out in the PRD.
    for (let page = 0; page < MAX_PAGES && next; page++) {
      const response: Response = await fetch(next, {
        headers: { Accept: 'application/json' },
      });

      if (response.status === 404) {
        return jsonError('Account not found or not yet funded.', 404);
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

  return Response.json(
    {
      dest,
      asset: asset.kind === 'native' ? 'native' : `${asset.code}:${asset.issuer}`,
      total,
      count,
      truncated: records.length >= HORIZON_PAGE_LIMIT * MAX_PAGES,
    },
    {
      headers: {
        'Cache-Control': `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`,
      },
    },
  );
}
