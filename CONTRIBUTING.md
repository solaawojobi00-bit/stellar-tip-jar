# Contributing to stellar-tip-jar

Thanks for taking a look. This project is a zero-login, zero-database tip
page for Stellar — see [PRD.md](PRD.md) and [ARCHITECTURE.md](ARCHITECTURE.md)
for what it is and how it's built.

## Setup

See [README.md](README.md#setup) for `npm install` / `npm run dev` and the
full script list. This doc only covers how to contribute, not how to run the
app.

## Finding something to work on

- **`good first issue`** — self-contained, doesn't require deep context on
  Horizon/SEP-0007 or the rest of the codebase. Start here if you're new to
  the repo.
- **`points:` labels** — contributor-backlog issues are sized using Stellar
  Wave complexity tiers:

  | Label | Tier | What it means |
  |---|---|---|
  | `points:100` | Trivial | Small, isolated change; low risk |
  | `points:150` | Medium | Touches one module in depth, or a couple of files |
  | `points:200` | High | Cross-cutting, or requires careful design/testing |

  Pick an issue that matches the time and context you have — points reflect
  complexity, not priority.
- `wave-friendly` marks issues that are self-contained enough to pick up
  independently of other in-flight work; `phase-1` marks current-phase scope
  (see PRD.md for phasing).

## Branch naming and scope

- One issue, one branch, one PR. Don't bundle unrelated fixes into a PR
  opened against a single issue.
- Branch names: `<type>/issue-<number>-<short-slug>`, e.g.
  `fix/issue-21-landing-page`, `feat/issue-40-recent-tips`,
  `docs/issue-31-contributor-onboarding`. Use `fix/` for bugs, `feat/` for
  new functionality, `docs/` for documentation-only changes, `chore/` for
  tooling/maintenance with no user-facing change.
- If your PR doesn't close an issue yet, open one first (or ask a maintainer
  to) so the branch and PR can reference a number.

## What CI runs

Every PR against `main` runs (see `.github/workflows/ci.yml`):

```bash
npm ci
npm audit --audit-level=high
npm run lint
npm run build
npm test
```

All of these must pass before a PR can merge — no exceptions. CodeQL,
Dependabot, and gitleaks secret scanning also run continuously on the repo
outside this workflow; you don't need to configure anything for those.

## PR checklist

Before opening a PR, check that:

- [ ] New logic has tests (see `app/__tests__/` for existing patterns; tests
      that touch Horizon use recorded fixtures, not mocks or live network
      calls)
- [ ] `npm run lint`, `npm run build`, and `npm test` all pass locally
- [ ] The PR is scoped to exactly one issue — no unrelated bundled fixes
      (open a separate issue/PR for anything else you notice)
- [ ] The PR description references the issue it closes (`Closes #N`)

## Out of scope

Per [PRD.md's non-goals](PRD.md#3-non-goals), the following are **not**
accepted here, regardless of how the issue is framed:

- Wallet or custody code of any kind
- Any change that touches secret keys
- Fiat conversion or KYC flows

If an issue seems to call for one of these, flag it in a comment rather than
implementing it.
