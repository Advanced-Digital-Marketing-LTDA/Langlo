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

## PR #135 saved-answer CI diagnostics

Quality run 39592830380 at `cbd873ac2709f8ef4a50a1928968d5717b2951ec`
passed 127 browser tests and failed the mobile four-format journey: question 3
expected three persisted answers but found two after keyboard Enter. The earlier
run 39590565236 failed the same assertion at different questions. These failures
are distinct from the original mobile map interception; no root cause is yet
proven and the selector refinement does not claim to fix answer submission.

Add passive, test-only observation around the existing answer journey. Normal CI
console output labelled `FIXTURE_ANSWER_DIAGNOSTICS` reports question/format,
relative timing, focus transitions and Enter/submit targets, whether the answer
Submit is focused/enabled, answer lengths and checked states, native validity,
categorized validation messages, answer POST initiation/status, and each existing
persistence poll's count. Browser events stream into the test process so native
navigation cannot erase the entire event trail. Observer cleanup tolerates a
removed document without replacing the original assertion error.

The diagnostics do not focus, blur, scroll, navigate, submit or change controls.
Existing keyboard actions, screenshots, persistence assertions, polling intervals
and timeouts remain intact. No retries or application changes are added. Logs
contain only synthetic fixture metadata, lengths, booleans and fixed categories;
no answer text, URLs, request payloads, headers, credentials, cookies, session IDs
or submission keys are logged.

A temporary copy of the test deliberately blurred Submit immediately before
Enter, only to verify the failure reporting. The unchanged assertion failed:
`Expected length: 1`, `Received length: 0`. Console diagnostics showed Enter on
`BODY`, `activeIsAnswerSubmit: false`, Submit enabled, selected fixture answer,
no POST, and eight persistence samples remaining at zero. This demonstrates that
focus loss can produce the signature and that the diagnostics distinguish it;
it does not establish CI's cause. The temporary probe was removed.

Validation uses installed Chromium 154.0.8037.57; CI uses Chromium 153.0.8010.12.
The CI browser download was denied by network restrictions, so exact-browser
reproduction remains unavailable. Publication requires Andrew's approval.

Final local validation: both unchanged desktop/mobile four-format journeys passed
(2 passed, 47.1 seconds, zero retries). All eight Enter events targeted the actual
answer Submit, all eight POST responses were HTTP 200, and all eight answers
persisted. Type checking reported zero errors/warnings; full ESLint and Prettier
checks passed. The diagnostic diff changes only this evidence file and
`tests/e2e/exercises.spec.ts`. Existing unit/property/build validation above is
baseline evidence; those suites were not rerun for this test-only observation.
Passive instrumentation can affect timing, so a green diagnostic CI run alone
will not prove the intermittent failure fixed.
