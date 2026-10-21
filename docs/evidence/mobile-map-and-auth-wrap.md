# Mobile map journey and homepage wrapping regressions

Started from merged main `130948574cb10678f6a59030fcb32791c3457a81`.
Open PR inspection initially found only #132, which covers grammar retention.
That PR merged during validation; this branch was rebased onto updated main
`6ef223e14fa636e0be8c7a4bbd3297e93f951a03` before publication. No conflicts or
additional product changes were needed.

## Scope and cause

The PR #134 Quality run (39585637888, head `9d6b600`) failed the mobile
four-format exercise journey at the Map toggle. The trace identifies the fixed
topic-details sheet intercepting pointer events. `SkillMap.svelte` intentionally
renders this mobile sheet above the map and provides Close topic details;
`clearSelection` removes it and returns focus to the selected topic.

The exercise test now dismisses the sheet through that visible button before
switching views. It verifies dismissal, returned focus and both toggles'
`aria-pressed` states. Existing lesson navigation, practice, answer submission,
overflow and history assertions remain intact. No forced clicks, retries, sleeps
or skipped assertions were introduced. No production behavior or styling changed.

The original journey passed in a local CI-style coverage build before the fix;
the interception is timing-dependent. The observed CI failure is the red evidence,
not a claim of deterministic local reproduction. An initial added focus assertion
targeted the recommendation shortcut; it was corrected to target the map topic
that `clearSelection` actually focuses.

The new homepage case uses a 320px viewport and enlarges account-navigation text
to 2rem, because both controls fit on one row at 320px with default text. It
asserts separate rows, no overlap, viewport containment and no horizontal document
overflow. Existing auth destination and keyboard checks are unchanged.

## Validation

Node 24.19.0 / npm 11.9.0. Installed locked dependencies with
`npm ci --ignore-scripts --offline --no-audit --no-fund --cache /workspace/.npm-cache`.
Browser tests use system Chromium and disposable local fixture databases.

- CI-style build: `npm run build:e2e-coverage` passed.
- Focused desktop/mobile exercise and auth tests: 6 passed.
- Mutation check: a temporary copy of the wrapping test forced `flex-wrap: nowrap`;
  both viewport projects failed the row-separation assertion as expected. The
  temporary file was removed. This demonstrates the new test detects missing
  wrapping rather than merely exercising a narrow viewport.
- Full validation on the initial base: type check, lint, formatting, 1,479 unit
  tests, 9 property tests, normal/coverage builds and all 128 desktop/mobile
  browser tests passed, with zero retries or skipped browser tests.
- Validation on updated main after rebase: type check, lint, formatting, 1,552
  unit tests across 98 files, 9 property tests across 6 files, normal/coverage
  builds and all 128 desktop/mobile browser tests passed. The browser run used
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`,
  took 4.6 minutes and exited 0 with zero skips or retries.

Self-review used the checkout's adversarial-review checklist without an external
model call. It found no high-severity issue or weakened assertion in this diff.
Local tests do not establish CI success or deployment status.

## PR #135 local review follow-up

Adversarial review approved the published `16d5410` diff and reported the same
low-severity selector-precision concern twice. The dismissal check matched every
complementary landmark on the page. Scope it to the exact accessible name
`Synthetic exercise lesson details`, consistent with the preceding visibility
assertion. This preserves the sheet-dismissal requirement without asserting that
unrelated landmarks must be absent.

The local-only refinement passed targeted ESLint, Prettier and both desktop/mobile
four-format exercise journeys (2 passed). No production files changed. Publishing
this refinement or changing PR readiness requires Andrew's new approval.
