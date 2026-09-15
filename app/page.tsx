/**
 * Landing page.
 *
 * Phase 1 has no accounts and no database, so there is no "my jar" to show
 * here. What there is, is a link — so this page builds one. The prose that
 * used to document the query-string format has been replaced by the thing it
 * was describing: paste an address, get a tip page.
 *
 * All of that is interactive and client-only, so it lives in <LinkBuilder>.
 * This file is just the landmark and the backdrop it floats on.
 */

import LinkBuilder from './link-builder';

export default function Home() {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-jar-shell px-4 py-10 font-body text-jar-ink sm:px-6 sm:py-16">
      <LinkBuilder />
    </main>
  );
}
