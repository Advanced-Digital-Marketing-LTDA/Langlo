# LANGLO-247 implementation evidence

**Scope:** local grammar-retention pilot implementation using synthetic fixture data. No real learner data, production database, provider calls, paid calls, remote publication, CI secrets, or deployment were used.

## Mastery protection

Grammar FSRS is a separate recall schedule. It cannot mark a skill secure or change grammar-1 mastery status. The existing `scoreGrammar` rule still requires five distinct qualifying items across at least two sessions and at least 80% correct; the first response to a logical item/lineage is the only response that can add mastery evidence. Assisted and unsure responses do not qualify. An unrated correct answer under `grammar-fsrs-1` is treated as never given, so it contributes neither a durable answer/evaluation, mastery evidence, nor a retention event. The schedule only aggregates a completed session's lowest qualifying rating for each skill, at most once per skill/session.

The LANGLO-257 cross-boundary regression reviews the same question in two completed sessions. It observes two FSRS events while mastery remains Practising with only one distinct qualifying item from one evidence session. This demonstrates that retention reviews alone cannot satisfy the mastery floor.

The LANGLO-248 stability comparison was a granularity check, not a mastery safeguard or evidence of delayed grammar recall. It showed that one skill schedule accumulates stability differently from separate schedules for new prompts. The distinction and calibration limits are recorded in [LANGLO-248 evidence](LANGLO-248.md).

## Red/green record

- The focused scheduler behavior test first failed because the grammar-retention module did not exist; it passed after the module and one-event-per-skill/session aggregation were implemented.
- The legacy-session compatibility regression first failed at the new rating gate. The server and UI were then limited to requiring ratings only for sessions tagged `grammar-fsrs-1`; the regression passed and the existing session can continue without a retention rating.
- On the rebased current-main branch, the new regressions first exposed three compatibility failures: a nullable policy marker hid prior legacy answers from exposure checks, and no-verdict fallback markers were being written to practice/legacy attempts. A NULL-safe policy comparison and scoped marker writes fixed them; the focused regression set passed 73/73 and the full suite passed 1,416/1,416.
- After `main` added the five-confirmed-wrong assessment stop, the focused test first showed a retention assessment could keep offering questions after the stop threshold when an earlier correct answer still needed a rating. The assessment now opens its end-stage when the threshold is reached, keeps the session active until every correct answer is rated, and completes when the last rating is saved.
- The browser run exposed a lost `session` query on the rating form action. The action URL now preserves it, and the focused desktop exercise suite passed 4/4.
- Initial refresh checks timed out because the existing build artifact had SvelteKit's version checker compiled as a development no-op. An explicit production-mode build restored the configured checker; the focused desktop refresh checks passed, then the full desktop/mobile E2E suite passed 104/104.
- The rebased E2E run first found that its synthetic practice session was not tagged with the new retention policy, so the test saw legacy feedback with no rating controls. It now seeds the policy explicitly and targets the distinct status messages; the full desktop/mobile suite passed 104/104. The repository's default port 4173 was occupied, so a temporary config ran the built Node server on 4189 and was removed afterward.

## Local validation

- Runtime: Node `v24.19.0`, npm `11.9.0`; `npx --yes npm@11.9.0 ci --ignore-scripts` passed.
- `npx --yes npm@11.9.0 run check`: passed, 0 errors and 0 warnings.
- `npx --yes npm@11.9.0 run lint`: passed.
- `npx --yes npm@11.9.0 run format:check`: passed.
- `npx --yes npm@11.9.0 test`: passed, 91 files and 1,423 tests.
- `npx --yes npm@11.9.0 run test:property`: passed, 5 files and 7 tests.
- `NODE_ENV=production npx --yes npm@11.9.0 run build -- --mode production`: passed with the adapter-node production build.
- `npx --yes npm@11.9.0 run test:e2e -- --config=playwright.validation.config.ts`: passed, 104 tests across desktop and mobile against the built Node server with synthetic fixtures. The temporary config changed only the local server port and was removed after validation.
- `npx --yes npm@11.9.0 exec -- vitest run tests/attempt-fallback.test.ts tests/attempt-evaluation.test.ts tests/assessment-feedback.test.ts tests/assessment.test.ts tests/grammar-retention.integration.test.ts`: passed, 5 files and 73 tests.
- `git diff --check`: passed. Migration `0026` and `0027` are forward-only additions; existing migration SQL, snapshots, and journal entries were not modified.

## Browser evidence

The synthetic desktop screenshot captures the answer, feedback and selected rating before the session is finished:

![Grammar practice feedback after a Good rating](LANGLO-247-practice-rating.png)

## Pending acceptance and limits

The synthetic FSRS feasibility comparison does not establish that the schedule predicts delayed grammar recall. LANGLO-253 calibration still needs delayed recall on unseen equivalent questions across skills, tracks, and learner experience, with leakage controls and uncertainty. CI, live provider behavior, production state, learner exposure, and release readiness remain unverified and are not authorized by this local implementation.

## PR #132 review fixes — 2026-10-20

The approved follow-up fixes the two confirmed content-version defects and adds behavior coverage around the reviewed transaction and route boundaries. Grammar mastery, native flashcard behavior, study settings, UI, dependencies and CI policy remain unchanged.

- A frozen grammar review now resolves both its question and lesson from the plan's content version before its first answer. It can finish after a newer version is published; withdrawn content is still refused, and answers from superseded content do not strengthen the current schedule.
- Forward migration `0028_current_grammar_content` replaces the two reset triggers so only the effective newest approved content version can reset schedules. Existing migration SQL, snapshots and journal entries are preserved; the journal only gains the new entry. The upgrade regression preserves existing schedule state, permits repeated migration, and still resets on publication of a genuinely newer version.
- Rating eligibility, owner/session validation, review replay/selection, provisional cleanup, assessment finalization, schedule persistence and event persistence now have focused helpers. Completion, mastery synchronization and retention writes retain their original transaction boundaries and error behavior.
- New tests cover each rating exclusion independently, lowest-rating precedence, simultaneous conflicting/duplicate ratings, repeated finishing, review replay and invalid selections, foreign rating/discard requests, assessment and practice rollback after a synthetic retention-write failure, saved timezone propagation across both DST transitions, and the browser-facing rating/discard/review actions. The long retention integration scenario is split into aggregation/isolation, settings/review and content-reset/history cases.

### Follow-up red/green evidence

- Before the frozen-version fix, the regression expected `fr-a1-001@1:q2` after v2 publication and received `question: null`. The same scenario now passes, including lesson-version matching, answer/rating submission and completion.
- Before the trigger correction, both insertion and promotion of older v2 content rewrote the v3 schedule to v2 and incremented its revision. Both regressions now preserve the v3 schedule unchanged; the existing newer-content reset regression still passes.
- Additional boundary tests verified existing behavior before the refactors: unrated cleanup, owner isolation, duplicate ratings, rollback and timezone propagation already worked. These checks remain green after the refactors.

### Follow-up validation

- Node `24.19.0`, npm `11.9.0`; `npm ci --ignore-scripts`: passed.
- `npm run check`, `npm run lint`, `npm run format:check`: passed.
- `npm test -- --coverage --coverage.reporter=json-summary --coverage.reporter=lcov --coverage.reporter=text --coverage.reportsDirectory=/tmp/langlo-fixes-coverage`: passed, 91 files and 1,465 tests.
- `npm run test:property`: passed, five files and seven tests.
- Local instrumented changed-line coverage against base `6d939eb`: **337/349 (96.56%)**, calculated by intersecting added/modified source lines from `git diff --unified=0 origin/main -- src` with LCOV `DA` entries. The assessment-results rating/discard actions, lesson rating action, practice review action and session action each have 100% of their instrumented changed lines covered. This is a local line-coverage calculation, not a hosted Codecov or branch-coverage result.
- `NODE_ENV=production npm run build -- --mode production`: passed after the final unit suite.
- `npm run test:e2e -- --config=playwright.validation.config.ts`: passed, 104 desktop/mobile tests against the built Node server and synthetic fixtures. The temporary config changed only the local server port to 4189 and was removed after validation.

The first browser launch stopped before running tests because port 4173 was occupied. A subsequent browser run overlapped a unit test that invokes its own build in test mode, replacing the production version checker and invalidating refresh checks. Final browser validation runs after the unit suite and an explicit production-mode build, using a temporary port-4189 config that is removed afterward. No refresh implementation or tests are weakened.

Hosted quality gates, publication of these follow-up changes, delayed-recall calibration, real providers, production migrations and deployment remain separate and unverified by this local evidence.

## Merge with Portuguese platform support — 2026-10-20

The owner confirmed that production is on `main` with `0026_portuguese_tracks` applied, and explicitly approved a one-time exception to resequence the PR's unapplied grammar migrations and reconcile their metadata. Production was not accessed. The merge preserves both commit histories and combines `main`'s B1/B2 and foundation-level reporting with grammar retention's rating stage, provisional-answer rules and five-confirmed-wrong early stop.

| Previous PR migration          | Merged migration               | SQL contents            |
| ------------------------------ | ------------------------------ | ----------------------- |
| `0026_peaceful_albert_cleary`  | `0027_peaceful_albert_cleary`  | Byte-for-byte preserved |
| `0027_sturdy_talkback`         | `0028_sturdy_talkback`         | Byte-for-byte preserved |
| `0028_current_grammar_content` | `0029_current_grammar_content` | Byte-for-byte preserved |

Every migration SQL file and journal entry from `main` through 0026, and its 0026 snapshot, are unchanged. The unapplied PR snapshot chain is reconciled with the Portuguese schema; its journal entries follow 0026 with strictly increasing timestamps. A fixture reproducing the canonical `main` ledger through 0026 is accepted without `LEDGER_DRIFT`, exposes only 0027–0030 as pending, upgrades successfully and retains every existing ledger row.

New forward migration `0030_portuguese_grammar_retention` widens the grammar schedule language constraint to Portuguese. Its table rebuild requires the runner to disable foreign keys before opening the transaction, preserves schedules and events, recreates the guards that reference the rebuilt table, and checks row counts and foreign-key integrity before commit. Tests verify a populated upgrade, repeated migration, preserved append-only guards and owner-deletion behavior, refusal with foreign keys enabled, and rollback after a forced late failure. Only disposable local fixtures were migrated.

### Merge red/green evidence

- The new Portuguese B1/B2 answer/rating regression initially failed with `CHECK constraint failed: grammar_retention_schedules_language`. It now completes the assessment and stores three owner-scoped Portuguese review events.
- The generated SQLite rebuild initially failed because `grammar_retention_events_no_delete` referenced the schedule table during its replacement. The final forward migration removes and restores the three affected guards inside the same transaction; populated-history and rollback regressions pass.
- The existing Portuguese migration preservation test is isolated to its intended 0026 boundary. The local-client remote-apply-path test now expects the complete merged pending suffix and preserves all study-history row counts.
- Focused post-resolution tests: 49 passed across migration, Portuguese-track and ledger-compatibility suites; grammar integration regressions also passed in the first compatibility run.

### Merge validation

- `npm ci --ignore-scripts`: passed on Node 24.19.0 / npm 11.9.0.
- `npm run check`, `npm run lint` and `npm run format:check`: passed; formatting and diff checks were repeated after the evidence update.
- `npm test`: passed, 95 files and 1,517 tests.
- `npm run test:property`: passed, five files and seven tests.
- `NODE_ENV=production npm run build -- --mode production`: passed after the final unit suite.
- `npm run test:e2e -- --config=playwright.validation.config.ts`: passed, 104 desktop/mobile tests against the production build with synthetic fixtures. The temporary config used local port 4189 and was removed afterward.

No production ledger was edited, no production migration was run, and no existing commit was rewritten. Hosted CI and deployment remain separate acceptance gates.

## Remaining PR #132 review fixes — 2026-10-21

Base: `93542cd8914dcc53413d3500b591043273ab3ee7`, including the skill-map merge from main. The working tree was clean before this follow-up. No migration SQL, snapshots, journal entries, schema, package files, CI configuration, UI markup or styles were changed.

### Review dispositions and implementation

- Retired-skill correctness finding (`4331464132`): candidate loading joins the active/retired skill state, and eligibility rejects retired content before aggregation or persistence. Frozen plan reads reject a retired skill, and question/lesson reads check retirement in their payload query. Completing an existing session preserves prior schedules and immutable events without creating a new retired-skill review.
- Shared rating/discard validation (`4331291044`, `4331291046`, related CodeScene findings): owner/session/policy/assistance checks and correct-evaluation selection are shared. Rating persistence, replay checks and assessment finalization are separate operations inside the original transaction. Distinct error behavior is preserved. The internal rating function accepts one command object; both route callers and every test caller were adapted without changing HTTP payloads.
- Eligibility and precedence (`4331291039`, related CodeScene findings): separate named eligibility, lowest-rating, current-content, source-selection and completed-session checks. Repeated unassisted questions remain eligible for retention while excluded from distinct-item mastery; no mastery threshold or scheduling policy changed.
- Persistence method-size findings: schedule insert/update statements share the same ordered values, retain optimistic revision checks and stay in the caller's transaction. Schedule calculation is separate from persistence and event insertion.
- Other production complexity findings: assessment availability, active-item selection, coverage and result summaries are focused helpers; current mastery candidate selection is separated from first-item deduplication; review identity validation is shared; answer insertion and fallback eligibility are separated from orchestration.
- Flashcards file-size finding (`4331286363`): connection serialization and transaction lifecycle helpers moved into `db-transactions.ts`. The original flashcards exports remain available. Helper bodies compare identically with the base, ignoring the trailing blank line.
- Test-size findings (`4331288215`, `4331456187`, `4331696796`, `4331696873`): extracted coherent setup, completion, rating, reporting and navigation steps. Existing `expect` call counts are unchanged in exercise E2E (142) and assessment tests (98); grammar retention assertions increase from 64 to 71. No tests or assertions were removed or skipped.
- Earlier frozen-version and older-publication P2 findings remain covered by their existing regressions. Existing migration files were not edited to answer those comments. Already resolved migration-test-size findings were left untouched.

### Observed red and green

Four new retirement regressions were written before changing production code. The focused red run failed all four tests (24 unrelated tests intentionally filtered out): a retired skill received a new schedule, an existing schedule advanced, a frozen plan resolved instead of rejecting, and a retired question was served. Log: `/tmp/langlo-valid-red.log`.

After the fix, the retention unit/integration suites passed. The broader focused run passed 199 tests across nine files; after consolidating session identity validation, 92 tests across four affected suites passed. Coverage includes foreign-owner refusals, conflicting/concurrent rating replay, unrated cleanup, retention-write rollback, frozen content, DST/settings behavior and retired-history preservation. Logs: `/tmp/langlo-valid-green.log`, `/tmp/langlo-valid-focused.log`, `/tmp/langlo-valid-final-focused.log`.

### Local validation and acceptance boundaries

- Node 24.19.0 and npm 11.9.0; `npm ci --ignore-scripts` passed.
- Final type checks and lint passed; type checking reported zero errors and zero warnings. Formatting and diff checks are repeated after this evidence update.
- `npm test`: 98 files, 1,547 tests passed (`/tmp/langlo-valid-full-tests.log`).
- `npm run test:property`: six files, nine tests passed (`/tmp/langlo-valid-property.log`).
- Explicit production build passed after the unit suite (`/tmp/langlo-valid-build.log`).
- `npm run test:e2e -- --config=playwright.validation.config.ts`: 124 desktop/mobile tests passed against the production build with synthetic fixtures (`/tmp/langlo-valid-e2e.log`). The temporary config used port 4189 and was removed after the run. The reporter emitted source-coverage warnings on this ordinary production build; browser behavior passed, but this run does not establish a new source-coverage percentage.
- Local adversarial review used the current session with the repository skill's Tier 3 checklist. Verdict: `approve`. Summary: "No material findings in the local follow-up diff." Findings: `[]`. This is a self-review, not an independent provider review; `/tmp/langlo-valid-review.json` records the examined files.
- Codacy CLI was retried with file logging disabled. Its strict JSON report contains `MissingConfig` and no `toolResults`; no local Codacy scan ran. No configuration or dependencies were added to work around it. Hosted Codacy/CodeScene metrics and coverage require separate verification after an authorized push.

Only disposable local fixtures were used. No production provider calls, database changes, deployment, remote replies, thread resolutions or push were performed.
