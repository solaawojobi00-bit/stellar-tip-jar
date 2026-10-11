/**
 * The full-page "this link cannot be rendered" panel.
 *
 * Shared by every server component that validates a link before showing
 * anything, so a bad address looks the same whichever route was asked for.
 */

import Link from 'next/link';

export default function ErrorPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 bg-jar-bg px-6 py-12 font-body text-jar-ink">
      <h1 className="font-display text-[31px] leading-tight text-jar-clay-800">{title}</h1>
      <p className="text-[15px] leading-normal text-jar-sand-800">{detail}</p>
      <Link
        href="/"
        className="text-sm text-jar-clay-700 underline underline-offset-[3px] hover:text-jar-clay-800"
      >
        Back to home
      </Link>
    </main>
  );
}
