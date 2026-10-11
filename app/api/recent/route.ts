/**
 * Recent-tips proxy. Given `dest`, `asset` and an optional `limit`, walks
 * Horizon's payments endpoint newest-first and returns a cached, sanitized
 * list of the last few tips.
 *
 * The sanitizing itself lives in lib/recent-tips — this handler's job is the
 * HTTP shape, the Horizon walk, and the guarantee that nothing but a
 * `TipEntry[]` is ever serialised. Raw Horizon records never reach the
 * response body, so the full sender address, the transaction hash and the raw
 * memo bytes stay on the server (PRD "Risks" — memo privacy).
 *
 * Runs on the default Node.js runtime, like /api/total. See ARCHITECTURE.md.
 */

import {
  DEFAULT_HORIZON_URL,
  HORIZON_PAGE_LIMIT,
  PAGINATION_BUDGET_MS,
} from '@/lib/horizon';
import {
  MAX_FEED_LIMIT,
  parseFeedLimit,
  toRecentTips,
  type JoinedPaymentsPage,
  type TipEntry,
} from '@/lib/recent-tips';
import { parseAsset } from '@/lib/sep7';
import { isValidDestination } from '@/lib/strkey';

/** Matches /api/total: fresh enough to feel live, long enough to shield Horizon. */
const CACHE_TTL_SECONDS = 30;
const STALE_WHILE_REVALIDATE_SECONDS = 120;

const CACHE_CONTROL = `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

interface RecentBody {
  dest: string;
  asset: string;
  limit: number;
  tips: TipEntry[];
  /** False when Horizon has no such account yet. */
  funded: boolean;
}

function jsonRecent(body: RecentBody): Response {
  return Response.json(body, { headers: { 'Cache-Control': CACHE_CONTROL } });
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

  const limit = parseFeedLimit(searchParams.get('limit'));
  if (limit === null) {
    return jsonError(`Invalid limit. Use a whole number from 1 to ${MAX_FEED_LIMIT}.`, 400);
  }

  const horizonUrl = process.env.HORIZON_URL ?? DEFAULT_HORIZON_URL;
  const assetLabel = asset.kind === 'native' ? 'native' : `${asset.code}:${asset.issuer}`;

  // `join=transactions` embeds each payment's transaction, which is where the
  // memo lives — without it a second round trip per tip would be needed just
  // to learn that most memos are not MEMO_TEXT and will not be shown.
  let next: string | null =
    `${horizonUrl}/accounts/${dest}/payments?limit=${HORIZON_PAGE_LIMIT}&order=desc&join=transactions`;

  const tips: TipEntry[] = [];
  const deadline = Date.now() + PAGINATION_BUDGET_MS;

  try {
    // An account whose recent history is all in some other asset can need more
    // than one page to fill a feed of five. The same wall-clock budget that
    // bounds /api/total bounds the walk here, so a busy jar returns a short
    // feed rather than timing out into a 502.
    while (next && tips.length < limit) {
      if (Date.now() >= deadline) break;

      const response: Response = await fetch(next, {
        headers: { Accept: 'application/json' },
      });

      // A jar nobody has tipped yet has no account on the network. That is the
      // normal starting state, not an error — report an empty feed.
      if (response.status === 404) {
        return jsonRecent({ dest, asset: assetLabel, limit, tips: [], funded: false });
      }

      if (!response.ok) {
        return jsonError('Horizon request failed.', 502);
      }

      const body = (await response.json()) as JoinedPaymentsPage;
      tips.push(...toRecentTips(body._embedded.records, dest, asset, limit - tips.length));

      const nextHref = body._links?.next?.href;
      next = nextHref && body._embedded.records.length > 0 ? nextHref : null;
    }
  } catch {
    return jsonError('Horizon request failed.', 502);
  }

  return jsonRecent({
    dest,
    asset: assetLabel,
    limit,
    tips,
    // Horizon answered, so the account exists — even if nothing matched.
    funded: true,
  });
}
