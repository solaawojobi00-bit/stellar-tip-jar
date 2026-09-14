/**
 * Minimal vendored SEP-0007 `pay` URI builder.
 *
 * Replace with a dependency on stellar-pay-links once that package is
 * published, rather than maintaining both. See ARCHITECTURE.md.
 */

import { isValidDestination, isValidStrkeyOfType } from './strkey';

export const SEP7_SCHEME = 'web+stellar';

/**
 * An asset to be paid. `native` is XLM; a credit asset carries both code and
 * issuer, which are never separated — an asset code alone is ambiguous across
 * issuers, and conflating them is an explicit PRD risk.
 */
export type Asset = { kind: 'native' } | { kind: 'credit'; code: string; issuer: string };

export const NATIVE: Asset = { kind: 'native' };

export interface PayUriOptions {
  /** `G...` or `M...` destination address. */
  destination: string;
  asset?: Asset;
  /** Decimal string, e.g. "10" or "2.5000000". Omitted for an open amount. */
  amount?: string;
  memo?: string;
  memoType?: 'MEMO_TEXT' | 'MEMO_ID' | 'MEMO_HASH' | 'MEMO_RETURN';
  /** Short note shown by the wallet to the payer. */
  msg?: string;
}

/**
 * Parse the `asset` query param. Accepts `native` (or empty/absent) and
 * `CODE:ISSUER`. Returns null when the value is present but malformed, so the
 * caller can show an error rather than silently falling back to XLM.
 */
export function parseAsset(raw: string | null | undefined): Asset | null {
  if (raw === null || raw === undefined || raw === '' || raw === 'native') {
    return NATIVE;
  }

  const separator = raw.indexOf(':');
  if (separator === -1) return null;

  const code = raw.slice(0, separator);
  const issuer = raw.slice(separator + 1);

  if (!/^[A-Za-z0-9]{1,12}$/.test(code)) return null;
  if (!isValidStrkeyOfType(issuer, 'ed25519PublicKey')) return null;

  return { kind: 'credit', code, issuer };
}

/** Human label for an asset — the code alone for display next to a total. */
export function assetLabel(asset: Asset): string {
  return asset.kind === 'native' ? 'XLM' : asset.code;
}

/**
 * Build a SEP-0007 `pay` URI.
 *
 * Throws on an invalid destination: by the time a URI is built the address has
 * already been validated for display, so reaching here with a bad one is a bug,
 * not user input.
 */
export function buildPayUri(options: PayUriOptions): string {
  const { destination, asset = NATIVE, amount, memo, memoType, msg } = options;

  if (!isValidDestination(destination)) {
    throw new Error(`Invalid SEP-0007 destination: ${destination}`);
  }

  const params = new URLSearchParams();
  params.set('destination', destination);

  if (asset.kind === 'credit') {
    params.set('asset_code', asset.code);
    params.set('asset_issuer', asset.issuer);
  }

  if (amount !== undefined && amount !== '') params.set('amount', amount);
  if (memo !== undefined && memo !== '') params.set('memo', memo);
  if (memoType !== undefined) params.set('memo_type', memoType);
  if (msg !== undefined && msg !== '') params.set('msg', msg);

  return `${SEP7_SCHEME}:pay?${params.toString()}`;
}

/**
 * Parse the `amounts` query param ("5,10,25") into suggested amounts.
 * Invalid entries are dropped rather than failing the page — a typo in one
 * suggestion should not take down a working tip jar.
 */
export function parseSuggestedAmounts(raw: string | null | undefined): string[] {
  if (!raw) return [];

  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^\d+(\.\d{1,7})?$/.test(part) && Number(part) > 0);
}
