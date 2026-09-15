/**
 * Landing page.
 *
 * Phase 1 has no accounts and no database, so there is no "my jar" to show
 * here. This page's only job is to explain what the product is, show the
 * shape of a tip link, and get out of the way.
 *
 * Static content only — no data fetching, no claim flow.
 */

import Link from 'next/link';

import { DEFAULT_HORIZON_URL } from '@/lib/horizon';

const REPO_URL = 'https://github.com/solaawojobi00-bit/stellar-tip-jar';

/**
 * A funded testnet account, used for the live example link.
 *
 * Only offered when this deployment actually talks to testnet. On mainnet the
 * same address has no account, so the example would render the "not funded
 * yet" warning — a demo that looks broken is worse than no demo.
 */
const TESTNET_DEMO_DEST = 'GCXH7QS5IRELKHLP7E7UJU5W5ZNHVO5PX5APKE4I25UVZFR6HCGA3AJJ';

function isTestnet(): boolean {
  return (process.env.HORIZON_URL ?? DEFAULT_HORIZON_URL).includes('testnet');
}

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

export default function Home() {
  const demoHref = `/tip?dest=${TESTNET_DEMO_DEST}&name=Ada&asset=native&amounts=5,25,100`;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-8 bg-jar-bg px-6 py-16 font-body text-jar-ink">
      <div className="flex items-center gap-2.5">
        <JarMark size={30} />
        <span className="flex flex-col leading-none">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-jar-moss-700">
            stellar
          </span>
          <span className="font-display text-[19px] text-jar-clay-800">tip jar</span>
        </span>
      </div>

      <div className="flex flex-col gap-3">
        <h1 className="font-display text-[34px] leading-tight text-jar-clay-800">
          A tip jar that&apos;s just a link
        </h1>
        <p className="text-base leading-relaxed text-jar-sand-800">
          Share one URL and people can send you XLM from any Stellar wallet. There is no signup, no
          account to create, and no database — your tip page <em>is</em> the link, with your address
          in it.
        </p>
        <p className="text-base leading-relaxed text-jar-sand-800">
          Payments go wallet to wallet, straight to the address in the URL. This site never holds,
          routes, or touches the money, and it can&apos;t: it builds a payment link and hands it to
          your wallet.
        </p>
      </div>

      <section aria-labelledby="make-one" className="flex flex-col gap-3">
        <h2 id="make-one" className="font-display text-[22px] text-jar-ink">
          Making one
        </h2>
        <p className="text-base leading-relaxed text-jar-sand-800">
          Put your Stellar address in a <code className="font-mono text-[0.9em]">/tip</code> URL.
          Everything else is optional:
        </p>
        <pre className="overflow-x-auto rounded-jar-md bg-jar-surface p-4 font-mono text-[12.5px] leading-relaxed text-jar-sand-900">
          <code>/tip?dest=G…YOUR_ADDRESS{'\n'}    &amp;name=Ada{'\n'}    &amp;asset=native{'\n'}    &amp;amounts=5,25,100</code>
        </pre>
        <dl className="flex flex-col gap-1.5 text-sm text-jar-sand-800">
          <div className="flex gap-2">
            <dt className="font-mono font-semibold text-jar-sand-900">dest</dt>
            <dd>your Stellar address — the only required parameter</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-mono font-semibold text-jar-sand-900">name</dt>
            <dd>who the page is for</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-mono font-semibold text-jar-sand-900">asset</dt>
            <dd>
              <code className="font-mono">native</code> for XLM, or{' '}
              <code className="font-mono">CODE:ISSUER</code>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-mono font-semibold text-jar-sand-900">amounts</dt>
            <dd>suggested amounts to offer as one-tap chips</dd>
          </div>
        </dl>
      </section>

      {isTestnet() ? (
        <Link
          href={demoHref}
          className="self-start rounded-full bg-jar-clay px-5 py-3 text-[15px] font-bold text-jar-clay-100 shadow-jar-md hover:bg-jar-clay-600"
        >
          See a live example
        </Link>
      ) : (
        <p className="text-sm leading-relaxed text-jar-sand-700">
          Swap in your own address and open the link — that page is your tip jar.
        </p>
      )}

      <footer className="flex flex-col gap-2 border-t border-jar-sand-300 pt-5 text-sm text-jar-sand-700">
        <p>
          Open source, and deliberately small:{' '}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="text-jar-clay-700 underline underline-offset-[3px] hover:text-jar-clay-800"
          >
            read the code on GitHub
          </a>
          .
        </p>
        <p>
          Totals shown on a tip page are read live from the public Stellar ledger, and can be
          checked there independently.
        </p>
      </footer>
    </main>
  );
}
