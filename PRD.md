# PRD — stellar-tip-jar

**Status:** Draft v1.0 · **Owner:** Maintainer · **Last updated:** 2026-09-14

## 1. Problem
There's no simple way for a creator, streamer, or open-source maintainer to
accept one-off tips on Stellar. Today the options are: paste a raw address in
a bio (no memo guidance, easy to mistype), or build something custom.

## 2. Goal
Ship stellar-tip-jar: a zero-login, zero-database (Phase 1) tip page. A
creator gets a page showing their address as a QR + SEP-0007 pay link,
suggested amounts, and a running total received — pulled live from Horizon.

## 3. Non-goals
- Not a wallet. Never touches secret keys.
- Not a payment processor. No custody, no fiat conversion, no KYC.
- Not multi-recipient/fee-splitting (Phase 1).
- No login/auth in Phase 1 — pages are addressable by public key, not "owned."

## 4. Users & use cases
| User | Use case |
|---|---|
| Streamer/creator | Share one link in bio; viewers tip without an account |
| OSS maintainer | Accept tips alongside a GitHub sponsors link |
| Newsletter/blog writer | Embed a tip button at the bottom of a post |
| Casual Stellar user | See proof a page is "real" via live running total |

## 5. Requirements

### P0 (Phase 1 — this release)
- Stateless profile page driven by query params:
  /tip?dest=G...&name=...&asset=native&amounts=5,10,25&msg=...
- Validate dest as a checksummed G/M strkey; clear error page for
  invalid/unfunded destinations
- Generate SEP-0007 pay URI + QR code client-side (vendor a minimal
  strkey/URI builder for now; swap for stellar-pay-links once published)
- Running total: sum Horizon payments to dest, filtered by asset, via a
  thin Vercel Edge Function with a short cache TTL — never call Horizon
  directly from every visitor's browser
- Per-asset totals kept separate; never sum XLM and a credit asset together
- "Copy link" and "Open in wallet" buttons; mobile-first single page
- Deploys as a single Next.js app on Vercel's free tier, no persistent storage

### P1
- Friendly slugs (/u/name) backed by a minimal KV store
- Page "claim" via a SEP-10-style signed challenge
- Configurable suggested amounts via a settings UI
- Recent-tips feed (memo shown only if MEMO_TEXT, sender truncated)

### P2
- Optional goal bar with progress from the same running-total data
- Support for a second asset alongside XLM
- Richer profile customization

## 6. Success metrics
- Zero-signup path from "nothing" to a shareable tip page
- Tipper can pay from the page in under 3 taps in a mobile wallet
- Running total matches a manual Horizon query for the same window
- Zero required backend state for P0

## 7. Risks
- Horizon load/rate limits on unbounded payment history → cap lookback,
  cache proxy responses
- Unfunded/invalid destination must fail gracefully, not crash the page
- Memo privacy in a future recent-tips feed → sanitize before display
- Asset confusion: never conflate native XLM with same-code credit assets
  from different issuers
