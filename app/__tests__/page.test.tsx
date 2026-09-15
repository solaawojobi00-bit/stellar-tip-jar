// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import Home from '../page';
import { buildTipLink, parseBuilderAmounts } from '../link-builder';

/**
 * Tests for the landing page, which is the tip-link builder.
 *
 * The builder is client-only and does no fetching, so these drive it the way a
 * creator does — paste an address, read the link back out. Address validation
 * itself is lib/strkey.ts's job and is tested there; what matters here is that
 * the page believes it, and that the URL it assembles is one /tip accepts.
 */

/** Checksum-valid fixtures, shared with lib/__tests__/strkey.test.ts. */
const G_REAL = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const M_REAL = 'MAAACAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4DUPB6AAAAAAAAAAAABEJ6';

/** jsdom's origin. The builder reads it from window after mount. */
const ORIGIN = 'http://localhost:3000';

const address = () => screen.getByLabelText(/Your Stellar address/i);
const copyButton = () => screen.getByRole('button', { name: /Copy link|Link copied/ });
const previewLink = () => screen.queryByRole('link', { name: 'Preview page' });

/**
 * Put an address in the field the way a creator does — by pasting it. Typing
 * it out would be 56 keystrokes and 56 re-renders, which is both slow enough
 * to time these tests out and not how anyone enters a Stellar address.
 */
async function pasteAddress(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.click(address());
  await user.paste(value);
}

/** The assembled link, read back off the page exactly as it is displayed. */
function shownLink(): string {
  return screen.getByText(`${ORIGIN}/tip?dest=`).parentElement!.textContent!;
}

afterEach(cleanup);

describe('link assembly', () => {
  it('builds a bare link from an address alone', () => {
    const link = buildTipLink(ORIGIN, G_REAL, '', []);
    expect(link.href).toBe(`${ORIGIN}/tip?dest=${G_REAL}`);
    expect(link.rest).toBe('');
  });

  it('appends only the optional params that were supplied', () => {
    expect(buildTipLink(ORIGIN, G_REAL, 'Ada', []).rest).toBe('&name=Ada');
    expect(buildTipLink(ORIGIN, G_REAL, '', ['5', '25']).rest).toBe('&amounts=5,25');
  });

  it('url-encodes the name so it survives the query string', () => {
    const { href, rest } = buildTipLink(ORIGIN, G_REAL, 'Ada & Grace', []);
    expect(rest).toBe('&name=Ada%20%26%20Grace');
    expect(new URL(href).searchParams.get('name')).toBe('Ada & Grace');
  });

  it('splits the link where the display colours it', () => {
    const link = buildTipLink(ORIGIN, G_REAL, 'Ada', ['5']);
    expect(link.prefix + link.dest + link.rest).toBe(link.href);
  });
});

describe('amount parsing', () => {
  it('accepts commas and bare spaces alike', () => {
    expect(parseBuilderAmounts('5, 25, 100')).toEqual(['5', '25', '100']);
    expect(parseBuilderAmounts('5 25 100')).toEqual(['5', '25', '100']);
  });

  it('drops entries that are not positive decimal amounts', () => {
    expect(parseBuilderAmounts('5, abc, -3, 0, 10')).toEqual(['5', '10']);
  });

  it('caps the list rather than generating an unusable row of chips', () => {
    expect(parseBuilderAmounts('1,2,3,4,5,6,7')).toEqual(['1', '2', '3', '4', '5']);
  });

  it('treats an empty field as no suggestion at all', () => {
    expect(parseBuilderAmounts('')).toEqual([]);
    expect(parseBuilderAmounts('   ')).toEqual([]);
  });
});

describe('the builder — address states', () => {
  it('starts empty, with a placeholder instead of a half-built link', () => {
    render(<Home />);

    expect(screen.getByText(/Paste your address above and your link appears here/i)).toBeTruthy();
    expect(screen.getByText(/Starts with G — copy it from your wallet/i)).toBeTruthy();
  });

  it('builds a link from a valid G address', async () => {
    const user = userEvent.setup();
    render(<Home />);

    await pasteAddress(user, G_REAL);

    expect(screen.getByText(/Looks like a valid Stellar address/i)).toBeTruthy();
    expect(shownLink()).toBe(`${ORIGIN}/tip?dest=${G_REAL}`);
  });

  it('accepts a muxed M address too', async () => {
    const user = userEvent.setup();
    render(<Home />);

    await pasteAddress(user, M_REAL);
    expect(shownLink()).toBe(`${ORIGIN}/tip?dest=${M_REAL}`);
  });

  it('rejects an address that fails its checksum, without building a link', async () => {
    const user = userEvent.setup();
    render(<Home />);

    // G_REAL with its last character changed: right shape, wrong checksum.
    await pasteAddress(user, `${G_REAL.slice(0, -1)}A`);

    expect(screen.getByText(/doesn't check out as a Stellar address/i)).toBeTruthy();
    expect(screen.getByText(/your link appears here/i)).toBeTruthy();
    expect(address().getAttribute('aria-invalid')).toBe('true');
  });

  it('ignores whitespace around a pasted address', async () => {
    const user = userEvent.setup();
    render(<Home />);

    await pasteAddress(user, `  ${G_REAL}  `);
    expect(shownLink()).toBe(`${ORIGIN}/tip?dest=${G_REAL}`);
  });
});

describe('the builder — optional fields', () => {
  it('folds name and amounts into the link as they are typed', async () => {
    const user = userEvent.setup();
    render(<Home />);

    await pasteAddress(user, G_REAL);
    await user.type(screen.getByLabelText(/Your name/i), 'Ada');
    await user.type(screen.getByLabelText(/Amounts/i), '5, 25, 100');

    const params = new URL(shownLink()).searchParams;
    expect(params.get('dest')).toBe(G_REAL);
    expect(params.get('name')).toBe('Ada');
    expect(params.get('amounts')).toBe('5,25,100');
  });

  it('leaves untouched optional fields out of the link entirely', async () => {
    const user = userEvent.setup();
    render(<Home />);

    await pasteAddress(user, G_REAL);
    await user.type(screen.getByLabelText(/Amounts/i), '5');

    const link = shownLink();
    expect(link).not.toContain('name=');
    expect(link).toContain('amounts=5');
  });
});

describe('the builder — copy and preview', () => {
  it('withholds both actions until there is a link worth sharing', async () => {
    const user = userEvent.setup();
    render(<Home />);

    expect((copyButton() as HTMLButtonElement).disabled).toBe(true);
    expect(previewLink()).toBeNull();

    await pasteAddress(user, G_REAL);

    expect((copyButton() as HTMLButtonElement).disabled).toBe(false);
    expect(previewLink()!.getAttribute('href')).toBe(`${ORIGIN}/tip?dest=${G_REAL}`);
  });

  it('copies the built link and says so', async () => {
    const user = userEvent.setup();
    render(<Home />);

    await pasteAddress(user, G_REAL);
    await user.click(copyButton());

    expect(await navigator.clipboard.readText()).toBe(`${ORIGIN}/tip?dest=${G_REAL}`);
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
  });

  it('opens the preview in a new tab without leaking the opener', async () => {
    const user = userEvent.setup();
    render(<Home />);

    await pasteAddress(user, G_REAL);

    const link = previewLink()!;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});

describe('the landing page — framing that must not be lost', () => {
  it('leads with the builder, not with documentation', () => {
    render(<Home />);

    expect(
      screen.getByRole('heading', { level: 1, name: /Make your tip jar in one field/i }),
    ).toBeTruthy();
    expect(screen.getByLabelText(/Your Stellar address/i)).toBeTruthy();
  });

  it('states the no-signup, no-database premise', () => {
    render(<Home />);
    expect(screen.getByText(/No signup, no account, no\s+database/i)).toBeTruthy();
  });

  it('states that the site never holds or routes funds', () => {
    render(<Home />);
    expect(screen.getByText(/never holds,\s+routes or touches the money/i)).toBeTruthy();
  });

  it('links to the GitHub repository', () => {
    render(<Home />);

    const link = screen.getByRole('link', { name: /Read the code/i });
    expect(link.getAttribute('href')).toBe('https://github.com/solaawojobi00-bit/stellar-tip-jar');
  });

  it('no longer asks anyone to assemble a query string by hand', () => {
    const { container } = render(<Home />);

    expect(container.querySelectorAll('dt').length).toBe(0);
    expect(screen.queryByText(/YOUR_ADDRESS/)).toBeNull();
  });
});

describe('the landing page — no create-next-app scaffold remains', () => {
  it.each([
    /To get started, edit/i,
    /Deploy Now/i,
    /Documentation/i,
    /Templates/i,
    /Learning/i,
  ])('does not render the default starter text %s', (pattern) => {
    render(<Home />);
    expect(screen.queryByText(pattern)).toBeNull();
  });

  it('renders no next.js or vercel logo images', () => {
    const { container } = render(<Home />);

    for (const img of Array.from(container.querySelectorAll('img'))) {
      const src = img.getAttribute('src') ?? '';
      expect(src).not.toContain('next.svg');
      expect(src).not.toContain('vercel.svg');
    }
  });

  it('links nowhere at nextjs.org or vercel.com', () => {
    const { container } = render(<Home />);

    for (const anchor of Array.from(container.querySelectorAll('a'))) {
      const href = anchor.getAttribute('href') ?? '';
      expect(href).not.toContain('nextjs.org');
      expect(href).not.toContain('vercel.com');
    }
  });
});
