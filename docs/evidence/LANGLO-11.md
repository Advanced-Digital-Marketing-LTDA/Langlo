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
