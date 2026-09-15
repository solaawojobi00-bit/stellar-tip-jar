'use client';

/**
 * Interactive half of the tip page: branding, QR, amount selection, wallet
 * hand-off, the live running total, and the post-send screen.
 *
 * Validation and parsing stay in the server component — an invalid link should
 * render its error without waiting for JavaScript. Everything here needs either
 * a click or the network, so it lives on the client.
 *
 * Visual language follows the "Organic" design handoff; every colour, radius
 * and shadow comes from a `jar-*` token in globals.css rather than a literal.
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

/**
 * The "Other" chip is a selection, not an amount: picking it means "I'll type
 * my own figure in the wallet", so the pay URI carries no `amount` at all.
 */
const OTHER = 'Other';

export interface TipJarProps {
  dest: string;
  asset: Asset;
  amounts: string[];
  name?: string;
  msg?: string;
  /** Block-explorer account URL, resolved server-side for the right network. */
  explorerUrl: string;
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

/**
 * Shorten a strkey for display. The full value stays in the button's title and
 * is what actually gets copied — this is only to keep the address on one line.
 */
export function truncateAddress(dest: string): string {
  return dest.length <= 20 ? dest : `${dest.slice(0, 8)}…${dest.slice(-8)}`;
}

/** The tip-jar mark. Shared by the header and the post-send screen. */
function JarMark({ size, withLid = false }: { size: number; withLid?: boolean }) {
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} fill="none" aria-hidden="true">
      {withLid ? <circle cx="48" cy="14" r="8" fill="#8fa073" /> : null}
      <path
        d="M22 40 h52 a6 6 0 0 1 6 6 v24 a18 18 0 0 1 -18 18 h-28 a18 18 0 0 1 -18 -18 v-24 a6 6 0 0 1 6 -6 z"
        fill="#c67139"
      />
      <rect x="18" y="32" width="60" height="10" rx="5" fill="#b2622d" />
    </svg>
  );
}

function BrandRow() {
  return (
    <div className="flex items-center gap-2.5">
      <JarMark size={30} />
      <span className="flex flex-col leading-none">
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-jar-moss-700">
          stellar
        </span>
        <span className="font-display text-[19px] text-jar-clay-800">tip jar</span>
      </span>
    </div>
  );
}

function RunningTotal({
  state,
  asset,
  explorerUrl,
}: {
  state: TotalState;
  asset: Asset;
  explorerUrl: string;
}) {
  if (state.status === 'loading') {
    return (
      <p aria-live="polite" className="text-sm text-jar-sand-600">
        Loading total…
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <p aria-live="polite" className="text-sm text-jar-sand-600">
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
        className="rounded-jar-lg border-2 border-jar-clay-300 bg-jar-clay-100 px-4 py-3 text-sm text-jar-clay-800"
      >
        This address hasn&apos;t been funded on-chain yet. Tips will still arrive, but the account
        must be created by its first payment.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-jar-lg bg-jar-surface p-[18px]">
      <p aria-live="polite" className="flex flex-wrap items-baseline gap-2">
        <span className="font-display text-[27px] leading-none text-jar-clay-800">
          {formatTotal(state.total)} {assetLabel(asset)}
        </span>
        <span className="text-sm text-jar-sand-800">
          in the jar, across {state.count} {state.count === 1 ? 'tip' : 'tips'}
        </span>
      </p>
      <p className="flex items-center gap-2 text-[13px] text-jar-sand-700">
        <span
          aria-hidden="true"
          className="h-2 w-2 flex-none rounded-full bg-jar-moss-600"
        />
        <span>
          Read live from the public ledger ·{' '}
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-jar-clay-700 underline underline-offset-[3px] hover:text-jar-clay-800"
          >
            verify on-chain
          </a>
        </span>
      </p>
    </div>
  );
}

export default function TipJar({
  dest,
  asset,
  amounts,
  name,
  msg,
  explorerUrl,
}: TipJarProps) {
  const [selectedAmount, setSelectedAmount] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);
  const [sent, setSent] = useState(false);
  const [total, setTotal] = useState<TotalState>({ status: 'loading' });
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const who = name ?? 'this creator';
  // "Other" means an open amount, so it never reaches the URI.
  const payAmount = selectedAmount === OTHER ? null : selectedAmount;
  const unit = assetLabel(asset);

  // Rebuilt on every amount change so the QR and the wallet link can never
  // disagree about what is being paid.
  const payUri = buildPayUri({
    destination: dest,
    asset,
    amount: payAmount ?? undefined,
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
      if (addressTimer.current) clearTimeout(addressTimer.current);
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

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(dest);
      setAddressCopied(true);
      if (addressTimer.current) clearTimeout(addressTimer.current);
      addressTimer.current = setTimeout(() => setAddressCopied(false), 2000);
    } catch {
      setAddressCopied(false);
    }
  }

  if (sent) {
    return (
      <section
        aria-label="Payment handed off"
        className="flex flex-1 flex-col items-center justify-center gap-6 text-center"
      >
        <div className="flex h-26 w-26 animate-jarpop items-center justify-center rounded-full bg-jar-moss-200">
          <JarMark size={58} withLid />
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="font-display text-[30px] leading-tight text-jar-clay-800">
            Thanks for sending it!
          </h2>
          <p className="max-w-[290px] text-[15px] leading-relaxed text-jar-sand-800">
            {payAmount
              ? `Once you finish the ${payAmount} ${unit} payment in your wallet, it goes straight to ${who} — nothing passes through us.`
              : `Once you finish the payment in your wallet, it goes straight to ${who} — nothing passes through us.`}
          </p>
        </div>

        <div className="flex w-full max-w-[280px] flex-col gap-2.5">
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="block rounded-full bg-jar-clay px-4 py-3.5 text-[15px] font-bold text-jar-clay-100 hover:bg-jar-clay-600"
          >
            Check {who}&apos;s jar on the ledger
          </a>
          <button
            type="button"
            onClick={() => {
              setSent(false);
              setSelectedAmount(null);
              setAddressCopied(false);
            }}
            className="rounded-full border-2 border-jar-sand-300 px-4 py-3.5 text-[15px] font-semibold text-jar-sand-800 hover:bg-jar-sand-200"
          >
            Back to {who}&apos;s jar
          </button>
        </div>

        {/* The honest bit: this app builds a link and never watches the network,
            so it cannot claim the payment happened. */}
        <p className="max-w-[300px] text-[12.5px] leading-relaxed text-jar-sand-700">
          We can&apos;t confirm the payment — this page only builds the link and hands it to your
          wallet. The ledger is the only place a real answer lives.
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-[22px]">
      <BrandRow />

      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-[31px] leading-tight text-jar-ink">Tip {who}</h1>
        {msg ? <p className="text-[15px] leading-normal text-jar-sand-800">{msg}</p> : null}
      </div>

      <section
        aria-label="Payment code"
        className="flex flex-col items-center gap-2 self-center rounded-[20px] bg-white p-3.5 shadow-jar-sm"
      >
        <QRCodeSVG
          value={payUri}
          size={168}
          marginSize={2}
          // Named so tests and screen readers agree on what this encodes.
          title={`Stellar payment code for ${dest}`}
          className="h-auto w-full max-w-[168px]"
        />
        <span className="text-[11px] text-jar-sand-600">
          {payAmount ? `Scan to send ${payAmount} ${unit}` : 'Scan with any Stellar wallet'}
        </span>
      </section>

      {amounts.length > 0 ? (
        <section aria-label="Suggested amounts" className="flex flex-col gap-2.5">
          <span className="text-xs font-bold uppercase tracking-[0.12em] text-jar-sand-700">
            Pick an amount
          </span>
          <div className="grid grid-cols-2 gap-2.5">
            {[...amounts, OTHER].map((amount) => {
              const isSelected = selectedAmount === amount;
              return (
                <button
                  key={amount}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedAmount(isSelected ? null : amount)}
                  className={`rounded-[18px] border-2 px-2 py-[15px] text-base font-bold transition-colors ${
                    isSelected
                      ? 'border-jar-clay bg-jar-clay text-jar-clay-100'
                      : 'border-jar-sand-300 text-jar-sand-900 hover:border-jar-sand-500'
                  }`}
                >
                  {amount === OTHER ? OTHER : `${amount} ${unit}`}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <a
        href={payUri}
        onClick={() => setSent(true)}
        className="block rounded-full bg-jar-clay px-4 py-4 text-center text-[16.5px] font-bold text-jar-clay-100 shadow-jar-md hover:bg-jar-clay-600"
      >
        {payAmount ? `Send ${payAmount} ${unit}` : 'Open in wallet'}
      </a>

      <RunningTotal state={total} asset={asset} explorerUrl={explorerUrl} />

      <section aria-label="Destination" className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-[0.12em] text-jar-sand-700">
          Goes straight to
        </span>
        <button
          type="button"
          onClick={copyAddress}
          title={dest}
          className={`rounded-jar-md border-2 px-4 py-3 text-left font-mono text-[13px] text-jar-sand-900 transition-colors ${
            addressCopied
              ? 'border-jar-moss-500 bg-jar-moss-100'
              : 'border-jar-sand-300 hover:border-jar-sand-500'
          }`}
        >
          {addressCopied ? 'Address copied' : truncateAddress(dest)}
        </button>
        <p className="text-[12.5px] leading-normal text-jar-sand-700">
          Your wallet pays {who}&apos;s address directly. We never hold, route, or touch the money.
        </p>
      </section>

      <button
        type="button"
        onClick={copyLink}
        className="rounded-full border-2 border-jar-sand-300 px-4 py-3 text-center text-sm font-semibold text-jar-sand-800 hover:bg-jar-sand-200"
      >
        {copied ? 'Link copied' : 'Copy link'}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Link copied to clipboard' : ''}
      </span>

      <div className="flex gap-3.5 pt-1 text-xs text-jar-sand-600">
        <a
          href="https://stellar.org/learn/intro-to-stellar"
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-[3px] hover:text-jar-clay-700"
        >
          What is XLM?
        </a>
        <a
          href="https://github.com/solaawojobi00-bit/stellar-tip-jar"
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-[3px] hover:text-jar-clay-700"
        >
          Open source
        </a>
      </div>
    </div>
  );
}
