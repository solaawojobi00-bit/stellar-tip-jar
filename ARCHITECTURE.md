# ARCHITECTURE — stellar-tip-jar

## Overview
A stateless Next.js app. Phase 1 has no database and no login — a tip page
is fully described by its URL query params. The only server-side piece is
a single route handler that proxies and caches a Horizon payments query.

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

### lib/strkey.ts, lib/sep7.ts
Minimal vendored strkey validation and SEP-0007 URI building, mirroring
stellar-pay-links. Replace with a dependency on that package once it's
published, rather than maintaining both.

## Data flow
Visitor loads /tip?dest=...&asset=... → dest validated on the server → QR +
wallet link rendered immediately → page fetches /api/total → route handler
queries Horizon (cached) → total displayed, or an "unfunded" notice when the
account does not exist yet. No data is ever written; Phase 1 is read-only
end to end.

## Non-goals (see PRD)
No database, no auth, no multi-asset totals merged together, no
slug/claim system — all Phase 2+.
