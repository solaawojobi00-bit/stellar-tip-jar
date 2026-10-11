import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HORIZON_PAGE_LIMIT, PAGINATION_BUDGET_MS } from '@/lib/horizon';
import joinedPage from '@/lib/__tests__/fixtures/horizon-payments-joined.json';
import { DEFAULT_FEED_LIMIT, MAX_FEED_LIMIT } from '@/lib/recent-tips';

import { GET } from '../route';

/**
 * HTTP-level tests for the recent-tips handler: status codes, body shape,
 * cache headers, and the privacy guarantee that no raw Horizon field reaches
 * the response. The sanitizing rules themselves are covered in
 * lib/__tests__/recent-tips.
 *
 * Horizon is served entirely from recorded responses — the fixture page is
 * real `/accounts/{id}/payments?join=transactions` output and the error bodies
 * are verbatim Horizon error payloads. `fetch` is replaced for the duration of
 * each test, so the suite makes no network calls.
 */

const DEST = 'GBP32F37ZHXGSLOE4WAFCLNWQUMY4OUIAUGNBZUF4OD2BG6MS7WKRTSX';
const VELO_ISSUER = 'GDM4RQUQQUVSKQA7S6EM7XBZP3FCGH4Q7CL6TABQ7B2BEJ5ERARM2M5M';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
/** Valid strkey with no account on the network. */
const UNFUNDED_DEST = 'GAAACAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4DUPB7JZX';

const EXPECTED_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=120';

/** Recorded from GET /accounts/{unfunded}/payments. */
const HORIZON_404 = {
  type: 'https://stellar.org/horizon-errors/not_found',
  title: 'Resource Missing',
  status: 404,
  detail:
    'The resource at the url requested was not found.  This usually occurs for one of two reasons:  The url requested is not valid, or no data in our database could be found with the parameters provided.',
};

/** Recorded from Horizon while rate limited. */
const HORIZON_503 = {
  type: 'https://stellar.org/horizon-errors/service_unavailable',
  title: 'Service Unavailable',
  status: 503,
  detail: 'The request cannot be serviced at this time.',
};

/** Recorded from a funded account paged past the end of its history. */
const EMPTY_PAGE = {
  _links: {
    self: { href: 'https://horizon.stellar.org/accounts/x/payments?cursor=999&limit=200' },
  },
  _embedded: { records: [] },
};

type Recorded = { status: number; body: unknown };

let requested: string[] = [];

/** Serve the given recorded responses in order; the last one repeats. */
function serve(...responses: Recorded[]) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    requested.push(typeof input === 'string' ? input : input.toString());
    const recorded = responses[Math.min(requested.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(recorded.body), {
      status: recorded.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function ok(body: unknown): Recorded {
  return { status: 200, body };
}

const CLOCK_ORIGIN = 1_700_000_000_000;

/** As `serve`, but each Horizon call charges `perPageMs` to a clock the test drives. */
function serveWithLatency(perPageMs: number, ...responses: Recorded[]) {
  let now = CLOCK_ORIGIN;
  vi.spyOn(Date, 'now').mockImplementation(() => now);

  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    requested.push(typeof input === 'string' ? input : input.toString());
    const recorded = responses[Math.min(requested.length - 1, responses.length - 1)];
    now += perPageMs;
    return new Response(JSON.stringify(recorded.body), {
      status: recorded.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return { elapsed: () => now - CLOCK_ORIGIN };
}

/**
 * A page of payments in an asset this jar is not asking about, which always
 * links onward. Nothing here fills the feed, so only the route ends the walk.
 */
function endlessUnmatchedPage(): Recorded {
  return ok({
    _links: { next: { href: 'https://horizon.stellar.org/next-page' } },
    _embedded: {
      records: joinedPage._embedded.records.filter((record) => record.asset_type !== 'native'),
    },
  });
}

function call(query: string): Promise<Response> {
  return GET(new Request(`https://tip.example/api/recent${query}`));
}

beforeEach(() => {
  requested = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/recent — a funded jar with tips', () => {
  it('returns sanitized entries from a recorded Horizon page', async () => {
    serve(ok(joinedPage), ok(EMPTY_PAGE));

    const response = await call(`?dest=${DEST}`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.dest).toBe(DEST);
    expect(body.asset).toBe('native');
    expect(body.funded).toBe(true);
    expect(body.limit).toBe(DEFAULT_FEED_LIMIT);
    expect(body.tips).toHaveLength(DEFAULT_FEED_LIMIT);
  });

  it('returns the newest tip first', async () => {
    serve(ok(joinedPage), ok(EMPTY_PAGE));

    const body = await (await call(`?dest=${DEST}`)).json();
    expect(body.tips[0]).toEqual({
      from: 'GDFPCR2J…BY6S54W2',
      amount: '16338.4079900',
      at: '2026-10-11T15:06:52Z',
      memo: '2943227849',
    });
  });

  it('queries Horizon for the account, newest first, with the transaction joined', async () => {
    serve(ok(joinedPage), ok(EMPTY_PAGE));
    await call(`?dest=${DEST}`);

    expect(requested[0]).toContain(`/accounts/${DEST}/payments`);
    expect(requested[0]).toContain(`limit=${HORIZON_PAGE_LIMIT}`);
    expect(requested[0]).toContain('order=desc');
    // Without the join there is no memo on a payment record at all.
    expect(requested[0]).toContain('join=transactions');
  });

  it('keeps a credit asset out of the native feed', async () => {
    serve(ok(joinedPage), ok(EMPTY_PAGE));

    const body = await (await call(`?dest=${DEST}`)).json();
    expect(body.tips.map((tip: { amount: string }) => tip.amount)).not.toContain('304025.4060000');
  });

  it('returns the credit feed, keyed by code and issuer', async () => {
    serve(ok(joinedPage), ok(EMPTY_PAGE));

    const body = await (await call(`?dest=${DEST}&asset=VELO:${VELO_ISSUER}`)).json();
    expect(body.asset).toBe(`VELO:${VELO_ISSUER}`);
    expect(body.tips).toHaveLength(2);
    expect(body.tips[0].amount).toBe('304025.4060000');
  });

  it('returns an empty feed for the same code from a different issuer', async () => {
    serve(ok(joinedPage), ok(EMPTY_PAGE));

    const body = await (await call(`?dest=${DEST}&asset=VELO:${USDC_ISSUER}`)).json();
    expect(body.tips).toEqual([]);
    expect(body.funded).toBe(true);
  });
});

describe('GET /api/recent — privacy of the response body', () => {
  /** Every raw Horizon field the handler must not pass on. */
  const FORBIDDEN_FIELDS = [
    'transaction_hash',
    'memo_bytes',
    'memo_type',
    'source_account',
    'paging_token',
    'type_i',
    '_links',
    'transaction_successful',
  ];

  it.each(FORBIDDEN_FIELDS)('does not include %s anywhere in the body', async (field) => {
    serve(ok(joinedPage), ok(EMPTY_PAGE));

    const raw = await (await call(`?dest=${DEST}`)).text();
    expect(raw).not.toContain(field);
  });

  it('does not include any full sender address', async () => {
    serve(ok(joinedPage), ok(EMPTY_PAGE));

    const raw = await (await call(`?dest=${DEST}`)).text();
    for (const record of joinedPage._embedded.records) {
      expect(raw).not.toContain(record.from);
    }
  });

  it('gives every tip exactly the four display fields', async () => {
    serve(ok(joinedPage), ok(EMPTY_PAGE));

    const body = await (await call(`?dest=${DEST}`)).json();
    for (const tip of body.tips) {
      expect(Object.keys(tip).sort()).toEqual(['amount', 'at', 'from', 'memo']);
    }
  });

  it('shows a text memo but never a hash or ID memo', async () => {
    // A single page carrying one of each memo type, as Horizon returns them.
    const mixed = {
      _embedded: {
        records: [
          {
            id: '1',
            type: 'payment',
            asset_type: 'native',
            to: DEST,
            from: 'GDFPCR2JQBBVPA3REJMR6TEPDLICUE5JJHLN7M3QDVLUHE7WBY6S54W2',
            amount: '1.0000000',
            created_at: '2026-10-11T15:04:47Z',
            transaction: { memo_type: 'text', memo: 'thanks!' },
          },
          {
            id: '2',
            type: 'payment',
            asset_type: 'native',
            to: DEST,
            from: 'GAQZBH2OCP5H2GMD3F42TIQYM3AHALCDOXIIP24SDRS5JW4JPWVHJCXG',
            amount: '2.0000000',
            created_at: '2026-10-11T15:03:47Z',
            transaction: {
              memo_type: 'hash',
              memo: 'FQ4lWSHxjErUHy7kuPj4bha1h6jDqnZoaQVsCTlgKZE=',
            },
          },
          {
            id: '3',
            type: 'payment',
            asset_type: 'native',
            to: DEST,
            from: 'GAQZU7Y7GB3E4XOA3ZXEZDOTIEIWQRYOAIVJ6STY2YTUQAGZL3GYJCXG',
            amount: '3.0000000',
            created_at: '2026-10-11T15:02:47Z',
            transaction: { memo_type: 'id', memo: '1234567890' },
          },
        ],
      },
    };
    serve(ok(mixed));

    const response = await call(`?dest=${DEST}`);
    const raw = await response.clone().text();
    const body = await response.json();

    expect(body.tips.map((tip: { memo: string | null }) => tip.memo)).toEqual([
      'thanks!',
      null,
      null,
    ]);
    expect(raw).not.toContain('FQ4lWSHxjErUHy7kuPj4bha1h6jDqnZoaQVsCTlgKZE=');
    expect(raw).not.toContain('1234567890');
  });
});

describe('GET /api/recent — limit', () => {
  it('defaults to DEFAULT_FEED_LIMIT when no limit is given', async () => {
    serve(ok(joinedPage), ok(EMPTY_PAGE));

    const body = await (await call(`?dest=${DEST}`)).json();
    expect(body.limit).toBe(DEFAULT_FEED_LIMIT);
    expect(body.tips).toHaveLength(DEFAULT_FEED_LIMIT);
  });

  it('returns exactly the requested number of tips when enough exist', async () => {
    serve(ok(joinedPage), ok(EMPTY_PAGE));

    const body = await (await call(`?dest=${DEST}&limit=2`)).json();
    expect(body.limit).toBe(2);
    expect(body.tips).toHaveLength(2);
  });

  it('returns what exists when the jar has fewer tips than requested', async () => {
    serve(ok(joinedPage), ok(EMPTY_PAGE));

    // The recorded page holds six native payments; asking for ten is fine.
    const body = await (await call(`?dest=${DEST}&limit=10`)).json();
    expect(body.tips).toHaveLength(6);
  });

  it('stops walking Horizon once the feed is full', async () => {
    serve(ok(joinedPage), ok(EMPTY_PAGE));

    await call(`?dest=${DEST}&limit=2`);
    // Two tips are on the first page, so there is no reason to ask for more.
    expect(requested).toHaveLength(1);
  });

  it.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['above the cap', String(MAX_FEED_LIMIT + 1)],
    ['fractional', '2.5'],
    ['not a number', 'lots'],
  ])('returns 400 for a limit that is %s', async (_label, limit) => {
    const fetchMock = serve(ok(joinedPage));

    const response = await call(`?dest=${DEST}&limit=${limit}`);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: `Invalid limit. Use a whole number from 1 to ${MAX_FEED_LIMIT}.`,
    });
    // Rejected before any upstream call — bad input must not reach Horizon.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/recent — unfunded or nonexistent account', () => {
  it('returns 200 with an empty feed and funded: false, not an error', async () => {
    serve({ status: 404, body: HORIZON_404 });

    const response = await call(`?dest=${UNFUNDED_DEST}`);
    expect(response.status).toBe(200);

    await expect(response.json()).resolves.toEqual({
      dest: UNFUNDED_DEST,
      asset: 'native',
      limit: DEFAULT_FEED_LIMIT,
      tips: [],
      funded: false,
    });
  });

  it('still sends cache headers, so an empty jar is not re-queried per view', async () => {
    serve({ status: 404, body: HORIZON_404 });

    const response = await call(`?dest=${UNFUNDED_DEST}`);
    expect(response.headers.get('cache-control')).toBe(EXPECTED_CACHE_CONTROL);
  });
});

describe('GET /api/recent — funded account with no matching payments', () => {
  it('returns an empty feed and funded: true', async () => {
    serve(ok(EMPTY_PAGE));

    const response = await call(`?dest=${DEST}`);
    expect(response.status).toBe(200);

    await expect(response.json()).resolves.toEqual({
      dest: DEST,
      asset: 'native',
      limit: DEFAULT_FEED_LIMIT,
      tips: [],
      funded: true,
    });
  });
});

describe('GET /api/recent — invalid request', () => {
  it.each([
    ['missing dest', ''],
    ['empty dest', '?dest='],
    ['malformed dest', '?dest=not-a-key'],
    ['lowercase dest', `?dest=${DEST.toLowerCase()}`],
    ['secret seed as dest', '?dest=SADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP54X'],
    ['checksum failure', `?dest=${DEST.slice(0, -1)}A`],
  ])('returns 400 for %s', async (_label, query) => {
    const fetchMock = serve(ok(joinedPage));

    const response = await call(query);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid or missing destination address.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['issuer missing', 'VELO'],
    ['issuer malformed', 'VELO:nope'],
    ['code too long', `THIRTEENCHARS:${VELO_ISSUER}`],
  ])('returns 400 for an invalid asset (%s)', async (_label, asset) => {
    const fetchMock = serve(ok(joinedPage));

    const response = await call(`?dest=${DEST}&asset=${asset}`);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid asset. Use "native" or "CODE:ISSUER".',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not send cache headers on a 400', async () => {
    serve(ok(joinedPage));
    const response = await call('?dest=not-a-key');
    expect(response.headers.get('cache-control')).toBeNull();
  });
});

describe('GET /api/recent — upstream failure', () => {
  it('returns 502 when Horizon is unavailable (503)', async () => {
    serve({ status: 503, body: HORIZON_503 });

    const response = await call(`?dest=${DEST}`);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'Horizon request failed.' });
  });

  it.each([500, 502, 504, 429])('returns 502 when Horizon responds %i', async (status) => {
    serve({ status, body: { title: 'Error' } });
    expect((await call(`?dest=${DEST}`)).status).toBe(502);
  });

  it('returns 502 when the request throws instead of responding', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    const response = await call(`?dest=${DEST}`);
    expect(response.status).toBe(502);
  });

  it('does not leak upstream error detail to the caller', async () => {
    serve({ status: 503, body: HORIZON_503 });

    const body = await (await call(`?dest=${DEST}`)).json();
    expect(JSON.stringify(body)).not.toContain('horizon-errors');
  });

  it('does not send cache headers on a 502', async () => {
    serve({ status: 503, body: HORIZON_503 });
    const response = await call(`?dest=${DEST}`);
    expect(response.headers.get('cache-control')).toBeNull();
  });
});

describe('GET /api/recent — caching', () => {
  it('sets the same TTL as the running total', async () => {
    serve(ok(joinedPage), ok(EMPTY_PAGE));

    const response = await call(`?dest=${DEST}`);
    expect(response.headers.get('cache-control')).toBe(EXPECTED_CACHE_CONTROL);
  });
});

describe('GET /api/recent — pagination', () => {
  it('follows the next link when a page does not fill the feed', async () => {
    // Nothing on the first page matches, so the feed needs the second.
    serve(
      ok({
        _links: { next: { href: 'https://horizon.stellar.org/next-page' } },
        _embedded: {
          records: joinedPage._embedded.records.filter((r) => r.asset_type !== 'native'),
        },
      }),
      ok(joinedPage),
      ok(EMPTY_PAGE),
    );

    const body = await (await call(`?dest=${DEST}`)).json();
    expect(requested).toHaveLength(2);
    expect(requested[1]).toBe('https://horizon.stellar.org/next-page');
    expect(body.tips).toHaveLength(DEFAULT_FEED_LIMIT);
  });

  it('stops when a page comes back empty, even if it links to another', async () => {
    // Horizon's empty pages link to themselves; following that would not end.
    serve(
      ok({
        _links: { next: { href: 'https://horizon.stellar.org/same-page' } },
        _embedded: { records: [] },
      }),
    );

    await call(`?dest=${DEST}`);
    expect(requested).toHaveLength(1);
  });
});

describe('GET /api/recent — elapsed-time budget', () => {
  it('returns 200 with a short feed, not 502, when the budget runs out', async () => {
    serveWithLatency(3_000, endlessUnmatchedPage());

    const response = await call(`?dest=${DEST}`);

    // A jar whose recent history is all in another asset gets a truthful
    // empty feed instead of a function timeout.
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ tips: [], funded: true });
  });

  it('never spends more than the budget plus the page already in flight', async () => {
    const perPageMs = 1_500;
    const clock = serveWithLatency(perPageMs, endlessUnmatchedPage());

    await call(`?dest=${DEST}`);
    expect(clock.elapsed()).toBeLessThanOrEqual(PAGINATION_BUDGET_MS + perPageMs);
  });

  it('walks fewer pages when Horizon is slow than when it is fast', async () => {
    serveWithLatency(2_000, endlessUnmatchedPage());
    await call(`?dest=${DEST}`);
    const slowPages = requested.length;

    vi.restoreAllMocks();
    requested = [];

    serveWithLatency(200, endlessUnmatchedPage());
    await call(`?dest=${DEST}`);

    expect(requested.length).toBeGreaterThan(slowPages);
  });

  it('spends no budget at all once the feed is full', async () => {
    const clock = serveWithLatency(1_000, ok(joinedPage), ok(EMPTY_PAGE));

    await call(`?dest=${DEST}&limit=1`);
    // One page answered it; the budget is for jars that need more.
    expect(clock.elapsed()).toBe(1_000);
  });
});
