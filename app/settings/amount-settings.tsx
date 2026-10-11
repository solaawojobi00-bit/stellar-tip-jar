'use client';

/**
 * The Settings editor for a jar's suggested amounts.
 *
 * Until a jar has somewhere to be stored (#34), its settings *are* its link —
 * so this screen reads the current configuration out of the query string,
 * edits it with real controls, and writes a new link back out. The creator
 * never has to know that `amounts=5,25,100` was ever a thing they could type.
 *
 * One row per amount, each individually valid or not, because a single
 * comma-separated field can only say "something in here is wrong". Everything
 * the link carries that is not an amount — name, asset, message — rides
 * through untouched: this screen configures amounts and nothing else.
 *
 * Visual language follows the "Organic" design handoff; every colour, radius
 * and shadow comes from a `jar-*` token in globals.css rather than a literal.
 */

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  DEFAULT_SUGGESTED_AMOUNTS,
  MAX_SUGGESTED_AMOUNTS,
  amountError,
  normaliseAmounts,
} from '@/lib/amounts';
import { assetLabel, type Asset } from '@/lib/sep7';

/** How long the copy button stays in its confirmation state. */
const COPIED_MS = 2000;

/** The jar this screen configures, as the tip link describes it. */
export interface JarConfig {
  dest: string;
  asset: Asset;
  name?: string;
  msg?: string;
}

/**
 * A built link, split where the display colours it: the fixed prefix, the
 * address itself, and the optional tail. Joined, those are `href`.
 */
export interface LinkParts {
  prefix: string;
  dest: string;
  rest: string;
  /** Absolute URL, for the clipboard. A relative path in a bio is useless. */
  href: string;
  /** The same link, root-relative, for navigating inside this deployment. */
  path: string;
}

/**
 * Assemble the tip link these settings describe.
 *
 * `amounts` is always written, even when empty. The tip page falls back to the
 * defaults only for an *absent* param, so a creator who deletes every row has
 * to be able to say "none" — and `amounts=` is how a link says it. Writing the
 * param unconditionally also means the link states its own configuration
 * rather than inheriting whatever the default happens to be next release.
 *
 * Every interpolated value goes through encodeURIComponent, including the
 * address: the structure here is literal, and everything filled into it is
 * escaped on the spot rather than trusted from several calls away.
 */
export function buildConfiguredLink(
  origin: string,
  config: JarConfig,
  amounts: readonly string[],
): LinkParts {
  const { dest, asset, name, msg } = config;

  let rest = '';
  if (name) rest += `&name=${encodeURIComponent(name)}`;
  if (asset.kind === 'credit') {
    rest += `&asset=${encodeURIComponent(`${asset.code}:${asset.issuer}`)}`;
  }
  rest += `&amounts=${amounts.map(encodeURIComponent).join(',')}`;
  if (msg) rest += `&msg=${encodeURIComponent(msg)}`;

  const path = `/tip?dest=${encodeURIComponent(dest)}${rest}`;
  return { prefix: `${origin}/tip?dest=`, dest, rest, href: `${origin}${path}`, path };
}

/**
 * The page's own origin, read through useSyncExternalStore so the server and
 * the first client render agree: "" on the server, the real origin once
 * hydrated. The origin never changes, so subscribing is a no-op.
 */
const subscribeToNothing = () => () => {};
const readOrigin = () => window.location.origin;
const readNoOrigin = () => '';

/** One editable row. The id is a stable React key across insert and remove. */
interface AmountRow {
  id: number;
  value: string;
}

function rowsFrom(values: readonly string[], firstId: number): AmountRow[] {
  return values.map((value, index) => ({ id: firstId + index, value }));
}

/** The tip-jar mark, matching the visitor page and the builder. */
function JarMark({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} fill="none" aria-hidden="true">
      <path
        d="M22 40 h52 a6 6 0 0 1 6 6 v24 a18 18 0 0 1 -18 18 h-28 a18 18 0 0 1 -18 -18 v-24 a6 6 0 0 1 6 -6 z"
        fill="#c67139"
      />
      <rect x="18" y="32" width="60" height="10" rx="5" fill="#b2622d" />
    </svg>
  );
}

const FIELD_LABEL = 'text-xs font-bold uppercase tracking-[0.12em] text-jar-sand-700';
/** One focus treatment for every control on the page, per the handoff. */
const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jar-clay';
const SECONDARY_BUTTON =
  `rounded-full border-2 border-jar-sand-300 px-[18px] py-2.5 text-[14px] font-semibold text-jar-sand-800 disabled:opacity-45 enabled:hover:bg-jar-sand-200 ${FOCUS_RING}`;

export default function AmountSettings({
  config,
  initialAmounts,
}: {
  config: JarConfig;
  initialAmounts: string[];
}) {
  const [rows, setRows] = useState<AmountRow[]>(() => rowsFrom(initialAmounts, 0));
  const [copied, setCopied] = useState(false);
  const nextId = useRef(initialAmounts.length);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useSyncExternalStore(subscribeToNothing, readOrigin, readNoOrigin);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const unit = assetLabel(config.asset);
  const amounts = normaliseAmounts(rows.map((row) => row.value));
  const link = buildConfiguredLink(origin, config, amounts);
  const full = rows.length >= MAX_SUGGESTED_AMOUNTS;

  function claimIds(count: number): number {
    const first = nextId.current;
    nextId.current += count;
    return first;
  }

  function addRow() {
    if (full) return;
    setRows((current) => [...current, { id: claimIds(1), value: '' }]);
  }

  function updateRow(id: number, value: string) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, value } : row)));
  }

  function removeRow(id: number) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  function useDefaults() {
    setRows(rowsFrom(DEFAULT_SUGGESTED_AMOUNTS, claimIds(DEFAULT_SUGGESTED_AMOUNTS.length)));
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link.href);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-[26px] rounded-jar-lg bg-jar-bg px-9 pt-10 pb-[34px] shadow-jar-lg">
      <div className="flex items-center gap-2.5">
        <JarMark size={30} />
        <span className="flex flex-col leading-none">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-jar-moss-700">
            stellar
          </span>
          <span className="font-display text-[19px] text-jar-clay-800">tip jar</span>
        </span>
      </div>

      <div className="flex flex-col gap-2.5">
        <h1 className="font-display text-[clamp(28px,7vw,36px)] leading-[1.1] text-jar-clay-800">
          Suggested amounts
        </h1>
        <p className="text-pretty text-[15.5px] leading-relaxed text-jar-sand-800">
          These are the chips a visitor taps on {config.name ? config.name : 'your'}
          {config.name ? "'s" : ''} tip page. Change them here — nothing is saved anywhere, so
          copy the updated link when you&apos;re done.
        </p>
      </div>

      <section aria-label="Suggested amounts" className="flex flex-col gap-3.5 rounded-jar-lg bg-jar-surface p-6">
        {rows.length === 0 ? (
          <p className="text-[14px] leading-relaxed text-jar-sand-700">
            No suggested amounts. Your tip page will show no chips at all, and every visitor types
            their own figure in their wallet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3.5">
            {rows.map((row, index) => {
              const error = amountError(row.value);
              const inputId = `amount-${row.id}`;
              const errorId = `${inputId}-error`;
              return (
                <li key={row.id} className="flex flex-col gap-[7px]">
                  <label htmlFor={inputId} className={FIELD_LABEL}>
                    Amount {index + 1}
                  </label>
                  <div className="flex items-center gap-2.5">
                    <div className="relative flex-1">
                      <input
                        id={inputId}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="25"
                        value={row.value}
                        onChange={(event) => updateRow(row.id, event.target.value)}
                        aria-invalid={error !== null}
                        aria-describedby={error ? errorId : undefined}
                        className={`w-full rounded-full border-2 bg-white py-[13px] pl-[18px] pr-14 text-[15px] text-jar-sand-900 outline-none ${FOCUS_RING} ${
                          error ? 'border-jar-clay-400' : 'border-jar-sand-300'
                        }`}
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 right-[18px] flex items-center text-[13px] font-semibold text-jar-sand-600"
                      >
                        {unit}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      aria-label={`Remove amount ${index + 1}`}
                      className={`rounded-full border-2 border-jar-sand-300 px-3.5 py-2.5 text-[13px] font-semibold text-jar-sand-800 hover:border-jar-clay-400 hover:text-jar-clay-700 ${FOCUS_RING}`}
                    >
                      Remove
                    </button>
                  </div>
                  {error ? (
                    <span id={errorId} className="text-[12.5px] leading-snug text-jar-clay-700">
                      {error}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <button type="button" onClick={addRow} disabled={full} className={SECONDARY_BUTTON}>
            Add amount
          </button>
          <button type="button" onClick={useDefaults} className={SECONDARY_BUTTON}>
            Use defaults
          </button>
          <span className="text-[12.5px] text-jar-sand-700">
            {full
              ? `That's the maximum of ${MAX_SUGGESTED_AMOUNTS}.`
              : `Up to ${MAX_SUGGESTED_AMOUNTS}.`}
          </span>
        </div>
      </section>

      <section aria-label="Preview" className="flex flex-col gap-3.5">
        <span className={FIELD_LABEL}>How it will look</span>
        <div className="grid grid-cols-2 gap-2.5 rounded-jar-md bg-white p-[18px]">
          {[...amounts, 'Other'].map((amount) => (
            <span
              key={amount}
              className="rounded-[18px] border-2 border-jar-sand-300 px-2 py-[15px] text-center text-base font-bold text-jar-sand-900"
            >
              {amount === 'Other' ? 'Other' : `${amount} ${unit}`}
            </span>
          ))}
        </div>
      </section>

      <div className="flex flex-col gap-3.5">
        <span className={FIELD_LABEL}>Your updated link</span>
        <div className="break-all rounded-jar-md bg-white px-[18px] py-4 font-mono text-[13px] leading-[1.65]">
          <span className="text-jar-sand-700">{link.prefix}</span>
          <span className="font-medium text-jar-clay-700">{link.dest}</span>
          <span className="text-jar-moss-700">{link.rest}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={copyLink}
            className={`rounded-full px-[26px] py-[15px] text-[15.5px] font-bold text-jar-clay-100 shadow-jar-md ${FOCUS_RING} ${
              copied ? 'bg-jar-moss-600' : 'bg-jar-clay hover:bg-jar-clay-600'
            }`}
          >
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          <a
            href={link.path}
            target="_blank"
            rel="noreferrer noopener"
            className={`rounded-full border-2 border-jar-sand-300 px-[22px] py-[13px] text-[15px] font-semibold text-jar-sand-800 hover:bg-jar-sand-200 ${FOCUS_RING}`}
          >
            Preview page
          </a>
        </div>
        <span aria-live="polite" className="sr-only">
          {copied ? 'Link copied to clipboard' : ''}
        </span>
      </div>

      <p className="border-t border-jar-sand-300 pt-[18px] text-[13px] leading-relaxed text-jar-sand-700">
        Phase 1 has no accounts and no database, so these settings live in the link itself. Copy it
        and replace the one in your bio — the old link keeps working with its old amounts.{' '}
        <Link
          href="/"
          className="text-jar-clay-700 underline underline-offset-[3px] hover:text-jar-clay-800"
        >
          Build a different jar
        </Link>
        .
      </p>
    </div>
  );
}
