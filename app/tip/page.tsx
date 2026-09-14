/**
 * The tip page. Fully described by its query string — no database, no login.
 *
 * Parsing and validation happen here, on the server, so a malformed link
 * renders its error without waiting for JavaScript. The QR, amount selection,
 * buttons and running total are interactive and live in <TipJar>.
 */

import Link from 'next/link';

import { parseAsset, parseSuggestedAmounts } from '@/lib/sep7';
import { isValidDestination } from '@/lib/strkey';

import TipJar from './tip-jar';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Query params arrive as string | string[]; take the first value. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function ErrorPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6 py-12">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{detail}</p>
      <Link href="/" className="text-sm underline underline-offset-4">
        Back to home
      </Link>
    </main>
  );
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

  const amounts = parseSuggestedAmounts(one(params.amounts));

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Tip {name ?? 'this creator'}</h1>
        {msg ? <p className="text-sm text-neutral-600 dark:text-neutral-400">{msg}</p> : null}
      </header>

      <TipJar dest={dest} asset={asset} amounts={amounts} msg={msg} />
    </main>
  );
}
