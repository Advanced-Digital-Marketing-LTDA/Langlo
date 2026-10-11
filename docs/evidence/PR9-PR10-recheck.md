# PR #9/#10 recheck fixes — 2026-10-11

Branch: `codex/recheck-pr9-pr10`, based on `origin/main` (`c32a50e`, PR #15
merge). Scope: four rechecked findings from merged PRs #9 (T005 prototype)
and #10 (test-integrity tooling). This does not close T025 — Stryker/domain
mutation and the broader tooling plan remain open.

## Finding 1 — uncollected-test detection inconsistent with runner rules

`is_test_path` recognized Jest-style `__tests__/` directories and `(test|spec)`
suffixes, but `is_uncollected_test_path` only matched suffix patterns — a file
like `tests/__tests__/helper.ts` was detected as a test yet never flagged as
uncollected, and no runner would ever execute it.

Fix: the detection block moved from inline workflow bash into
`scripts/detect-changed-tests.mjs` (validator-script convention). Collection
rules now mirror the runners exactly:

- Vitest collects `src/**/*.test.ts` and `tests/**/*.test.ts` minus
  `tests/e2e/**` (vitest.config.ts include/exclude).
- Playwright collects `*.{test,spec}.{js,ts,mjs,cjs}` under `tests/e2e` only
  (testDir + default testMatch).
- `is_uncollected_test_path` = `isTestPath && !isCollectedPath`, so any
  test-named or `__tests__`-located file matching no collected pattern fails
  the gate.

Evidence: `tests/detect-changed-tests.test.ts` runs disposable git fixtures
through the real script. A `tests/__tests__/helper.ts` addition and a stray
`tests/stray.spec.ts` both exit 1 with per-file `::error`; a collected
`tests/good.test.ts` passes with `has_tests=true`.

## Finding 2 — TestTrust base received an empty-tree hash

On a no-divergence push the fallback `base_ref` was
`git hash-object -t tree /dev/null` — a tree object, while TestTrust's
`--base` expects a commit.

Fix: the same code path now materializes a real empty-root commit
(`git commit-tree` with explicit CI identity), so `git diff` and TestTrust
both receive a commit. Comparison semantics are unchanged — every file diffs
as added — and no audit path is skipped; an advertised base that fails
`cat-file -e` still errors out.

Evidence (same fixture suite): new-branch push resolves the fork-point
merge-base, before-SHA push resolves the ancestor, a no-divergence push
returns a `commit`-typed object that diffs all files, and an unavailable PR
base throws `Unable to resolve diff base` (fail closed).

## Finding 3 — results page showed fixed fixture mistakes

`/prototype/results` rendered `defaultResults.missedItems` (one canned item)
for any nonzero `incorrect` count, regardless of what the learner actually
answered.

Fix: `prototypeSession.answers` records each practice attempt
(prompt / given answer / expected / outcome) and resets when a new practice
run mounts. `src/lib/prototype/results.ts` derives the displayed mistakes
from recorded `incorrect` answers; a session with zero recorded answers falls
back to the fixture breakdown so standalone design review still renders.

Evidence: `tests/prototype-results.test.ts` covers zero/one/multiple errors
and the fixture fallback; browser tests answer real items wrong (`es`,
`je mange`) and see exactly those mistakes, or see "No mistakes this session"
after an all-correct run.

## Finding 4 — kept-draft state allowed duplicates across navigation

`keptDraft` was page-local `$state`; leaving and returning to results reset
it, so a second "Keep as flashcard" pushed another note into the mistakes
deck.

Fix: keep state is derived from the deck notes themselves — each mistake maps
to a stable `n-session-<slug>` draft id via `draftIdFor`, and `keepAsFlashcard`
is a no-op when that id already exists. Since the decks live in the session
store, a kept mistake stays kept across in-session navigation and repeated
keeps cannot duplicate.

Evidence: the browser test keeps a real mistake, navigates to decks, returns
twice — the keep button does not reappear and the draft note exists exactly
once; the keep → drafts → approve flow is unchanged.

## Validation run (local)

- `npm run check` — 0 errors, 0 warnings
- `npm run lint` — clean (eslint.config.js now covers `*.svelte.ts` with the
  TS parser; previously it could not parse type syntax in runes files)
- `npm run format:check` — clean
- `npm test` — 274 passed across 25 files (includes
  `detect-changed-tests.test.ts` 26 and `prototype-results.test.ts` 7)
- `npm run test:property` — 3 passed
- `npm run build` — clean
- `npx playwright test` — 50 passed (desktop + mobile)

## Boundaries

Local checks only; no claim of hosted CI, deployment, or production
behavior. The "It's a Plan" tracker is not reachable from this workspace —
evidence is recorded here for sync by the maintainer. The synthetic,
non-production prototype boundary is preserved (in-memory session only, no
backend or persistence added).
