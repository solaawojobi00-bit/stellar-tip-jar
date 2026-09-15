import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import creditPage from '@/lib/__tests__/fixtures/horizon-payments-credit.json';
import nativePage from '@/lib/__tests__/fixtures/horizon-payments-native.json';
import { HORIZON_PAGE_LIMIT, PAGINATION_BUDGET_MS } from '@/lib/horizon';

import { GET } from '../route';

/**
 * HTTP-level tests for the route handler itself: status codes, body shape and
 * cache headers. The summing arithmetic is covered in lib/__tests__/horizon.
 *
 * Horizon is served entirely from recorded responses — the fixture pages are
 * real /accounts/{id}/payments output, and the error bodies below are verbatim
 * Horizon error payloads. `fetch` is replaced for the duration of each test, so
 * the suite makes no network calls.
 */

const NATIVE_DEST = 'GBP32F37ZHXGSLOE4WAFCLNWQUMY4OUIAUGNBZUF4OD2BG6MS7WKRTSX';
const CREDIT_DEST = 'GAHKUR6V6FEBAZ5SFZFBJP7QUZ7J2HNUQTF2P3JNK5WKHSCJTV43H7DS';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
/** Valid strkey with no account on the network. */
const UNFUNDED_DEST = 'GAAACAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4DUPB7JZX';

const EXPECTED_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=120';

/**
 * Zero on the wire. Written out rather than imported from the implementation,
 * so these tests pin the format callers actually parse: every `total` is
 * Horizon's 7-decimal string, whether it is zero or not.
 */
const ZERO_TOTAL = '0.0000000';

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
    self: { href: 'https://horizon.stellar.org/accounts/x/payments?cursor=999&limit=200&order=asc' },
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

/**
 * As `serve`, but each Horizon call also charges `perPageMs` to a clock the
 * test drives. Page *latency*, not page count, is what exhausts the route's
 * budget in production, so it is the thing worth simulating; wall-clock time
 * in the suite stays ~0.
 */
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

/** A busy account: every page reports another, so only the route ends the walk. */
function endlessPage(): Recorded {
  return ok({
    _links: { next: { href: 'https://horizon.stellar.org/next-page' } },
    _embedded: { records: nativePage._embedded.records },
  });
}

function call(query: string): Promise<Response> {
  return GET(new Request(`https://tip.example/api/total${query}`));
}

beforeEach(() => {
  requested = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/total — funded account with payments', () => {
  it('returns the summed native total from a recorded Horizon page', async () => {
    serve(ok(nativePage), ok(EMPTY_PAGE));

    const response = await call(`?dest=${NATIVE_DEST}`);
    expect(response.status).toBe(200);

    await expect(response.json()).resolves.toEqual({
      dest: NATIVE_DEST,
      asset: 'native',
      total: '23192.9749800',
      count: 8,
      funded: true,
      truncated: false,
    });
  });

  it('returns the summed credit total, keyed by code and issuer', async () => {
    serve(ok(creditPage), ok(EMPTY_PAGE));

    const response = await call(`?dest=${CREDIT_DEST}&asset=USDC:${USDC_ISSUER}`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.asset).toBe(`USDC:${USDC_ISSUER}`);
    expect(body.total).toBe('828.8100000');
    expect(body.count).toBe(8);
    expect(body.funded).toBe(true);
  });

  it('does not merge a credit asset into the native total', async () => {
    serve(ok(creditPage), ok(EMPTY_PAGE));

    const body = await (await call(`?dest=${CREDIT_DEST}&asset=native`)).json();
    expect(body.total).toBe(ZERO_TOTAL);
    expect(body.count).toBe(0);
    // The account exists; it simply has no XLM payments in the window.
    expect(body.funded).toBe(true);
  });

  it('queries Horizon for the requested account with a capped page size', async () => {
    serve(ok(nativePage), ok(EMPTY_PAGE));
    await call(`?dest=${NATIVE_DEST}`);

    expect(requested[0]).toContain(`/accounts/${NATIVE_DEST}/payments`);
    expect(requested[0]).toContain(`limit=${HORIZON_PAGE_LIMIT}`);
    expect(requested[0]).toContain('order=desc');
  });
});

describe('GET /api/total — funded account with no matching payments', () => {
  it('returns a zero total and funded: true', async () => {
    serve(ok(EMPTY_PAGE));

    const response = await call(`?dest=${NATIVE_DEST}`);
    expect(response.status).toBe(200);

    await expect(response.json()).resolves.toEqual({
      dest: NATIVE_DEST,
      asset: 'native',
      total: ZERO_TOTAL,
      count: 0,
      funded: true,
      truncated: false,
    });
  });
});

describe('GET /api/total — total format', () => {
  /** One shape for every total, so issue #1's page can parse it one way. */
  const SEVEN_DECIMALS = /^\d+\.\d{7}$/;

  it('uses the same 7-decimal form for a nonzero total', async () => {
    serve(ok(nativePage), ok(EMPTY_PAGE));
    const body = await (await call(`?dest=${NATIVE_DEST}`)).json();
    expect(body.total).toMatch(SEVEN_DECIMALS);
  });

  it('uses the same 7-decimal form for a funded account with no payments', async () => {
    serve(ok(EMPTY_PAGE));
    const body = await (await call(`?dest=${NATIVE_DEST}`)).json();
    expect(body.total).toMatch(SEVEN_DECIMALS);
  });

  it('uses the same 7-decimal form for an unfunded account', async () => {
    serve({ status: 404, body: HORIZON_404 });
    const body = await (await call(`?dest=${UNFUNDED_DEST}`)).json();
    expect(body.total).toMatch(SEVEN_DECIMALS);
  });
});

describe('GET /api/total — unfunded or nonexistent account', () => {
  it('returns 200 with a zero total and funded: false, not an error', async () => {
    serve({ status: 404, body: HORIZON_404 });

    const response = await call(`?dest=${UNFUNDED_DEST}`);
    expect(response.status).toBe(200);

    await expect(response.json()).resolves.toEqual({
      dest: UNFUNDED_DEST,
      asset: 'native',
      total: ZERO_TOTAL,
      count: 0,
      funded: false,
      truncated: false,
    });
  });

  it('still sends cache headers, so an empty jar is not re-queried per view', async () => {
    serve({ status: 404, body: HORIZON_404 });

    const response = await call(`?dest=${UNFUNDED_DEST}`);
    expect(response.headers.get('cache-control')).toBe(EXPECTED_CACHE_CONTROL);
  });

  it('reports the requested asset alongside the zero total', async () => {
    serve({ status: 404, body: HORIZON_404 });

    const body = await (await call(`?dest=${UNFUNDED_DEST}&asset=USDC:${USDC_ISSUER}`)).json();
    expect(body.asset).toBe(`USDC:${USDC_ISSUER}`);
    expect(body.funded).toBe(false);
  });
});

describe('GET /api/total — invalid request', () => {
  it.each([
    ['missing dest', ''],
    ['empty dest', '?dest='],
    ['malformed dest', '?dest=not-a-key'],
    ['lowercase dest', `?dest=${NATIVE_DEST.toLowerCase()}`],
    ['secret seed as dest', '?dest=SADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP54X'],
    ['checksum failure', `?dest=${NATIVE_DEST.slice(0, -1)}A`],
  ])('returns 400 for %s', async (_label, query) => {
    const fetchMock = serve(ok(nativePage));

    const response = await call(query);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid or missing destination address.',
    });
    // Rejected before any upstream call — bad input must not reach Horizon.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['issuer missing', 'USDC'],
    ['issuer malformed', 'USDC:nope'],
    ['code too long', `THIRTEENCHARS:${USDC_ISSUER}`],
  ])('returns 400 for an invalid asset (%s)', async (_label, asset) => {
    const fetchMock = serve(ok(nativePage));

    const response = await call(`?dest=${NATIVE_DEST}&asset=${asset}`);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid asset. Use "native" or "CODE:ISSUER".',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not send cache headers on a 400', async () => {
    serve(ok(nativePage));
    const response = await call('?dest=not-a-key');
    expect(response.headers.get('cache-control')).toBeNull();
  });
});

describe('GET /api/total — upstream failure', () => {
  it('returns 502 when Horizon is unavailable (503)', async () => {
    serve({ status: 503, body: HORIZON_503 });

    const response = await call(`?dest=${NATIVE_DEST}`);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'Horizon request failed.' });
  });

  it.each([500, 502, 504, 429])('returns 502 when Horizon responds %i', async (status) => {
    serve({ status, body: { title: 'Error' } });
    expect((await call(`?dest=${NATIVE_DEST}`)).status).toBe(502);
  });

  it('returns 502 when the request throws instead of responding', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    const response = await call(`?dest=${NATIVE_DEST}`);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'Horizon request failed.' });
  });

  it('does not leak upstream error detail to the caller', async () => {
    serve({ status: 503, body: HORIZON_503 });

    const body = await (await call(`?dest=${NATIVE_DEST}`)).json();
    expect(JSON.stringify(body)).not.toContain('horizon-errors');
  });

  it('does not send cache headers on a 502', async () => {
    serve({ status: 503, body: HORIZON_503 });
    const response = await call(`?dest=${NATIVE_DEST}`);
    expect(response.headers.get('cache-control')).toBeNull();
  });
});

describe('GET /api/total — caching', () => {
  it('sets the expected s-maxage and stale-while-revalidate', async () => {
    serve(ok(nativePage), ok(EMPTY_PAGE));

    const response = await call(`?dest=${NATIVE_DEST}`);
    expect(response.headers.get('cache-control')).toBe(EXPECTED_CACHE_CONTROL);
  });

  it('marks the response publicly cacheable', async () => {
    serve(ok(nativePage), ok(EMPTY_PAGE));

    const cacheControl = (await call(`?dest=${NATIVE_DEST}`)).headers.get('cache-control')!;
    expect(cacheControl).toContain('public');
    expect(cacheControl).toContain('s-maxage=30');
    expect(cacheControl).toContain('stale-while-revalidate=120');
  });
});

describe('GET /api/total — pagination', () => {
  it('follows the next link across pages', async () => {
    const paged = {
      _links: { next: { href: 'https://horizon.stellar.org/next-page' } },
      _embedded: { records: nativePage._embedded.records },
    };
    serve(ok(paged), ok(EMPTY_PAGE));

    await call(`?dest=${NATIVE_DEST}`);
    expect(requested).toHaveLength(2);
    expect(requested[1]).toBe('https://horizon.stellar.org/next-page');
  });

  it('stops when a page comes back empty, even if it links to another', async () => {
    // Horizon's empty pages link to themselves; following that would not end.
    serve(
      ok({
        _links: { next: { href: 'https://horizon.stellar.org/same-page' } },
        _embedded: { records: [] },
      }),
    );

    await call(`?dest=${NATIVE_DEST}`);
    expect(requested).toHaveLength(1);
  });
});

describe('GET /api/total — elapsed-time budget', () => {
  /** Pages walked before the budget runs out, at a given per-page latency. */
  const pagesWithin = (perPageMs: number) => Math.ceil(PAGINATION_BUDGET_MS / perPageMs);

  it('returns 200 with a partial total, not 502, when the budget runs out', async () => {
    serveWithLatency(3_000, endlessPage());

    const response = await call(`?dest=${NATIVE_DEST}`);

    // The whole point of the fix: a high-volume account gets a truthful
    // partial answer instead of a function timeout.
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      funded: true,
      truncated: true,
    });
  });

  it('walks fewer pages when Horizon is slow than when it is fast', async () => {
    serveWithLatency(2_000, endlessPage());
    await call(`?dest=${NATIVE_DEST}`);
    const slowPages = requested.length;

    vi.restoreAllMocks();
    requested = [];

    serveWithLatency(200, endlessPage());
    await call(`?dest=${NATIVE_DEST}`);
    const fastPages = requested.length;

    // A fixed page cap assumed uniform per-page latency and so blew the
    // function timeout on slow accounts; the budget adapts to it instead.
    expect(slowPages).toBe(pagesWithin(2_000));
    expect(fastPages).toBe(pagesWithin(200));
    expect(fastPages).toBeGreaterThan(slowPages);
  });

  it('stops a slow walk well before a fixed five-page lookback would have', async () => {
    // 5 pages x 3s was 15s of Horizon latency alone — past the timeout.
    serveWithLatency(3_000, endlessPage());

    await call(`?dest=${NATIVE_DEST}`);
    expect(requested.length).toBeLessThan(5);
  });

  it('never spends more than the budget plus the page already in flight', async () => {
    const perPageMs = 1_500;
    const clock = serveWithLatency(perPageMs, endlessPage());

    await call(`?dest=${NATIVE_DEST}`);

    // The budget is checked before each request, never mid-flight, so the
    // overrun is bounded by one page — that is the headroom the constant
    // leaves under the platform timeout.
    expect(clock.elapsed()).toBeLessThanOrEqual(PAGINATION_BUDGET_MS + perPageMs);
  });

  it('reports truncated: false when the history ends inside the budget', async () => {
    serve(ok(nativePage), ok(EMPTY_PAGE));

    const body = await (await call(`?dest=${NATIVE_DEST}`)).json();
    // Ran out of history, not of time — this total is the whole jar.
    expect(body.truncated).toBe(false);
  });

  it('does not mark a slow but complete history as truncated', async () => {
    // Two pages at 3s each: sluggish, but the history ends before the budget
    // does. Slowness alone must not put a "+" on a total that is in fact whole.
    serveWithLatency(3_000, ok(nativePage), ok(EMPTY_PAGE));

    const body = await (await call(`?dest=${NATIVE_DEST}`)).json();
    expect(requested).toHaveLength(2);
    expect(body.truncated).toBe(false);
  });

  it('marks a total truncated only when Horizon still had more to give', async () => {
    // The budget is spent and the last page pointed onward — genuinely partial.
    serveWithLatency(3_000, endlessPage());

    const body = await (await call(`?dest=${NATIVE_DEST}`)).json();
    expect(body.truncated).toBe(true);
    expect(body.count).toBeGreaterThan(0);
  });
});
