// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Home from '../page';

/**
 * Tests for the landing page. It is a static server component with no data
 * fetching, so it renders synchronously — the only environment-dependent
 * branch is the live-example link, which is gated on HORIZON_URL.
 */

const TESTNET = 'https://horizon-testnet.stellar.org';
const MAINNET = 'https://horizon.stellar.org';

/** Render the page with HORIZON_URL stubbed to a given network. */
function renderHome(horizonUrl?: string) {
  if (horizonUrl === undefined) {
    vi.stubEnv('HORIZON_URL', '');
  } else {
    vi.stubEnv('HORIZON_URL', horizonUrl);
  }
  return render(Home());
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('landing page — renders real content', () => {
  it('renders without throwing', () => {
    expect(() => renderHome(TESTNET)).not.toThrow();
  });

  it('leads with what the product actually is', () => {
    renderHome(TESTNET);
    expect(screen.getByRole('heading', { level: 1, name: /A tip jar that's just a link/ })).toBeTruthy();
  });

  it('states the no-signup, no-database premise', () => {
    renderHome(TESTNET);
    expect(screen.getByText(/no signup, no\s+account to create, and no database/i)).toBeTruthy();
  });

  it('states that the site never holds or routes funds', () => {
    renderHome(TESTNET);
    expect(screen.getByText(/never holds,\s+routes, or touches the money/i)).toBeTruthy();
  });

  it('documents the tip-link format including every supported param', () => {
    renderHome(TESTNET);

    const code = screen.getByText(/\/tip\?dest=/);
    expect(code.textContent).toContain('name=');
    expect(code.textContent).toContain('asset=native');
    expect(code.textContent).toContain('amounts=5,25,100');
  });

  it('explains each query parameter', () => {
    const { container } = renderHome(TESTNET);

    const terms = Array.from(container.querySelectorAll('dt')).map((dt) => dt.textContent);
    expect(terms).toEqual(['dest', 'name', 'asset', 'amounts']);
    // Each term is paired with a description, not left dangling.
    expect(container.querySelectorAll('dd').length).toBe(terms.length);
  });

  it('links to the GitHub repository', () => {
    renderHome(TESTNET);

    const link = screen.getByRole('link', { name: /read the code on GitHub/i });
    expect(link.getAttribute('href')).toBe('https://github.com/solaawojobi00-bit/stellar-tip-jar');
  });
});

describe('landing page — no create-next-app scaffold remains', () => {
  it.each([
    /To get started, edit/i,
    /Deploy Now/i,
    /Documentation/i,
    /Templates/i,
    /Learning/i,
  ])('does not render the default starter text %s', (pattern) => {
    renderHome(TESTNET);
    expect(screen.queryByText(pattern)).toBeNull();
  });

  it('renders no next.js or vercel logo images', () => {
    const { container } = renderHome(TESTNET);

    for (const img of Array.from(container.querySelectorAll('img'))) {
      const src = img.getAttribute('src') ?? '';
      expect(src).not.toContain('next.svg');
      expect(src).not.toContain('vercel.svg');
    }
  });

  it('links nowhere at nextjs.org or vercel.com', () => {
    const { container } = renderHome(TESTNET);

    for (const anchor of Array.from(container.querySelectorAll('a'))) {
      const href = anchor.getAttribute('href') ?? '';
      expect(href).not.toContain('nextjs.org');
      expect(href).not.toContain('vercel.com');
    }
  });
});

describe('landing page — live example link is network-aware', () => {
  it('offers a working example on testnet, pointing at /tip', () => {
    renderHome(TESTNET);

    const link = screen.getByRole('link', { name: 'See a live example' });
    const href = link.getAttribute('href')!;

    expect(href.startsWith('/tip?')).toBe(true);
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect(params.get('dest')).toMatch(/^G[A-Z2-7]{55}$/);
    expect(params.get('asset')).toBe('native');
    expect(params.get('amounts')).toBe('5,25,100');
  });

  it('withholds the example on mainnet, where that account does not exist', () => {
    renderHome(MAINNET);

    // A demo that renders the "not funded yet" warning is worse than no demo.
    expect(screen.queryByRole('link', { name: 'See a live example' })).toBeNull();
    expect(screen.getByText(/Swap in your own address/i)).toBeTruthy();
  });

  it('treats an unset HORIZON_URL as mainnet, matching the route handler', () => {
    renderHome(undefined);
    expect(screen.queryByRole('link', { name: 'See a live example' })).toBeNull();
  });

  it('keeps the parameter documentation on both networks', () => {
    renderHome(MAINNET);
    const section = screen.getByRole('region', { name: /Making one/i });
    expect(within(section).getByText(/\/tip\?dest=/)).toBeTruthy();
  });
});
