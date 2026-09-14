@AGENTS.md

# Working rules — stellar-tip-jar

These apply to every session on this repo.

## CI and PRs
- **CI green is non-negotiable before any PR is opened.** "Open PR, don't merge"
  is folded into this gate: open the PR, leave it for review, never merge it.
- A confirmed *unrelated* flake may be retriggered with an empty commit
  (`git commit --allow-empty`). A real failure gets fixed, never retried.

## Scope discipline
- Every branch and PR maps to **exactly one** GitHub issue.
- Unrelated findings go in the PR's "Notes for Reviewers" section. Never fix
  them in-scope — open a follow-up issue instead.

## Git artifacts
- **No AI co-author lines anywhere** — not in commits, PR descriptions, or
  branch names. No `Co-Authored-By: Claude`, no "generated with" trailers.
- Use the configured git identity. Never set `user.name`/`user.email` locally.
- Any issue or PR number referenced in a commit message or PR description must
  be **verified first** via `gh issue view <n>` or `git log` — never invented,
  never guessed from context.
- Run `git diff --stat` before every commit and show it.

## Testing
- **Real behavior over mocks.** Do not mock what can actually be run.
- Tests that exercise Horizon use **recorded fixtures** captured from real
  Horizon responses, reflecting real API shapes. No live network calls in tests,
  and no hand-invented response objects that drift from what Horizon returns.

## Approval gates
Three explicit gates per session. Stop and wait for an explicit go-ahead at each
one; never chain them automatically:
1. **Commit** — show `git diff --stat`, wait.
2. **Push** — wait.
3. **PR description** — show the full text, wait.

## PR description format
In this order:
1. Header
2. Problem (with a scenarios table where it helps)
3. Solution
4. Changes by file (code + rationale)
5. Regression Tests table (mapped to acceptance criteria)
6. Testing (literal command output, not a summary)
7. Notes for Reviewers
8. `Closes #N`
