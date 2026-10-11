/**
 * The tip page. Fully described by its query string — no database, no login.
 *
 * Parsing and validation happen here, on the server, so a malformed link
 * renders its error without waiting for JavaScript. The branding, QR, amount
 * selection, buttons, running total and post-send screen all live in <TipJar>,
 * which owns the whole visitor view so it can swap it wholesale once the
 * payment has been handed to the wallet.
 */

import { DEFAULT_SUGGESTED_AMOUNTS } from '@/lib/amounts';
import { DEFAULT_HORIZON_URL } from '@/lib/horizon';
import { parseAsset, parseSuggestedAmounts } from '@/lib/sep7';
import { isValidDestination } from '@/lib/strkey';

import ErrorPanel from '../error-panel';
import TipJar from './tip-jar';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Query params arrive as string | string[]; take the first value. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Block-explorer URL for the destination, on whatever network this deployment
 * talks to. Resolved here rather than in the client component because only the
 * server sees HORIZON_URL — a "verify on-chain" link pointing at the wrong
 * network would be worse than no link at all.
 */
/**
 * The Settings screen for this same jar.
 *
 * /settings reads exactly the params /tip does, so the whole configuration is
 * handed over as-is — including an explicitly empty `amounts`, which means
 * "no chips" rather than "fall back to the defaults". Re-serialised from the
 * parsed params rather than passed through as a raw string so nothing beyond
 * these five keys can ride along.
 */
function settingsUrlFor(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const key of ['dest', 'name', 'asset', 'amounts', 'msg'] as const) {
    const value = one(params[key]);
    if (value !== undefined) query.set(key, value);
  }
  return `/settings?${query.toString()}`;
}

function explorerUrlFor(dest: string): string {
  const horizon = process.env.HORIZON_URL ?? DEFAULT_HORIZON_URL;
  const network = horizon.includes('testnet') ? 'testnet' : 'public';
  return `https://stellar.expert/explorer/${network}/account/${dest}`;
}

export default async function TipPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  const dest = one(params.dest);
  const name = one(params.name);
  const msg = one(params.msg);

  if (!dest) {
    return (
      <ErrorPanel
        title="No destination"
        detail="This link is missing a dest parameter. A tip page needs a Stellar address, for example /tip?dest=G…"
      />
    );
  }

  if (!isValidDestination(dest)) {
    return (
      <ErrorPanel
        title="Invalid address"
        detail="The dest parameter is not a valid Stellar address. Check for a typo — addresses start with G or M and are case-sensitive."
      />
    );
  }

  const asset = parseAsset(one(params.asset));
  if (asset === null) {
    return (
      <ErrorPanel
        title="Invalid asset"
        detail={'The asset parameter must be "native" or "CODE:ISSUER".'}
      />
    );
  }

  const parsed = parseSuggestedAmounts(one(params.amounts));
  const amounts =
    params.amounts === undefined && parsed.length === 0 ? DEFAULT_SUGGESTED_AMOUNTS : parsed;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 bg-jar-bg px-6 py-10 font-body text-jar-ink">
      <TipJar
        dest={dest}
        asset={asset}
        amounts={amounts}
        name={name}
        msg={msg}
        explorerUrl={explorerUrlFor(dest)}
        settingsUrl={settingsUrlFor(params)}
      />
    </main>
  );
}
