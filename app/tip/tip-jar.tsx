'use client';

/**
 * Interactive half of the tip page: QR, amount selection, copy/wallet buttons
 * and the live running total.
 *
 * Validation and parsing stay in the server component — an invalid link should
 * render its error without waiting for JavaScript. Everything here needs either
 * a click or the network, so it lives on the client.
 */

import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';

import { assetLabel, buildPayUri, type Asset } from '@/lib/sep7';

/** Response shape of /api/total. Kept in step with app/api/total/route.ts. */
interface TotalResponse {
  dest: string;
  asset: string;
  total: string;
  count: number;
  funded: boolean;
  truncated: boolean;
}

type TotalState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; total: string; count: number; funded: boolean };

export interface TipJarProps {
  dest: string;
  asset: Asset;
  amounts: string[];
  msg?: string;
}

/** `asset` as /api/total expects it. */
function assetParam(asset: Asset): string {
  return asset.kind === 'native' ? 'native' : `${asset.code}:${asset.issuer}`;
}

/**
 * Trim the trailing zeros off Horizon's 7-decimal form for display only.
 * "23192.9749800" reads better as "23192.97498", and "0.0000000" as "0".
 * The wire format is left alone — this is presentation.
 */
export function formatTotal(total: string): string {
  if (!total.includes('.')) return total;
  const trimmed = total.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' ? '0' : trimmed;
}

function RunningTotal({ state, asset }: { state: TotalState; asset: Asset }) {
  if (state.status === 'loading') {
    return (
      <p aria-live="polite" className="text-sm text-neutral-500">
        Loading total…
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <p aria-live="polite" className="text-sm text-neutral-500">
        Couldn&apos;t load the running total right now.
      </p>
    );
  }

  // An address with no account yet is not the same as one that exists and has
  // received nothing — showing a bare "0" for it would imply the jar works.
  if (!state.funded) {
    return (
      <p
        aria-live="polite"
        role="status"
        className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
      >
        This address hasn&apos;t been funded on-chain yet. Tips will still arrive, but the account
        must be created by its first payment.
      </p>
    );
  }

  return (
    <p aria-live="polite" className="text-sm text-neutral-600 dark:text-neutral-400">
      <span className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        {formatTotal(state.total)} {assetLabel(asset)}
      </span>{' '}
      received across {state.count} {state.count === 1 ? 'tip' : 'tips'}
    </p>
  );
}

export default function TipJar({ dest, asset, amounts, msg }: TipJarProps) {
  const [selectedAmount, setSelectedAmount] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [total, setTotal] = useState<TotalState>({ status: 'loading' });
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rebuilt on every amount change so the QR and the wallet link can never
  // disagree about what is being paid.
  const payUri = buildPayUri({
    destination: dest,
    asset,
    amount: selectedAmount ?? undefined,
    msg,
  });

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const params = new URLSearchParams({ dest, asset: assetParam(asset) });
        const response = await fetch(`/api/total?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          setTotal({ status: 'error' });
          return;
        }

        const body = (await response.json()) as TotalResponse;
        setTotal({
          status: 'loaded',
          total: body.total,
          count: body.count,
          funded: body.funded,
        });
      } catch {
        // An aborted request is a unmount, not a failure worth showing.
        if (!controller.signal.aborted) setTotal({ status: 'error' });
      }
    }

    void load();
    return () => controller.abort();
  }, [dest, asset]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  async function copyLink() {
    try {
      // The shareable thing is the page, not the pay URI — a pay URI pasted
      // into a bio does nothing for anyone without a wallet handler.
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <section aria-label="Payment code" className="flex justify-center">
        <QRCodeSVG
          value={payUri}
          size={220}
          marginSize={2}
          // Named so tests and screen readers agree on what this encodes.
          title={`Stellar payment code for ${dest}`}
          className="h-auto w-full max-w-[220px] rounded-lg bg-white p-2"
        />
      </section>

      {amounts.length > 0 ? (
        <section aria-label="Suggested amounts" className="flex flex-wrap justify-center gap-2">
          {amounts.map((amount) => {
            const isSelected = selectedAmount === amount;
            return (
              <button
                key={amount}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedAmount(isSelected ? null : amount)}
                className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                  isSelected
                    ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
                    : 'border-neutral-300 hover:border-neutral-500 dark:border-neutral-700'
                }`}
              >
                {amount} {assetLabel(asset)}
              </button>
            );
          })}
        </section>
      ) : null}

      <RunningTotal state={total} asset={asset} />

      <section aria-label="Destination" className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-neutral-500">Destination</span>
        <code className="break-all text-xs">{dest}</code>
      </section>

      <div className="flex flex-col gap-2">
        <a
          href={payUri}
          className="rounded-lg bg-neutral-900 px-4 py-3 text-center text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
        >
          Open in wallet
        </a>

        <button
          type="button"
          onClick={copyLink}
          className="rounded-lg border border-neutral-300 px-4 py-3 text-center text-sm font-medium dark:border-neutral-700"
        >
          {copied ? 'Link copied' : 'Copy link'}
        </button>
        <span aria-live="polite" className="sr-only">
          {copied ? 'Link copied to clipboard' : ''}
        </span>
      </div>
    </>
  );
}
