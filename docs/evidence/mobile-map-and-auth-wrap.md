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

## Local fixture exception capture proposal

Diagnostic CI run 39595870199 at `98888c3` failed mobile question 1 with a correctly
focused/enabled keyboard submission: POST began at 282ms, returned HTTP 500 at
307ms, and the stored count stayed zero. This rules out lost focus for that
failure. The exception itself is unknown: the exercise fixture discarded server
stdio, and the production error hook intentionally projects only an unexpected
error category.

Proposed test-only follow-up preloads a fixture observer into the existing
exercise server. It observes Sentry's original exception before the application
sanitizer, without replacing the application hook, initializing a transport or
configuring a DSN. It runs only with the explicit fixture flag, test environment,
local file database and capture mail transport. Output is a closed projection of
known error names, database codes and known function names; exception messages,
paths, arbitrary codes, cookies, headers, tokens and values are discarded.
Causes are limited to three and exception records to ten. Piped stdout/stderr
have an 8KiB line buffer and only recognized, revalidated structured exception
records enter the answer diagnostics. Other output is discarded. Records reset
before each answer. Assertions, keyboard actions, polling and timeouts remain
unchanged. No application or production configuration files change.

Observed red: new sanitization tests failed before the helper existed. After
implementation, three focused unit tests passed, including cyclic causes,
malformed output and credential-bearing names/messages/stack paths. A temporary
fixture-only trigger deliberately rejected attempt inserts. The unchanged
persistence assertion failed (expected 1, received 0); POST returned HTTP 500 and
the console captured `LibsqlError / SQLITE_CONSTRAINT`, caused by
`SqliteError / SQLITE_CONSTRAINT_TRIGGER`, with only fixed function names.
The private marker in the trigger message was absent from console output. This
validates capture; it does not identify the actual CI exception. The temporary
probe was removed. A standalone no-DSN probe also confirmed exception observation.

The remaining hypothesis is an exception in the answer write/transaction or
constraint path; client focus is excluded for the captured CI failure. The
specific code must be observed before proposing an application fix. Publishing
this follow-up requires separate approval.

Local validation: desktop/mobile four-format journeys both passed (2 passed,
43.2 seconds); three sanitizer tests passed; type checking found zero errors or
warnings, and full lint/format checks passed. Unit checks cover the final async
stack-frame matcher; resetting captured records is local test bookkeeping. No
full unit/property/build rerun was needed for this test-only capture proposal.

## Pooled SQLite busy-timeout fix (local, awaiting publication approval)

CI run 39599677778 at `941419e` captured `LibsqlError / SQLITE_BUSY`, caused by
`SqliteError / SQLITE_BUSY`, in the answer-write transaction path. Desktop
question 1 and mobile question 4 both sent correctly focused/enabled keyboard
submissions, received HTTP 500, and never persisted the answer. The other 126
browser tests passed. These exception records establish a database lock failure,
not a keyboard, validation, hydration or routing failure.

Local reproduction identified a connection-pool configuration defect. The app
configured the intended 5,000ms SQLite busy timeout using one `PRAGMA` statement.
libSQL 0.18 opens additional connections for concurrent operations, and the
PRAGMA applies only to the connection borrowed for that statement. Two concurrent
queries of `PRAGMA busy_timeout` returned `[5000, 0]` before the fix. The driver's
installed Config documentation explicitly states that its `timeout` option is
applied to every file connection, including ones opened after transactions.

A separate worker thread holds a real read transaction against a disposable file
DB. The app's second pooled connection starts a write, inserts one row, and tries
to commit while the reader is still locked. The reader releases after a controlled
100ms hold in its own thread, so it can release while SQLite synchronously waits.
Before the fix, commit immediately throws `SQLITE_BUSY` at
`src/lib/server/db-transactions.ts:71`; both new regressions fail. This models a
legitimate separate reader, including the browser test's independent persistence
query, without modifying or rescheduling that query. The exact reader holding the
CI lock was not traced; the reproduced pool defect explains why brief contention
is turned into an immediate server error. It is an application file-client setup
defect exposed by the fixture, not an invalid fixture write or a reason to weaken
the persistence assertion.

Set libSQL's existing `timeout: 5000` option when creating a local `file:` app
client instead of issuing the one-connection PRAGMA. This preserves the intended
wait and covers future pooled connections. Remote clients receive no new option
or PRAGMA. No transaction retries, schema/migration changes, production settings,
test retries, increased test timeouts or keyboard changes are added. After the
fix, both connections report 5000 and the contended transaction commits exactly
one row after the reader releases. All eleven focused database tests pass,
including existing rollback, isolation and writer-queue regressions.

Remove both temporary diagnostic layers and their sanitizer tests now that the
exception and mechanism are known. Restore `exercises.spec.ts` exactly to `cbd873a`
(the map selector refinement and original keyboard/persistence assertions).
Retain the deterministic pool-setting regression and real-contention regression.
The diagnostic history above records observations; the temporary probes and
capture hooks are absent from the proposed final code.

Validation of the local fix:

- Type check: zero errors/warnings; full lint and formatting checks passed.
- Unit suite: 1,554 passed across 98 files; property suite: 9 passed across 6 files.
- Normal and coverage builds passed.
- Full browser suite: 127 passed, 1 failed in 5.3 minutes, zero skips/retries.
  Both original four-format answer journeys passed (desktop 15.0s, mobile 16.0s),
  as did both auth-wrapping regressions. Temporary diagnostics were absent.
- The remaining browser failure is the mobile freshly-scrolled-map URL test at
  `exercises.spec.ts:786`: lesson content rendered, then the URL became the map
  URL after fake-clock advancement. Preserve its assertion and map code.
- Bounded baseline comparison: temporarily restore the old DB initializer and
  rebuild with all application `src/` files matching main `6ef223e` (verified by
  an empty source diff). The unchanged mobile map test failed in all three runs:
  two with the same wrong URL at line 786, one with a pending map timer at line 784. This independently reproduces the map/timer issue without the SQLite fix.
  It is an existing validation blocker, not a green full-suite result. Restore
  the DB fix and rebuild afterwards; no map fix or test relaxation is included.

Local browser evidence still uses Chromium 154 rather than CI's 153. Exact-head
CI for this corrective change requires a separately approved push. The checkout
adversarial-review checklist was applied as an in-session self-review without an
external model call; no new high-severity issue was identified in the scoped fix.
