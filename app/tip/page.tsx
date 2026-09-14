/**
 * The tip page. Fully described by its query string — no database, no login.
 *
 * Scaffold: validation, asset/amount parsing and the SEP-0007 URI are wired up.
 * The QR code, "Copy link"/"Open in wallet" buttons and the live running-total
 * fetch land in a later change.
 */

import Link from 'next/link';

import { buildPayUri, parseAsset, parseSuggestedAmounts, assetLabel } from '@/lib/sep7';
import { isValidDestination } from '@/lib/strkey';

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
  const payUri = buildPayUri({ destination: dest, asset, msg });

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Tip {name ?? 'this creator'}</h1>
        {msg ? <p className="text-sm text-neutral-600 dark:text-neutral-400">{msg}</p> : null}
      </header>

      {/* TODO: QR code for payUri */}
      <section
        aria-label="Payment code"
        className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-neutral-300 text-sm text-neutral-500 dark:border-neutral-700"
      >
        QR code
      </section>

      {amounts.length > 0 ? (
        <section aria-label="Suggested amounts" className="flex flex-wrap gap-2">
          {amounts.map((amount) => (
            <span
              key={amount}
              className="rounded-full border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700"
            >
              {amount} {assetLabel(asset)}
            </span>
          ))}
        </section>
      ) : null}

      <section aria-label="Destination" className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-neutral-500">Destination</span>
        <code className="break-all text-xs">{dest}</code>
      </section>

      {/* TODO: "Copy link" + "Open in wallet" buttons, and the /api/total fetch. */}
      <a href={payUri} className="rounded-lg bg-neutral-900 px-4 py-3 text-center text-sm font-medium text-white dark:bg-white dark:text-neutral-900">
        Open in wallet
      </a>
    </main>
  );
}
