'use client';

/**
 * The homepage tip-link builder.
 *
 * The product is a link, so the homepage builds one. Paste an address, get a
 * shareable `/tip?…` URL — no signup, no account, no round trip.
 *
 * Everything here happens in the browser: the address is checked with the same
 * `lib/strkey.ts` the server uses, and the link is assembled locally. Nothing
 * typed into this page is ever sent anywhere, which is the point — the whole
 * site never sees a creator's address unless a visitor opens their link.
 *
 * Visual language follows the "Organic" design handoff; every colour, radius
 * and shadow comes from a `jar-*` token in globals.css rather than a literal.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { parseSuggestedAmounts } from '@/lib/sep7';
import { isValidDestination } from '@/lib/strkey';

const REPO_URL = 'https://github.com/solaawojobi00-bit/stellar-tip-jar';

/**
 * How many suggested amounts a built link carries. The tip page imposes no
 * limit, but past a handful the chips stop being a shortcut and start being a
 * menu, so the builder declines to generate more.
 */
const MAX_SUGGESTED_AMOUNTS = 5;

/** How long the copy button stays in its confirmation state. */
const COPIED_MS = 2000;

/**
 * Suggested amounts as the builder accepts them: commas *or* spaces, because
 * "5 25 100" is what people type. Normalised to the comma-separated form and
 * then handed to the shared parser — the rules for what counts as a valid
 * amount live in lib/sep7.ts, and this must not grow a second opinion.
 */
export function parseBuilderAmounts(raw: string): string[] {
  const normalised = raw.trim().split(/[\s,]+/).filter(Boolean).join(',');
  return parseSuggestedAmounts(normalised).slice(0, MAX_SUGGESTED_AMOUNTS);
}

/**
 * A built link, split where the display colours it: the fixed prefix, the
 * address itself, and the optional tail. Joined, those are `href`.
 */
export interface LinkParts {
  /** Display prefix, origin included — what the creator reads and copies. */
  prefix: string;
  dest: string;
  rest: string;
  /** Absolute URL, for the clipboard. A relative path in a bio is useless. */
  href: string;
  /**
   * The same link, root-relative, for navigating inside this deployment.
   *
   * Kept separate from `href` so no origin read off `window` ever reaches an
   * anchor: a same-site link does not need one, and building one anyway means
   * a sandboxed or `data:` document — where `location.origin` is the string
   * "null" — would render a broken "null/tip?…" href.
   */
  path: string;
}

/**
 * Assemble the tip link. `origin` is empty until the component has mounted, so
 * `href` is root-relative until then — still correct, just not yet shareable.
 * A valid address is the caller's responsibility.
 */
export function buildTipLink(origin: string, dest: string, name: string, amounts: string[]): LinkParts {
  // Every interpolated value goes through encodeURIComponent, including the
  // address. For a checksum-valid strkey that is the identity -- base32 has
  // no characters worth escaping -- so nothing about the built link changes.
  // What changes is that the link's shape no longer depends on a guarantee
  // made several calls away in isValidDestination: the structure here is
  // literal, and everything filled into it is escaped on the spot.
  let rest = '';
  if (name) rest += `&name=${encodeURIComponent(name)}`;
  if (amounts.length) rest += `&amounts=${amounts.map(encodeURIComponent).join(',')}`;

  const path = `/tip?dest=${encodeURIComponent(dest)}${rest}`;
  return { prefix: `${origin}/tip?dest=`, dest, rest, href: `${origin}${path}`, path };
}

type DestState = 'empty' | 'valid' | 'invalid';

/** Hint, hint colour and input border for each state of the address field. */
const DEST_FEEDBACK: Record<DestState, { hint: string; hintClass: string; borderClass: string }> = {
  empty: {
    hint: 'Starts with G — copy it from your wallet.',
    hintClass: 'text-jar-sand-700',
    borderClass: 'border-jar-sand-300',
  },
  valid: {
    hint: 'Looks like a valid Stellar address.',
    hintClass: 'text-jar-moss-700',
    borderClass: 'border-jar-moss-500',
  },
  invalid: {
    hint: "That doesn't check out as a Stellar address — addresses are uppercase and start with G or M.",
    hintClass: 'text-jar-clay-700',
    borderClass: 'border-jar-clay-400',
  },
};

/**
 * The page's own origin, read through useSyncExternalStore so the server and
 * the first client render agree: "" on the server, the real origin once
 * hydrated. `window` cannot be touched during render, and guessing the
 * deployment's URL would be worse than briefly omitting it — which nobody
 * sees, because a link only appears after someone has typed into the page.
 *
 * The origin never changes, so subscribing is a no-op.
 */
const subscribeToNothing = () => () => {};
const readOrigin = () => window.location.origin;
const readNoOrigin = () => '';

/** The tip-jar mark, matching the visitor page. */
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
const OPTIONAL_TAG = 'font-semibold normal-case tracking-normal text-jar-sand-600';
/** One focus treatment for every control on the page, per the handoff. */
const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jar-clay';
const TEXT_FIELD =
  `w-full rounded-full border-2 bg-white px-[18px] py-[13px] text-[15px] text-jar-sand-900 outline-none ${FOCUS_RING}`;

export default function LinkBuilder() {
  const [dest, setDest] = useState('');
  const [name, setName] = useState('');
  const [amounts, setAmounts] = useState('');
  const [copied, setCopied] = useState(false);
  const origin = useSyncExternalStore(subscribeToNothing, readOrigin, readNoOrigin);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const trimmedDest = dest.trim();
  const state: DestState =
    trimmedDest === '' ? 'empty' : isValidDestination(trimmedDest) ? 'valid' : 'invalid';
  const valid = state === 'valid';
  const feedback = DEST_FEEDBACK[state];

  const link = buildTipLink(origin, trimmedDest, name.trim(), parseBuilderAmounts(amounts));

  async function copyLink() {
    if (!valid) return;
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
          Make your tip jar in one field
        </h1>
        <p className="text-pretty text-[15.5px] leading-relaxed text-jar-sand-800">
          Paste your Stellar address and you get a shareable link. No signup, no account, no
          database — the link <em>is</em> your tip page.
        </p>
      </div>

      <div className="flex flex-col gap-[18px] rounded-jar-lg bg-jar-surface p-6">
        <div className="flex flex-col gap-[7px]">
          <label htmlFor="builder-dest" className={FIELD_LABEL}>
            Your Stellar address
          </label>
          <input
            id="builder-dest"
            type="text"
            spellCheck={false}
            autoComplete="off"
            placeholder="G…"
            value={dest}
            onChange={(event) => setDest(event.target.value)}
            aria-describedby="builder-dest-hint"
            aria-invalid={state === 'invalid'}
            className={`w-full rounded-full border-2 bg-white px-5 py-3.5 font-mono text-[13.5px] text-jar-sand-900 outline-none ${FOCUS_RING} ${feedback.borderClass}`}
          />
          <span
            id="builder-dest-hint"
            className={`min-h-[18px] text-[12.5px] leading-snug ${feedback.hintClass}`}
          >
            {feedback.hint}
          </span>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="flex flex-col gap-[7px]">
            <label htmlFor="builder-name" className={FIELD_LABEL}>
              Your name <span className={OPTIONAL_TAG}>· optional</span>
            </label>
            <input
              id="builder-name"
              type="text"
              placeholder="Ada"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={`${TEXT_FIELD} border-jar-sand-300`}
            />
          </div>
          <div className="flex flex-col gap-[7px]">
            <label htmlFor="builder-amounts" className={FIELD_LABEL}>
              Amounts <span className={OPTIONAL_TAG}>· optional</span>
            </label>
            <input
              id="builder-amounts"
              type="text"
              inputMode="decimal"
              placeholder="5, 25, 100"
              value={amounts}
              onChange={(event) => setAmounts(event.target.value)}
              className={`${TEXT_FIELD} border-jar-sand-300`}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3.5">
        <span className={FIELD_LABEL}>Your link</span>
        <div className="break-all rounded-jar-md bg-white px-[18px] py-4 font-mono text-[13px] leading-[1.65]">
          {valid ? (
            <>
              <span className="text-jar-sand-700">{link.prefix}</span>
              <span className="font-medium text-jar-clay-700">{link.dest}</span>
              <span className="text-jar-moss-700">{link.rest}</span>
            </>
          ) : (
            <span className="font-body text-sm text-jar-sand-500">
              Paste your address above and your link appears here.
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={copyLink}
            disabled={!valid}
            className={`rounded-full px-[26px] py-[15px] text-[15.5px] font-bold text-jar-clay-100 shadow-jar-md disabled:opacity-45 ${FOCUS_RING} ${
              copied ? 'bg-jar-moss-600' : 'bg-jar-clay hover:bg-jar-clay-600'
            }`}
          >
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          <a
            href={valid ? link.path : undefined}
            target="_blank"
            rel="noreferrer noopener"
            aria-disabled={!valid}
            className={`rounded-full border-2 border-jar-sand-300 px-[22px] py-[13px] text-[15px] font-semibold text-jar-sand-800 ${FOCUS_RING} ${
              valid ? 'hover:bg-jar-sand-200' : 'opacity-45'
            }`}
          >
            Preview page
          </a>
        </div>
        <span aria-live="polite" className="sr-only">
          {copied ? 'Link copied to clipboard' : ''}
        </span>
      </div>

      <p className="border-t border-jar-sand-300 pt-[18px] text-[13px] leading-relaxed text-jar-sand-700">
        Payments go wallet to wallet, straight to the address in your link. This site never holds,
        routes or touches the money — it builds a payment link and hands it to a wallet.{' '}
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="text-jar-clay-700 underline underline-offset-[3px] hover:text-jar-clay-800"
        >
          Read the code
        </a>
        .
      </p>
    </div>
  );
}
