# ARCHITECTURE — stellar-tip-jar

## Overview
A stateless Next.js app. Phase 1 has no database and no login — a tip page
is fully described by its URL query params. The only server-side pieces are
two route handlers that proxy and cache Horizon payments queries.

## Modules

### app/tip/page.tsx — the tip page
Reads dest, name, asset, amounts, msg from the query string. Validates dest
as a checksummed G/M strkey before rendering anything, on the server, so a
malformed link shows its error without waiting for JavaScript.

### app/tip/tip-jar.tsx — the interactive half
Client component holding everything that needs a click or the network: the
QR, suggested-amount selection, "Copy link"/"Open in wallet" buttons, and
the /api/total fetch. Selecting an amount rebuilds the SEP-0007 URI, so the
QR and the wallet link can never disagree about what is being paid.

The QR itself comes from qrcode.react (ISC), not a vendored encoder. The
zero-dependency rule in this repo applies to strkey and SEP-0007 — the
pieces that mirror stellar-pay-links — not to rendering. qrcode.react has
no runtime dependencies of its own and renders declarative SVG, which is
both smaller and easier to verify than hand-rolling a QR encoder.

### app/api/total/route.ts — running-total proxy (Route Handler)
Given dest and asset, paginates Horizon's /accounts/{id}/payments, sums
matching payment amounts, and returns a cached JSON total. This is the
only server-side logic in Phase 1 and holds no state beyond a short cache
TTL.

Runs on the Node.js runtime: Next.js 16 deprecated the edge runtime for
route handlers (Edge is now reserved for Proxy). Only the runtime differs —
the handler is still a thin, stateless, cached proxy in front of Horizon,
which is what the design actually depends on.

### app/api/recent/route.ts — recent-tips proxy (Route Handler)
Given dest, asset and an optional limit, walks the same payments endpoint
newest-first with `join=transactions` (the memo lives on the transaction,
not the payment) and returns a cached list of the last few tips. Shares the
running total's wall-clock pagination budget, so a jar whose recent history
is all in another asset returns a short feed rather than timing out.

### lib/recent-tips.ts — what the feed is allowed to say
The one place that turns a Horizon payment record into something a visitor
may see. Nothing but this projection is ever serialised, so the full sender
address, transaction hash and raw memo bytes stay on the server. Two rules
come from the PRD's memo-privacy risk: the sender is truncated before
serialisation, and only MEMO_TEXT is shown — ID, hash and return memos are
routing and binary values, and are dropped rather than rendered. Text memos
are stripped of control, bidi and zero-width characters, because a memo is
attacker-supplied text from a stranger's wallet.

### lib/strkey.ts, lib/sep7.ts
Minimal vendored strkey validation and SEP-0007 URI building, mirroring
stellar-pay-links. Replace with a dependency on that package once it's
published, rather than maintaining both.

## Data flow
Visitor loads /tip?dest=...&asset=... → dest validated on the server → QR +
wallet link rendered immediately → page fetches /api/total → route handler
queries Horizon (cached) → total displayed, or an "unfunded" notice when the
account does not exist yet. The page fetches /api/recent alongside it, on its
own, so a failing feed never takes the total down with it. No data is ever
written; Phase 1 is read-only end to end.

## Non-goals (see PRD)
No database, no auth, no multi-asset totals merged together, no
slug/claim system — all Phase 2+.

## Not yet built
A creator dashboard (slugs, claim, settings UI, goal bar, CSV export, stream
overlay, embeddable widget, QR poster) has a design prototype but no code in
this repo. This is scoped, not an oversight — see PRD.md's P1, P2, and P3
sections.

The recent-tips feed is the exception: PRD P1 frames it as part of a claimed
profile, but the sanitizing it calls for is independent of who owns the page,
so it is built here against the address the page already has. When slugs and
claims land, /u/slug resolves to a dest and reuses /api/recent unchanged.
