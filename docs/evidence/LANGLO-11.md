# LANGLO-11 local evidence

## Test-first red

- Environment: Node `v24.19.0`; pinned npm `11.9.0`; disposable local fixture databases only.
- Baseline before feature tests: `npm test` passed 87 files / 1,370 tests.
- After adding the first behavior tests, `npm test -- tests/learner-journeys.test.ts` reported 6 feature failures and 28 existing passes. The failures exposed missing study-schedule APIs, preview, cross-deck search, and suspension, plus tags and deck moves missing from note updates.
- The timezone tests covered the 04:00 cutoff, 23/25-hour DST days, a skipped local date, and the earlier occurrence of an ambiguous time.
- Regression tests initially failed for Unicode case-insensitive search (`école` versus `ÉCOLE`) and stale UTC-only guidance after a timezone was saved. Both now pass.
- The first generated migration failed database-backed tests with `SQLITE_ERROR: no such column: tags_json` and would have omitted existing hand-written note guard triggers. After explicit approval to correct it, migration `0024` was made additive: it creates the preference table and adds `tags_json` with a valid default and check, preserving note rows and triggers.
- The first full unit run also found legacy-upgrade fixtures using the current note writer before `tags_json` existed, and an object-preservation assertion that counted the newly-created preference table index. The fixture now inserts the historical note shape, and the assertion excludes that new auto-index.
- The first full E2E run reported 4 failures / 100 passes across desktop and mobile: ambiguous selectors, immediate reads after enhanced form submits, and an assumed review-card order. The browser tests now scope selectors, wait for the rendered save/action result, and seed deterministic due order.

## Green and required checks

- Focused FSRS browser checks: 4/4 passed across desktop and mobile.
- `npm run check`: passed; 0 errors and 0 warnings.
- `npm run lint`: passed.
- `npm run format:check`: passed.
- `npm test`: passed 88 files / 1,386 tests.
- `npm run test:property`: passed 5 files / 7 tests.
- `npm run build`: passed with the Node adapter.
- `npm run test:e2e`: passed 104/104 tests across desktop and mobile.
- `git diff --check`: passed.
- Migration, ownership, retention bounds, preset validation, deferred settings adoption, preservation of card state and review events, note search/tags/deck moves, suspension, answer reveal, intervals, due counts, preview assumptions, and timezone boundaries have local test coverage.
- Application validation used disposable local databases and the built Node server; no production database, learner data, or external provider calls were used. Tracker status and dates were left unchanged.

## Synthetic desktop screenshots

Captured during the built-server browser flow using its disposable test account:

- [Study schedule preview](LANGLO-11-settings-preview.png)
- [Cross-deck search](LANGLO-11-decks-search.png)
- [Revealed review card and intervals](LANGLO-11-review.png)

## PR #127 review follow-up

- Reviewed the bot findings at head `029a1df`. Search matched serialized JSON keys and punctuation: a new `front`/`[]` regression assertion failed (`1 failed, 20 skipped`) before the fix, then passed (`1 passed, 20 skipped`) after search began matching parsed note text, explanation, tags, and deck name.
- Removed the silent 16-review-per-card preview cutoff. The simulation continues until the seven-day boundary, with its existing one-minute forward-progress fallback. The existing seven-day stability and exclusion tests passed after the change.
- Addressed SonarCloud's new-code `reduce()` finding with an explicit initial day, and its catch-binding naming finding. Moved note/tag validation into a server-only module while preserving the public `FlashcardError` export and callers; separated preview day selection from the review loop.
- Pinned npm `11.9.0` ran `npm ci --ignore-scripts` and every repository check: `check` (0 errors, 0 warnings), `lint`, `format:check`, `npm test` (88 files / 1,386 tests), `test:property` (5 files / 7 tests), `build`, `test:e2e` (104/104 desktop and mobile), and `git diff --check`. All passed using disposable local fixture databases.
- Remaining hosted gate status must be checked against the pushed follow-up head; local checks do not clear CodeScene, Codacy, or SonarCloud results for the previous commit.
- Hosted `ffab162` passed SonarCloud but Codacy flagged the relocated string code-point iterator expression. Replaced it with `Array.from(value).length`, which preserves Unicode code-point bounds without computed property invocation; split basic and cloze content validation so the reported complex conditional is local to each format. Focused validation passed 3 files / 72 tests and `npm run check` reported 0 errors, 0 warnings. CodeScene still reported maintainability gates for long tests and complex methods; those findings are tracked separately from the correctness and security fixes.

## Follow-up on five below-gate findings

- The two search findings described one path. JSON-key false matches had already been fixed at `baac448`; the new 50-result test first failed with 56 results. Search now scans at most 1,000 owner-scoped notes per request, returns at most 50 matches, and provides a cursor link to search later notes. A test finds a match beyond the first scan page. Unicode matching still happens against parsed visible values in JavaScript.
- The due-list query test first failed with three `execute` calls for one card, where two were expected. The list now reads stored card state, parameters, and explanation in its joined query; one schedule lookup remains. Focused tests passed 3 files / 62 tests after the change.
- A synthetic 501-row preview test first failed because the scenario did not disclose any cap. Preview now selects approved, unsuspended cards due before the seven-day boundary, ordered by due time, and simulates at most 500. It says when the cap applies and yields to the event loop after each 64 simulated reviews. Saved-versus-selected results stay deterministic for the same inputs.
- Removed vacuous helper-existence tests and early-return guards. The stable preview fixture now asserts exact seven-day counts, averages, and busiest days rather than positive counts only.
- Pinned npm `11.9.0` checks passed again: `check` (0 errors, 0 warnings), `lint`, `format:check`, `npm test` (88 files / 1,387 tests), `test:property` (5 files / 7 tests), `build`, `test:e2e` (104/104), and `git diff --check`. Only disposable fixture databases and the built Node server were used.
- Rare searches may need multiple page requests to reach a later match; the scan and result limits bound each request, while a future indexed search would reduce total work. A capped preview describes only the earliest 500 eligible cards, not the whole account.
- After cursor paging was added, focused persistence and learner route tests passed 2 files / 58 tests, including continuation beyond the first 1,000 scanned rows and the `after` page query parameter. The full checks passed again: `check` (0 errors, 0 warnings), `lint`, `format:check`, `npm test` (88 files / 1,387 tests), `test:property` (5 files / 7 tests), `build`, `test:e2e` (104/104), and `git diff --check`.

## Stale rating interval review finding

- The PR review found that a Review page left open across a Study schedule save could show intervals from old settings while the rating action applied the new settings. A new behavior test first failed with `{ reviewed: true }` where a 409 conflict was expected (1 failed / 35 skipped).
- The Review form now carries the schedule values used for its displayed intervals. The server compares those values inside the review transaction before changing the card or appending a review event. The focused learner journey suite passed 36/36, including unchanged card state and empty history after the conflict, then a successful rating after reload.
- Pinned npm `11.9.0` checks passed on this fix: `check` (0 errors, 0 warnings), `lint`, `format:check`, `npm test` (88 files / 1,388 tests), `test:property` (5 files / 7 tests), `build`, `test:e2e` (104/104 desktop and mobile), and `git diff --check`.

## Validation of five later below-gate findings

- Search already bounded each request to 1,000 owner notes and 50 results; JSON-key false matches and N+1 due-card lookups were also already fixed. However SQLite's plan sorted owner notes before the page limit. A new index test first failed because `native_flashcard_notes_owner_cursor` was absent. Forward migration `0025` adds that index, and search now selects the limited owner page before joining deck names. The index and query-plan test passed. Existing migration files remain untouched.
- Preview already capped eligible cards at 500 and yielded every 64 simulated reviews. Its per-schedule review loop was still unbounded, so it now stops after 4,096 simulated ratings and discloses that limit if reached. An unreadable persisted card is skipped and disclosed rather than failing the preview.
- The unreadable-card behavior test first failed with `UNSUPPORTED_SCHEDULER_VERSION` in `listDueCards`. It now passes: the bad card is marked unavailable, a healthy card remains reviewable, and Preview reports one skipped card. A rendered Review test confirms the warning and healthy card appear together.
- The `studyDayStart` tests already had no early-return guards. The remaining `feature()` indirection in learner journey tests has been replaced with direct typed imports and action calls; type checking passed with zero errors and warnings.
- The new forward index initially made the legacy-upgrade preservation test fail because it compared the old and upgraded index lists without excluding newly introduced objects. That fixture assertion now excludes only the new index; the focused upgrade test passed. The existing migration SQL and metadata were not edited.
- Pinned npm `11.9.0` clean install with `--ignore-scripts` passed. Final local checks passed: `check` (0 errors, 0 warnings), `lint`, `format:check`, `npm test` (88 files / 1,391 tests), `test:property` (5 files / 7 tests), `build`, `test:e2e` (104/104 desktop and mobile), and `git diff --check`. Only disposable fixture databases and the built Node server were used.

## Due queue follow-up on PR review

- The PR review identified a valid edge case: the first 20 due rows could all be unreadable, hiding a healthy card behind them. A new fixture with 20 unsupported scheduler cards followed by one healthy card failed before the fix (`expected false to be true`).
- Due-card listing now reads ordered batches until it finds the requested number of healthy cards or reaches the end. It counts unreadable rows separately, keeps them untouched, and yields between batches. The focused persistence, learner journey, mistake card, and Review rendering suites passed 4 files / 94 tests; `check` reported zero errors and warnings.
- Final local checks passed after this follow-up: `check` (0 errors, 0 warnings), `lint`, `format:check`, `npm test` (88 files / 1,392 tests), `test:property` (5 files / 7 tests), `build`, `test:e2e` (104/104 desktop and mobile), and `git diff --check`. Only disposable fixture databases and the built Node server were used.

## CI and comment triage follow-up

- At PR head `cc6d548`, the push-triggered Foundation job failed Overlock on a narrowed due-result assertion (`ASSERTION_NARROWED`, high). The same job reported a removed negative render assertion at medium severity; the server now omits unreadable cards before rendering. Codecov patch coverage failed at 79.94% against 87.15%, and Codacy and CodeScene failed complexity and maintainability gates. The pull-request-triggered Foundation job passed on that head.
- Recombined the due-list expectations into a whole-result assertion. Local Overlock against `HEAD~1` then reported only the medium removed-render-assertion finding, with no high findings. The focused four-file run passed 85/85 after adding behavior cases for malformed schedule, search, note metadata, and suspension inputs. A first run of the unapproved-card case failed because draft notes have no card (`NOT_FOUND`); the test now asserts that actual contract and confirms the approved card can be suspended through the page action.
- Pinned Node 24.19.0 and npm 11.9.0: `npm ci --ignore-scripts`, `check` (0 errors, 0 warnings), `lint`, `format:check`, `npm test -- --coverage` (88 files / 1,395 tests; 92.31% line and 87.27% branch coverage overall), `test:property` (5 files / 7 tests), `build`, `test:e2e` (104/104 desktop and mobile), and `git diff --check` passed. Hosted patch coverage and analyzer gates must be checked against the pushed follow-up head.
