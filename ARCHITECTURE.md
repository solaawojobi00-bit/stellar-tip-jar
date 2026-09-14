# ARCHITECTURE — stellar-tip-jar

## Overview
A stateless Next.js app. Phase 1 has no database and no login — a tip page
is fully described by its URL query params. The only server-side piece is
a single route handler that proxies and caches a Horizon payments query.

## Modules

### app/tip/page.tsx — the tip page
Reads dest, name, asset, amounts, msg from the query string. Validates dest
as a checksummed G/M strkey before rendering anything. Builds a SEP-0007
pay URI, renders it as a QR code plus an "Open in wallet" deep link, and
calls /api/total client-side for the live running total.

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
Visitor loads /tip?dest=...&asset=... → dest validated client-side → QR +
wallet link rendered immediately → page fetches /api/total → route handler
queries Horizon (cached) → total displayed. No data is ever written; Phase 1
is read-only end to end.

## Non-goals (see PRD)
No database, no auth, no multi-asset totals merged together, no
slug/claim system — all Phase 2+.
