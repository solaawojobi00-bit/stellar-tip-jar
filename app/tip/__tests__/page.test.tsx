// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseSuggestedAmounts } from '@/lib/sep7';

import { formatAmount, formatTotal, truncateAddress } from '../tip-jar';
import TipPage from '../page';

/**
 * Tests for the tip page, driven through the real server component: the page
 * is an async function returning JSX, so it can be awaited and rendered along
 * with its <TipJar> client island.
 *
 * /api/total is served from canned responses matching the contract in
 * app/api/total/route.ts — no network calls.
 */

const DEST = 'GBP32F37ZHXGSLOE4WAFCLNWQUMY4OUIAUGNBZUF4OD2BG6MS7WKRTSX';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

/** A funded response, as /api/total returns it. */
function funded(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    dest: DEST,
    asset: 'native',
    total: '23192.9749800',
    count: 8,
    funded: true,
    truncated: false,
    ...overrides,
  };
}

/** The unfunded response: 200, zero total, funded false. */
function unfunded() {
  return {
    dest: DEST,
    asset: 'native',
    total: '0.0000000',
    count: 0,
    funded: false,
    truncated: false,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

function serveTotal(body: unknown, status = 200) {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
}

/** Render the page for a query string, as Next would. */
async function renderTip(query: Record<string, string> = {}) {
  const searchParams = Promise.resolve({ dest: DEST, ...query });
  return render(await TipPage({ searchParams }));
}

/** The QR is an <svg> labelled with the destination; return its encoded value. */
function qrCode(): SVGElement | null {
  return document.querySelector('svg[data-testid], svg');
}

/**
 * The wallet hand-off link. Its visible label tracks the selected amount
 * ("Open in wallet" → "Send 5 XLM"), and the accessible name follows the
 * visible text on purpose, so match either form rather than pinning one.
 */
function walletLink(): HTMLElement {
  return screen.getByRole('link', { name: /^(Open in wallet|Send [\d.]+ [A-Z]+)$/ });
}

beforeEach(() => {
  serveTotal(funded());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('tip page — error states', () => {
  it('renders "No destination" when dest is missing, and no QR', async () => {
    render(await TipPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('heading', { name: 'No destination' })).toBeTruthy();
    expect(qrCode()).toBeNull();
  });

  it('renders "Invalid address" for a malformed strkey, and no QR', async () => {
    render(await TipPage({ searchParams: Promise.resolve({ dest: 'not-a-key' }) }));

    expect(screen.getByRole('heading', { name: 'Invalid address' })).toBeTruthy();
    expect(qrCode()).toBeNull();
  });

  it('renders "Invalid address" for a checksum failure', async () => {
    const typo = `${DEST.slice(0, -1)}A`;
    render(await TipPage({ searchParams: Promise.resolve({ dest: typo }) }));

    expect(screen.getByRole('heading', { name: 'Invalid address' })).toBeTruthy();
    expect(qrCode()).toBeNull();
  });

  it('renders "Invalid asset" for a malformed asset', async () => {
    render(await TipPage({ searchParams: Promise.resolve({ dest: DEST, asset: 'USDC' }) }));

    expect(screen.getByRole('heading', { name: 'Invalid asset' })).toBeTruthy();
    expect(qrCode()).toBeNull();
  });

  it('never calls /api/total when the link is invalid', async () => {
    render(await TipPage({ searchParams: Promise.resolve({ dest: 'not-a-key' }) }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('tip page — QR code', () => {
  it('renders a QR encoding the SEP-0007 pay URI for a valid dest', async () => {
    await renderTip();

    const qr = screen.getByTitle(`Stellar payment code for ${DEST}`);
    expect(qr).toBeTruthy();
    expect(qr.closest('svg')).not.toBeNull();
  });

  it('encodes the destination inside the QR payload', async () => {
    await renderTip();

    // qrcode.react renders the encoded value as SVG paths, so assert on the
    // accessible title, which is derived from the same destination.
    const qr = screen.getByTitle(`Stellar payment code for ${DEST}`);
    expect(qr.textContent).toContain(DEST);
  });

  it('renders the QR inside the labelled payment-code region', async () => {
    await renderTip();

    const region = screen.getByLabelText('Payment code');
    expect(within(region).getByTitle(`Stellar payment code for ${DEST}`)).toBeTruthy();
  });
});

describe('tip page — wallet link and suggested amounts', () => {
  it('links "Open in wallet" to a web+stellar pay URI', async () => {
    await renderTip();

    const link = walletLink();
    const href = link.getAttribute('href')!;

    expect(href.startsWith('web+stellar:pay?')).toBe(true);
    expect(new URLSearchParams(href.slice(href.indexOf('?') + 1)).get('destination')).toBe(DEST);
  });

  it('omits amount from the pay URI until one is chosen', async () => {
    await renderTip({ amounts: '5,10,25' });

    const href = walletLink().getAttribute('href')!;
    expect(new URLSearchParams(href.slice(href.indexOf('?') + 1)).has('amount')).toBe(false);
  });

  it.each(['5', '10', '25'])(
    'puts amount=%s into the pay URI when that chip is selected',
    async (amount) => {
      const user = userEvent.setup();
      await renderTip({ amounts: '5,10,25' });

      await user.click(screen.getByRole('button', { name: `${amount} XLM` }));

      const href = walletLink().getAttribute('href')!;
      const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
      expect(params.get('amount')).toBe(amount);
      expect(params.get('destination')).toBe(DEST);
    },
  );

  it('deselecting a chip removes the amount again', async () => {
    const user = userEvent.setup();
    await renderTip({ amounts: '5,10' });

    const chip = screen.getByRole('button', { name: '5 XLM' });
    await user.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');

    await user.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('false');

    const href = walletLink().getAttribute('href')!;
    expect(new URLSearchParams(href.slice(href.indexOf('?') + 1)).has('amount')).toBe(false);
  });

  it('labels chips with a credit asset code', async () => {
    await renderTip({ amounts: '5', asset: `USDC:${USDC_ISSUER}` });
    expect(screen.getByRole('button', { name: '5 USDC' })).toBeTruthy();
  });

  it('carries asset code and issuer into the pay URI', async () => {
    await renderTip({ amounts: '5', asset: `USDC:${USDC_ISSUER}` });

    const href = walletLink().getAttribute('href')!;
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect(params.get('asset_code')).toBe('USDC');
    expect(params.get('asset_issuer')).toBe(USDC_ISSUER);
  });

  it('drops invalid suggested amounts rather than rendering them', async () => {
    await renderTip({ amounts: '5,abc,-3,10' });

    expect(parseSuggestedAmounts('5,abc,-3,10')).toEqual(['5', '10']);
    expect(screen.getByRole('button', { name: '5 XLM' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '10 XLM' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /abc/ })).toBeNull();
  });

  it('includes msg in the pay URI when given', async () => {
    await renderTip({ msg: 'coffee & cake' });

    const href = walletLink().getAttribute('href')!;
    expect(new URLSearchParams(href.slice(href.indexOf('?') + 1)).get('msg')).toBe('coffee & cake');
  });
});

describe('tip page — copy link', () => {
  /**
   * userEvent.setup() installs its own navigator.clipboard stub, so spy on
   * whatever is actually present rather than replacing navigator wholesale —
   * otherwise the component's writeText call goes somewhere the test can't see.
   */
  function spyOnClipboard(result: 'ok' | 'denied' = 'ok') {
    const spy = vi.spyOn(navigator.clipboard, 'writeText');
    return result === 'ok'
      ? spy.mockResolvedValue(undefined)
      : spy.mockRejectedValue(new Error('denied'));
  }

  it('copies the full page URL, not the pay URI', async () => {
    const user = userEvent.setup();
    await renderTip();
    const writeText = spyOnClipboard();

    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(String(writeText.mock.calls[0][0])).not.toContain('web+stellar:');
  });

  it('shows a confirmation state after copying', async () => {
    const user = userEvent.setup();
    await renderTip();
    spyOnClipboard();

    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
  });

  it('stays in the un-copied state when the clipboard is unavailable', async () => {
    const user = userEvent.setup();
    await renderTip();
    spyOnClipboard('denied');

    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Link copied' })).toBeNull();
  });
});

describe('tip page — running total', () => {
  it('requests /api/total for the destination and asset', async () => {
    await renderTip();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url.startsWith('/api/total?')).toBe(true);

    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(params.get('dest')).toBe(DEST);
    expect(params.get('asset')).toBe('native');
  });

  it('sends the code:issuer pair for a credit asset', async () => {
    await renderTip({ asset: `USDC:${USDC_ISSUER}` });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('asset')).toBe(
      `USDC:${USDC_ISSUER}`,
    );
  });

  it('renders a funded total with its tip count', async () => {
    serveTotal(funded());
    await renderTip();

    expect(await screen.findByText(/23192\.97498 XLM/)).toBeTruthy();
    expect(screen.getByText(/across 8 tips/)).toBeTruthy();
  });

  it('renders a funded account that has received nothing as a real zero', async () => {
    serveTotal(funded({ total: '0.0000000', count: 0 }));
    await renderTip();

    // Anchored: the default "100 XLM" chip also contains "0 XLM".
    expect(await screen.findByText(/^0 XLM$/)).toBeTruthy();
    expect(screen.queryByText(/hasn't been funded on-chain yet/)).toBeNull();
  });

  it('renders the unfunded warning instead of a bare zero total', async () => {
    serveTotal(unfunded());
    await renderTip();

    expect(await screen.findByText(/hasn't been funded on-chain yet/)).toBeTruthy();
    // The whole point: "0.0000000" must not be presented as a real total.
    expect(screen.queryByText(/0\.0000000/)).toBeNull();
    expect(screen.queryByText(/received across/)).toBeNull();
  });

  it('singularises a single tip', async () => {
    serveTotal(funded({ total: '5.0000000', count: 1 }));
    await renderTip();

    expect(await screen.findByText(/across 1 tip$/)).toBeTruthy();
  });

  it('shows a fallback when /api/total fails', async () => {
    serveTotal({ error: 'Horizon request failed.' }, 502);
    await renderTip();

    expect(await screen.findByText(/Couldn't load the running total/)).toBeTruthy();
  });

  it('shows a fallback when the request throws', async () => {
    fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetchMock);

    await renderTip();
    expect(await screen.findByText(/Couldn't load the running total/)).toBeTruthy();
  });

  it('appends a "+" to the amount when the total was truncated', async () => {
    serveTotal(funded({ truncated: true }));
    await renderTip();

    // A partial sum is a floor, and the number says so itself.
    expect(await screen.findByText(/^23192\.97498\+ XLM$/)).toBeTruthy();
  });

  it('shows no "+" when the total covers the whole history', async () => {
    serveTotal(funded({ truncated: false }));
    await renderTip();

    expect(await screen.findByText(/^23192\.97498 XLM$/)).toBeTruthy();
    expect(screen.queryByText(/23192\.97498\+/)).toBeNull();
  });

  it('keeps the tip count wording unchanged when truncated', async () => {
    serveTotal(funded({ truncated: true }));
    await renderTip();

    expect(await screen.findByText(/across 8 tips/)).toBeTruthy();
  });

  it('adds no caveat text, tooltip or badge alongside a truncated total', async () => {
    serveTotal(funded({ truncated: true }));
    await renderTip();

    await screen.findByText(/^23192\.97498\+ XLM$/);
    // The "+" is the whole disclosure — the design carries no added apology.
    for (const wording of [/partial/i, /incomplete/i, /truncat/i, /at least/i, /approx/i]) {
      expect(screen.queryByText(wording)).toBeNull();
    }
  });

  it('marks a truncated zero total the same way', async () => {
    serveTotal(funded({ total: '0.0000000', count: 0, truncated: true }));
    await renderTip();

    expect(await screen.findByText(/^0\+ XLM$/)).toBeTruthy();
  });

  it('does not refetch the total when an amount is selected', async () => {
    const user = userEvent.setup();
    await renderTip({ amounts: '5,10' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: '5 XLM' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('tip page — default amounts and "Other"', () => {
  it('falls back to the design default chips when the link carries no amounts', async () => {
    await renderTip();

    for (const amount of ['5', '25', '100']) {
      expect(screen.getByRole('button', { name: `${amount} XLM` })).toBeTruthy();
    }
  });

  it('offers an "Other" chip alongside the suggested amounts', async () => {
    await renderTip({ amounts: '5,10' });
    expect(screen.getByRole('button', { name: 'Other' })).toBeTruthy();
  });

  it('leaves the amount open when "Other" is selected', async () => {
    const user = userEvent.setup();
    await renderTip({ amounts: '5,10' });

    await user.click(screen.getByRole('button', { name: '5 XLM' }));
    expect(new URL(`x:${walletLink().getAttribute('href')!.split('?')[1]}`).searchParams).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Other' }));

    const href = walletLink().getAttribute('href')!;
    // "Other" means "I'll type my own figure" — no amount may reach the URI.
    expect(new URLSearchParams(href.slice(href.indexOf('?') + 1)).has('amount')).toBe(false);
    expect(screen.getByRole('button', { name: 'Other' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('relabels the wallet link once a concrete amount is chosen', async () => {
    const user = userEvent.setup();
    await renderTip({ amounts: '5,10' });

    expect(screen.getByRole('link', { name: 'Open in wallet' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '5 XLM' }));

    expect(screen.getByRole('link', { name: 'Send 5 XLM' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open in wallet' })).toBeNull();
  });
});

describe('tip page — post-send screen', () => {
  it('claims only that the payment was handed off, never that it completed', async () => {
    const user = userEvent.setup();
    await renderTip({ name: 'Ada' });

    await user.click(walletLink());

    expect(screen.getByRole('heading', { name: 'Thanks for sending it!' })).toBeTruthy();
    // The whole point of the copy: no "confirmed", no checkmark, no claim.
    expect(screen.getByText(/We can't confirm the payment/)).toBeTruthy();
    expect(screen.queryByText(/confirmed/i)).toBeNull();
  });

  it('explains that the page only builds the link', async () => {
    const user = userEvent.setup();
    await renderTip();

    await user.click(walletLink());
    expect(screen.getByText(/only builds the link and hands it to your wallet/)).toBeTruthy();
  });

  it('returns to the jar and clears the selected amount', async () => {
    const user = userEvent.setup();
    await renderTip({ amounts: '5,10', name: 'Ada' });

    await user.click(screen.getByRole('button', { name: '5 XLM' }));
    await user.click(walletLink());
    await user.click(screen.getByRole('button', { name: "Back to Ada's jar" }));

    expect(screen.getByRole('link', { name: 'Open in wallet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '5 XLM' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });
});

describe('tip page — address and ledger links', () => {
  it('shows a truncated address but copies the full one', async () => {
    const user = userEvent.setup();
    await renderTip();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    const button = screen.getByTitle(DEST);
    expect(button.textContent).not.toBe(DEST);

    await user.click(button);
    expect(writeText).toHaveBeenCalledWith(DEST);
    expect(await screen.findByRole('button', { name: 'Address copied' })).toBeTruthy();
  });

  it('points "verify on-chain" at the destination account', async () => {
    await renderTip();

    const link = await screen.findByRole('link', { name: 'verify on-chain' });
    expect(link.getAttribute('href')).toContain(DEST);
    expect(link.getAttribute('href')!.startsWith('https://stellar.expert/')).toBe(true);
  });

  it('states that funds are never held or routed', async () => {
    await renderTip({ name: 'Ada' });
    expect(screen.getByText(/We never hold, route, or touch the money/)).toBeTruthy();
  });
});

/**
 * Avatar and bio are the only values on this page that arrive from the query
 * string and are rendered as something other than plain text, so these drive
 * the real page with the real parsers and assert on what reaches the DOM.
 */
describe('tip page — avatar', () => {
  const AVATAR = 'https://example.com/ada.jpg';

  /** The avatar image, if the page rendered one at all. */
  function avatarImage(): HTMLImageElement | null {
    return document.querySelector('img');
  }

  it('renders the avatar image when the link carries an https one', async () => {
    await renderTip({ name: 'Ada', avatar: AVATAR });

    const img = avatarImage();
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe(AVATAR);
  });

  it('renders no image at all when the link carries no avatar', async () => {
    // A link that predates this feature must look exactly as it did.
    await renderTip({ name: 'Ada' });
    expect(avatarImage()).toBeNull();
  });

  it.each([
    ['javascript:alert(1)', 'a script URL'],
    ['data:image/svg+xml,<svg onload=alert(1)>', 'an inline data URL'],
    ['http://example.com/ada.jpg', 'plain http'],
    ['/ada.jpg', 'a same-site path'],
    ['not a url at all', 'junk'],
  ])('drops %s (%s) rather than putting it in an src', async (avatar) => {
    await renderTip({ name: 'Ada', avatar });

    expect(avatarImage()).toBeNull();
    // Not merely absent from the img — absent from the page entirely.
    expect(document.body.innerHTML).not.toContain('javascript:');
    expect(document.body.innerHTML).not.toContain('onload=');
  });

  it('still renders the rest of the jar when the avatar is refused', async () => {
    await renderTip({ name: 'Ada', avatar: 'javascript:alert(1)' });

    // A bad decoration must not cost the page its reason for existing.
    expect(screen.getByRole('heading', { name: 'Tip Ada' })).toBeTruthy();
    expect(screen.getByTitle(`Stellar payment code for ${DEST}`)).toBeTruthy();
  });

  it('falls back to a monogram when the image fails to load', async () => {
    await renderTip({ name: 'Ada Lovelace', avatar: AVATAR });

    const img = avatarImage()!;
    expect(screen.queryByText('AL')).toBeNull();

    // A dead link or a hotlink block arrives as an error event; the browser's
    // broken-image glyph would read as "this tip page is broken".
    fireEvent.error(img);

    expect(await screen.findByText('AL')).toBeTruthy();
    expect(avatarImage()).toBeNull();
  });

  it('falls back to the jar mark when a failed image has no name to initial', async () => {
    await renderTip({ avatar: AVATAR });

    fireEvent.error(avatarImage()!);

    await waitFor(() => expect(avatarImage()).toBeNull());
    // No initials to show, so no empty circle either — the mark stands in.
    expect(screen.getByRole('heading', { name: 'Tip this creator' })).toBeTruthy();
  });

  it('keeps the tip link out of the image host’s referrer logs', async () => {
    await renderTip({ name: 'Ada', avatar: AVATAR });
    expect(avatarImage()!.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('leaves the avatar out of the pay URI, which is about money only', async () => {
    await renderTip({ name: 'Ada', avatar: AVATAR, bio: 'Maps by hand.' });

    const href = walletLink().getAttribute('href')!;
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect(params.has('avatar')).toBe(false);
    expect(params.has('bio')).toBe(false);
  });
});

describe('tip page — bio', () => {
  it('renders the bio alongside the name', async () => {
    await renderTip({ name: 'Ada', bio: 'Open-source maps, drawn by hand.' });

    expect(screen.getByText('Open-source maps, drawn by hand.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Tip Ada' })).toBeTruthy();
  });

  it('renders a bio with no name at all', async () => {
    await renderTip({ bio: 'Tips keep the lights on.' });
    expect(screen.getByText('Tips keep the lights on.')).toBeTruthy();
  });

  it('renders markup in a bio as text, never as elements', async () => {
    await renderTip({ name: 'Ada', bio: '<img src=x onerror=alert(1)> <b>bold</b>' });

    expect(screen.getByText('<img src=x onerror=alert(1)> <b>bold</b>')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
  });

  it('collapses a multi-line bio into one line', async () => {
    await renderTip({ bio: 'I draw   maps\nand charts' });
    expect(screen.getByText('I draw maps and charts')).toBeTruthy();
  });

  it('caps an over-long bio instead of pushing the QR off the page', async () => {
    const long = 'word '.repeat(80).trim();
    await renderTip({ name: 'Ada', bio: long });

    const rendered = screen.getByText(/^word word/);
    expect(rendered.textContent!.length).toBeLessThan(long.length);
    expect(rendered.textContent!.endsWith('…')).toBe(true);
  });

  it('renders no bio paragraph when the link carries none', async () => {
    await renderTip({ name: 'Ada', msg: 'coffee' });

    // The msg paragraph is still the only one under the heading.
    const heading = screen.getByRole('heading', { name: 'Tip Ada' });
    const identity = heading.closest('div')!.parentElement!;
    expect(within(identity).getAllByText(/coffee/).length).toBe(1);
    expect(identity.querySelectorAll('p').length).toBe(1);
  });

  it('keeps bio and msg as separate things', async () => {
    await renderTip({ name: 'Ada', bio: 'I draw maps.', msg: 'coffee & cake' });

    expect(screen.getByText('I draw maps.')).toBeTruthy();
    expect(screen.getByText('coffee & cake')).toBeTruthy();
    // msg is the wallet's note and still travels in the pay URI; bio does not.
    const href = walletLink().getAttribute('href')!;
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect(params.get('msg')).toBe('coffee & cake');
    expect(params.has('bio')).toBe(false);
  });
});

describe('truncateAddress', () => {
  it('keeps both ends of a strkey so it stays recognisable', () => {
    const short = truncateAddress(DEST);
    expect(short.startsWith(DEST.slice(0, 8))).toBe(true);
    expect(short.endsWith(DEST.slice(-8))).toBe(true);
    expect(short.length).toBeLessThan(DEST.length);
  });

  it('leaves an already-short value alone', () => {
    expect(truncateAddress('GSHORT')).toBe('GSHORT');
  });
});

describe('formatTotal', () => {
  it.each([
    ['23192.9749800', '23192.97498'],
    ['0.0000000', '0'],
    ['5.0000000', '5'],
    ['0.0000001', '0.0000001'],
    ['1.5000000', '1.5'],
  ])('renders %s as %s', (wire, display) => {
    expect(formatTotal(wire)).toBe(display);
  });

  it('leaves an integer-only string alone', () => {
    expect(formatTotal('42')).toBe('42');
  });
});

describe('formatAmount', () => {
  it.each([
    ['23192.9749800', '23192.97498+'],
    ['0.0000000', '0+'],
    ['5.0000000', '5+'],
  ])('suffixes %s with a "+" when truncated', (wire, display) => {
    expect(formatAmount(wire, true)).toBe(display);
  });

  it('leaves a complete total exactly as formatTotal renders it', () => {
    for (const wire of ['23192.9749800', '0.0000000', '1.5000000']) {
      expect(formatAmount(wire, false)).toBe(formatTotal(wire));
    }
  });

  it('puts the "+" on the number, not after the asset code', () => {
    // "23192.97498+ XLM", never "23192.97498 XLM+".
    expect(formatAmount('23192.9749800', true).endsWith('+')).toBe(true);
  });
});
