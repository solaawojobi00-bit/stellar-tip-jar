/**
 * The Settings screen for a tip jar.
 *
 * Reached from the homepage builder or from the footer of a tip page, and
 * described by the same query string the tip page reads — so whatever a jar
 * currently suggests is what this screen opens with. Parsing and validation
 * happen here, on the server, for the same reason they do on /tip: a malformed
 * link should say so without waiting for JavaScript.
 *
 * Only the amounts are editable; everything else about the jar rides through
 * untouched. The editor itself needs a keyboard and a clipboard, so it lives
 * in <AmountSettings>.
 */

import type { Metadata } from 'next';

import { DEFAULT_SUGGESTED_AMOUNTS } from '@/lib/amounts';
import { parseAsset, parseSuggestedAmounts } from '@/lib/sep7';
import { isValidDestination } from '@/lib/strkey';

import ErrorPanel from '../error-panel';
import AmountSettings from './amount-settings';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const metadata: Metadata = {
  title: 'Settings — stellar-tip-jar',
  description: 'Edit the suggested amounts on your Stellar tip page.',
};

/** Query params arrive as string | string[]; take the first value. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  const dest = one(params.dest);
  const name = one(params.name);
  const msg = one(params.msg);

  if (!dest) {
    return (
      <ErrorPanel
        title="No jar to configure"
        detail="Settings belong to a jar, and this link is missing its dest parameter. Build a link on the home page first, then come back here to change its amounts."
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

  // The same rule the tip page applies, so the editor opens on exactly the
  // chips the jar is showing right now: defaults only when nothing was said.
  const parsed = parseSuggestedAmounts(one(params.amounts));
  const amounts =
    params.amounts === undefined && parsed.length === 0 ? DEFAULT_SUGGESTED_AMOUNTS : parsed;

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-jar-shell px-4 py-10 font-body text-jar-ink sm:px-6 sm:py-16">
      <AmountSettings config={{ dest, asset, name, msg }} initialAmounts={amounts} />
    </main>
  );
}
