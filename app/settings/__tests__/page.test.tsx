// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { NATIVE, parseSuggestedAmounts, type Asset } from '@/lib/sep7';

import { buildConfiguredLink } from '../amount-settings';
import SettingsPage from '../page';

/**
 * Tests for the Settings screen, driven through the real server component the
 * way Next renders it: an async function returning JSX, awaited and then
 * rendered along with its <AmountSettings> client island.
 *
 * The screen does no fetching, so these drive it the way a creator does —
 * open an existing tip link, change the chips, read the new link back out.
 * What matters is that the link it produces is one /tip agrees with, which is
 * asserted against the same parser /tip uses rather than a restated copy.
 */

const DEST = 'GBP32F37ZHXGSLOE4WAFCLNWQUMY4OUIAUGNBZUF4OD2BG6MS7WKRTSX';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

/** jsdom's origin. The editor reads it from window after mount. */
const ORIGIN = 'http://localhost:3000';

/** Render the page for a query string, as Next would. */
async function renderSettings(query: Record<string, string> = {}) {
  const searchParams = Promise.resolve({ dest: DEST, ...query });
  return render(await SettingsPage({ searchParams }));
}

const amountFields = () =>
  screen.queryAllByLabelText(/^Amount \d+$/) as HTMLInputElement[];
const addButton = () => screen.getByRole('button', { name: 'Add amount' });
const defaultsButton = () => screen.getByRole('button', { name: 'Use defaults' });
const copyButton = () => screen.getByRole('button', { name: /Copy link|Link copied/ });
const previewLink = () => screen.getByRole('link', { name: 'Preview page' });

/** The assembled link, read back off the page exactly as it is displayed. */
function shownLink(): string {
  return screen.getByText(`${ORIGIN}/tip?dest=`).parentElement!.textContent!;
}

/** The `amounts` param of the link currently on screen. */
function shownAmounts(): string | null {
  return new URL(shownLink()).searchParams.get('amounts');
}

/** Replace a field's contents the way someone editing a number does. */
async function retype(
  user: ReturnType<typeof userEvent.setup>,
  field: HTMLInputElement,
  value: string,
) {
  await user.clear(field);
  if (value !== '') await user.type(field, value);
}

afterEach(cleanup);

describe('link assembly', () => {
  const config = { dest: DEST, asset: NATIVE as Asset };

  it('writes the edited amounts into a /tip link', () => {
    const link = buildConfiguredLink(ORIGIN, config, ['5', '25']);
    expect(link.href).toBe(`${ORIGIN}/tip?dest=${DEST}&amounts=5,25`);
  });

  it('writes an empty amounts param when every amount was removed', () => {
    // The tip page falls back to the defaults only for an *absent* param, so
    // "none" has to be said out loud or deleting every chip does nothing.
    const link = buildConfiguredLink(ORIGIN, config, []);
    expect(link.rest).toBe('&amounts=');
    expect(new URL(link.href).searchParams.get('amounts')).toBe('');
  });

  it('always states the amounts, even when they match the defaults', () => {
    expect(buildConfiguredLink(ORIGIN, config, ['5', '25', '100']).rest).toBe(
      '&amounts=5,25,100',
    );
  });

  it('carries name, asset and message through untouched', () => {
    const link = buildConfiguredLink(
      ORIGIN,
      {
        dest: DEST,
        asset: { kind: 'credit', code: 'USDC', issuer: USDC_ISSUER },
        name: 'Ada',
        msg: 'Thanks!',
      },
      ['5'],
    );

    const params = new URL(link.href).searchParams;
    expect(params.get('name')).toBe('Ada');
    expect(params.get('asset')).toBe(`USDC:${USDC_ISSUER}`);
    expect(params.get('msg')).toBe('Thanks!');
    expect(params.get('amounts')).toBe('5');
  });

  it('url-encodes values that would otherwise break the query string', () => {
    const link = buildConfiguredLink(
      ORIGIN,
      { dest: DEST, asset: NATIVE, name: 'Ada & Grace', msg: 'a=b&c' },
      ['5'],
    );

    expect(link.rest).toContain('&name=Ada%20%26%20Grace');
    const params = new URL(link.href).searchParams;
    expect(params.get('name')).toBe('Ada & Grace');
    expect(params.get('msg')).toBe('a=b&c');
  });

  it('splits the link where the display colours it', () => {
    const link = buildConfiguredLink(ORIGIN, config, ['5']);
    expect(link.prefix + link.dest + link.rest).toBe(link.href);
  });

  it('offers a root-relative path alongside the absolute URL', () => {
    const link = buildConfiguredLink(ORIGIN, config, ['5']);

    expect(link.path).toBe(`/tip?dest=${DEST}&amounts=5`);
    expect(link.href).toBe(`${ORIGIN}${link.path}`);
  });

  it('keeps a bad origin out of the path that gets navigated', () => {
    // location.origin is the string "null" in a sandboxed or data: document.
    const link = buildConfiguredLink('null', config, ['5']);
    expect(link.path.startsWith('/tip?')).toBe(true);
  });
});

describe('settings page — error states', () => {
  it('refuses to configure a jar with no address', async () => {
    render(await SettingsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('heading', { name: 'No jar to configure' })).toBeTruthy();
    expect(amountFields()).toHaveLength(0);
  });

  it('renders "Invalid address" for a checksum failure, and no editor', async () => {
    const typo = `${DEST.slice(0, -1)}A`;
    render(await SettingsPage({ searchParams: Promise.resolve({ dest: typo }) }));

    expect(screen.getByRole('heading', { name: 'Invalid address' })).toBeTruthy();
    expect(amountFields()).toHaveLength(0);
  });

  it('renders "Invalid asset" for a malformed asset', async () => {
    await renderSettings({ asset: 'USDC' });

    expect(screen.getByRole('heading', { name: 'Invalid asset' })).toBeTruthy();
    expect(amountFields()).toHaveLength(0);
  });
});

describe('settings page — opening state', () => {
  it('opens on the amounts the link already carries', async () => {
    await renderSettings({ amounts: '2,7,13' });
    expect(amountFields().map((field) => field.value)).toEqual(['2', '7', '13']);
  });

  it('opens on the defaults when the link says nothing about amounts', async () => {
    // Exactly what /tip shows for the same link — the editor must not open on
    // an empty form and then silently delete the chips a visitor can see.
    await renderSettings();
    expect(amountFields().map((field) => field.value)).toEqual(['5', '25', '100']);
  });

  it('opens on an empty form when the link explicitly carries no amounts', async () => {
    await renderSettings({ amounts: '' });

    expect(amountFields()).toHaveLength(0);
    expect(screen.getByText(/No suggested amounts/i)).toBeTruthy();
  });

  it('drops amounts the tip page would have dropped anyway', async () => {
    await renderSettings({ amounts: '5,abc,0,25' });
    expect(amountFields().map((field) => field.value)).toEqual(['5', '25']);
  });
});

describe('settings page — editing', () => {
  it('rewrites the link as an amount is changed', async () => {
    const user = userEvent.setup();
    await renderSettings({ amounts: '5,25' });

    await retype(user, amountFields()[0], '7');
    expect(shownAmounts()).toBe('7,25');
  });

  it('adds an empty row that stays out of the link until it is filled in', async () => {
    const user = userEvent.setup();
    await renderSettings({ amounts: '5' });

    await user.click(addButton());

    expect(amountFields()).toHaveLength(2);
    expect(shownAmounts()).toBe('5');

    await user.type(amountFields()[1], '50');
    expect(shownAmounts()).toBe('5,50');
  });

  it('removes the row that was asked for, not the last one', async () => {
    const user = userEvent.setup();
    await renderSettings({ amounts: '5,25,100' });

    await user.click(screen.getByRole('button', { name: 'Remove amount 2' }));

    expect(amountFields().map((field) => field.value)).toEqual(['5', '100']);
    expect(shownAmounts()).toBe('5,100');
  });

  it('renumbers the remaining rows after a removal', async () => {
    const user = userEvent.setup();
    await renderSettings({ amounts: '5,25,100' });

    await user.click(screen.getByRole('button', { name: 'Remove amount 1' }));

    expect(screen.getByLabelText('Amount 1')).toHaveProperty('value', '25');
    expect(screen.getByLabelText('Amount 2')).toHaveProperty('value', '100');
    expect(screen.queryByLabelText('Amount 3')).toBeNull();
  });

  it('removing every amount produces a link that means "no chips"', async () => {
    const user = userEvent.setup();
    await renderSettings({ amounts: '5,25' });

    await user.click(screen.getByRole('button', { name: 'Remove amount 2' }));
    await user.click(screen.getByRole('button', { name: 'Remove amount 1' }));

    expect(screen.getByText(/No suggested amounts/i)).toBeTruthy();
    expect(shownAmounts()).toBe('');
    // Not merely absent: an absent param would hand the defaults straight
    // back on the next page load.
    expect(shownLink()).toContain('&amounts=');
  });

  it('restores the defaults on request, replacing whatever was there', async () => {
    const user = userEvent.setup();
    await renderSettings({ amounts: '1,2' });

    await user.click(defaultsButton());

    expect(amountFields().map((field) => field.value)).toEqual(['5', '25', '100']);
    expect(shownAmounts()).toBe('5,25,100');
  });

  it('offers the defaults as a way back out of an empty form', async () => {
    const user = userEvent.setup();
    await renderSettings({ amounts: '' });

    await user.click(defaultsButton());
    expect(shownAmounts()).toBe('5,25,100');
  });

  it('stops offering new rows at the maximum', async () => {
    const user = userEvent.setup();
    await renderSettings({ amounts: '1,2,3,4' });

    expect((addButton() as HTMLButtonElement).disabled).toBe(false);
    await user.click(addButton());

    expect(amountFields()).toHaveLength(5);
    expect((addButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/That's the maximum of 5/)).toBeTruthy();
  });

  it('takes a row back off the cap when one is removed', async () => {
    const user = userEvent.setup();
    await renderSettings({ amounts: '1,2,3,4,5' });

    expect((addButton() as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Remove amount 5' }));
    expect((addButton() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('settings page — validation', () => {
  it('explains a bad amount in place and keeps it out of the link', async () => {
    const user = userEvent.setup();
    await renderSettings({ amounts: '5,25' });

    await retype(user, amountFields()[1], 'lots');

    expect(screen.getByText('Numbers only — for example 25 or 2.5.')).toBeTruthy();
    expect(amountFields()[1].getAttribute('aria-invalid')).toBe('true');
    expect(shownAmounts()).toBe('5');
  });

  it('points the error message at the field it belongs to', async () => {
    const user = userEvent.setup();
    await renderSettings({ amounts: '5' });

    await retype(user, amountFields()[0], '0');

    const field = amountFields()[0];
    const described = document.getElementById(field.getAttribute('aria-describedby')!);
    expect(described!.textContent).toBe('Must be more than zero.');
  });

  it('says nothing about a row that has only just been added', async () => {
    const user = userEvent.setup();
    await renderSettings({ amounts: '5' });

    await user.click(addButton());

    expect(amountFields()[1].getAttribute('aria-invalid')).toBe('false');
    expect(screen.queryByText(/Numbers only/)).toBeNull();
  });

  it('clears the error as soon as the value is fixed', async () => {
    const user = userEvent.setup();
    await renderSettings({ amounts: '5' });

    await retype(user, amountFields()[0], 'x');
    expect(screen.getByText(/Numbers only/)).toBeTruthy();

    await retype(user, amountFields()[0], '9');
    expect(screen.queryByText(/Numbers only/)).toBeNull();
    expect(shownAmounts()).toBe('9');
  });

  it('collapses a duplicate rather than emitting the same chip twice', async () => {
    const user = userEvent.setup();
    await renderSettings({ amounts: '5,25' });

    await retype(user, amountFields()[1], '5.0');
    expect(shownAmounts()).toBe('5');
  });
});

describe('settings page — the link it hands back', () => {
  it('produces a link /tip parses back to what the editor shows', async () => {
    const user = userEvent.setup();
    await renderSettings({ amounts: '5' });

    await user.click(addButton());
    await user.type(amountFields()[1], '42');

    // The parser /tip uses, not a restatement of it.
    expect(parseSuggestedAmounts(shownAmounts())).toEqual(['5', '42']);
  });

  it('previews the page root-relatively, so no origin reaches the href', async () => {
    await renderSettings({ amounts: '5' });
    expect(previewLink().getAttribute('href')).toBe(`/tip?dest=${DEST}&amounts=5`);
  });

  it('copies the absolute URL, which is what goes in a bio', async () => {
    const user = userEvent.setup();
    await renderSettings({ amounts: '5' });

    await user.click(copyButton());

    expect(await navigator.clipboard.readText()).toBe(
      `${ORIGIN}/tip?dest=${DEST}&amounts=5`,
    );
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
  });

  it('opens the preview in a new tab without leaking the opener', async () => {
    await renderSettings();

    expect(previewLink().getAttribute('target')).toBe('_blank');
    expect(previewLink().getAttribute('rel')).toContain('noopener');
  });
});

describe('settings page — preview of the chips', () => {
  it('shows the amounts as the tip page will render them', async () => {
    await renderSettings({ amounts: '5,25' });

    const preview = screen.getByLabelText('Preview');
    expect(within(preview).getByText('5 XLM')).toBeTruthy();
    expect(within(preview).getByText('25 XLM')).toBeTruthy();
  });

  it('keeps the "Other" chip, which exists whatever the amounts are', async () => {
    await renderSettings({ amounts: '' });

    const preview = screen.getByLabelText('Preview');
    expect(within(preview).getByText('Other')).toBeTruthy();
    expect(within(preview).queryByText(/XLM/)).toBeNull();
  });

  it('labels the chips with a credit asset code rather than XLM', async () => {
    await renderSettings({ asset: `USDC:${USDC_ISSUER}`, amounts: '5' });

    const preview = screen.getByLabelText('Preview');
    expect(within(preview).getByText('5 USDC')).toBeTruthy();
  });

  it('follows an edit immediately', async () => {
    const user = userEvent.setup();
    await renderSettings({ amounts: '5' });

    await retype(user, amountFields()[0], '11');

    const preview = screen.getByLabelText('Preview');
    expect(within(preview).getByText('11 XLM')).toBeTruthy();
    expect(within(preview).queryByText('5 XLM')).toBeNull();
  });
});
