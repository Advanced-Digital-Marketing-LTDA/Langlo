# LANGLO-10 local implementation evidence

## Scope

Implement approval-gated editable Basic / bounded T003 Cloze mistake drafts,
stable note/card identity, UUID review idempotency, and append-only review events
that retain the resulting scheduler snapshot. No live provider, production
database, external account, paid request, or remote publication was used.

## Observed test-first failure

Focused behavior tests were added before the service changes. The first focused
run recorded these expected failures:

- a newly created draft already had one `native_flashcards` row (expected zero);
- review event reads did not contain the resulting scheduler state;
- `submitReview` accepted `not-a-uuid` and scheduled it.

## Migration repair and validation

The first focused migration regression reproduced
`SQLITE_ERROR: no such column: state_json`: the generated table rebuild selected
the new column from the pre-migration table. It also omitted the existing
`WITHOUT ROWID` option and append-only triggers. With owner approval scoped to
the new, unapplied 0023 migration and its metadata, the migration was repaired
to add nullable `state_json` in place. It now preserves the table layout and
triggers, fails closed if a draft has review history, deletes only unreviewed
draft/rejected scheduler rows, and retains reviewed rejected notes and their
events. Notes and legacy event rows remain; legacy snapshots read as `NULL`.

The migration regression verifies the added column, preserved note/event data,
`WITHOUT ROWID`, all three append-only triggers, a clean foreign-key check, and
the fail-closed case without card/event loss. After the repair, both new focused
migration cases passed.

## Local checks

- Runtime: Node `24.19.0`; npm `11.9.0` invoked through the pinned npm bootstrap.
- Dependencies: `npm ci --ignore-scripts` completed using the task-local npm
  cache.
- `npm run check`: pass, 0 errors and 0 warnings.
- `npm run lint`: pass.
- `npm run format:check`: pass.
- `npm test`: pass, 87 files and 1,366 tests.
- `npm run test:property`: pass, 5 files and 7 tests.
- `npm run build`: pass.
- `npm run test:e2e`: pass, 98 desktop/mobile browser tests against the built
  Node server with synthetic fixtures.
- `git diff --check`: pass.

## Outside this local verification

- Anki client import behavior, hosted CI, production login/storage, and release
  behavior remain outside this local evidence.

## PR #125 review follow-up

This follow-up corrects the stale migration guidance and splits the long review
and migration paths into small helpers. It does not change scheduling behavior,
ownership checks, transaction boundaries, SQL effects, or error codes. No
migration or Drizzle metadata file was changed.

- The focused migration and native flashcard tests passed before this
  follow-up (2 files, 31 tests). After splitting the long tests and refactoring
  the service methods, they passed again (2 files, 32 tests).
- The follow-up for the remaining CodeScene findings reduces `applyReview`'s
  parameter count and separates persisted state, idempotency, and stale-revision
  assertions into focused native flashcard tests. The focused suite passed
  again (19 tests).
- Final local checks passed with Node `24.19.0` and pinned npm `11.9.0`:
  `npm run check` (0 errors and 0 warnings), `npm run lint`,
  `npm run format:check`, `npm test` (87 files, 1,369 tests),
  `npm run test:property` (5 files, 7 tests), `npm run build`, and
  `npm run test:e2e` (102 desktop/mobile browser tests). The build and browser
  runner printed the existing `NO_COLOR`/`FORCE_COLOR` warning. `git diff
--check` passed.
- `npm test -- --coverage --coverage.reporter=lcov` passed (87 files, 1,369
  tests). Comparing local LCOV with the PR base shows 56 of 58 added executable
  lines in `src/lib/server/flashcards.ts` covered (96.55%), above the previous
  hosted Codecov target of 87.08%. Codecov must rerun on this updated revision
  to confirm its own diff calculation.
- The PR's SonarCloud summary reported 0.0% coverage on new code. The repository
  quality workflow generates `coverage/lcov.info` for Codecov but has no
  SonarScanner step, so SonarCloud coverage import remains unresolved. Sonar's
  [JavaScript/TypeScript coverage guidance](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/test-coverage/javascript-typescript-test-coverage)
  says coverage requires a CI-based scanner to import the LCOV report; automatic
  analysis does not support coverage. No scanner workflow, credentials, or
  external SonarCloud settings were changed here.
- Production database migration and rollback remain unverified release gates.
  Only disposable local fixtures were migrated, as required by repository
  policy.
