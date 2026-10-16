# LANGLO-125 · Preserve assessment holdouts

Date: 2026-10-16. Base: local main `569534b`. Branch: `codex/langlo-125-holdouts`, isolated worktree `/tmp/langlo-holdouts-125`. Owner approved this bounded implementation in the conversation. Repository main and its unrelated AGENTS.md edit were left untouched. No tracker transition, remote publication, provider call, credential access, remote migration or deployment was performed.

## Behavior and scope

- `ContentQuestion.holdout` is an optional boolean. Omitting it preserves legacy package/version fingerprints and defaults to practice storage. Explicit flags participate in both fingerprints; malformed flags fail with `INVALID_PACKAGE` before writes. Changing a stored question's classification fails with `CONTENT_CONFLICT`.
- Migration `0008_question_holdouts.sql` adds `questions.holdout` with a non-null default of false and a 0/1 check. It uses one `ALTER TABLE ADD COLUMN`; it does not rebuild a table, remove triggers, alter old migrations or rewrite learner history. The generated snapshot and journal accompany it. Migration 0007 was already occupied by the independently implemented content-payload fingerprints, so the approved holdout migration uses 0008.
- Import stores the flag and compares it with existing question identities. The authored-module test helper now carries existing JSON flags instead of dropping them. French A1 module 01 imports 48 practice items and 12 holdouts in disposable fixtures.
- `recordAttempt` reads the owned session's mode and the stored question's flag. New holdout attempts in `practice` or `mixed-review` fail with existing `CONTENT_UNAVAILABLE`; all private tables remain unchanged. `assessment` accepts holdouts and preserves idempotent replay. Existing owner filters, quarantine checks and prior-attempt replay are retained.
- No lesson/question selection UI exists in this slice. The future lesson runtime must also filter holdouts out of practice selection. This change enforces the existing attempt-write boundary, not a new lesson runtime.

Changed implementation: `src/lib/server/content-import.ts`, `src/lib/server/study.ts`, `src/lib/server/db/schema.ts`; new migration/snapshot and migration journal. Changed tests: `content-import`, `learner-owner-scope`, `db-constraints`, `db-migrations`, `db-remote-migrate`, `fr-a1-module-01`, and `fixtures/curriculum-module`. Updated `docs/schema.md`. No curriculum content, matcher or tracker edits. This PR also carries the separate Codecov change (`.github/workflows/ci.yml`, `tests/codecov-workflow.test.ts`, exact-pinned `vitest` and `@vitest/coverage-v8` 5.0.5 in `package.json`/`package-lock.json`); see `docs/evidence/codecov-coverage-20261016.md`.

## Observed red and green

Tests were written before the holdout implementation. Initial pre-schema execution reported 14 failures, including missing-column errors; those are schema absence, not proof of the behavior assertions. After the additive schema change, before implementing import/study behavior:

```text
vitest run tests/content-import.test.ts tests/learner-owner-scope.test.ts tests/fr-a1-module-01.test.ts --maxWorkers=2
Test Files 3 failed (3)
Tests 8 failed | 66 passed (74)
```

Observed failures: the imported true flag was stored as 0; the real module stored all 60 questions as practice; malformed flags were accepted; changing an explicit flag did not change the package identity; practice and mixed-review promises resolved instead of rejecting. The assessment acceptance case already passed after adding the column, since assessment itself was already supported.

After the implementation and migration-inventory updates:

```text
vitest run tests/content-import.test.ts tests/learner-owner-scope.test.ts tests/db-constraints.test.ts tests/fr-a1-module-01.test.ts tests/db-remote-migrate.test.ts tests/db-migrations.test.ts --maxWorkers=2
Test Files 6 passed (6)
Tests 160 passed (160)
```

The package-fingerprint case was strengthened to test legacy-adoption refusal independently of a stored version fingerprint. A further immutable-version fingerprint test was verified by temporarily removing the flag from `versionFingerprint`: `1 failed | 50 passed (51)`. Restoring the implementation gave `51 passed (51)`. The temporary mutation is not retained.

Constraint cases cover persisted 2, -1, 0.5, string `true` and null. The existing historical-upgrade test now checks old questions default to 0 and `PRAGMA foreign_key_check` is empty, alongside unchanged content/attempt rows, triggers/indexes and verified legacy fingerprint adoption. Existing migration rerun, guarded local stand-in status/plan/apply and rollback tests include migration 0008.

## Validation

Final command runs used Node **24.19.0** and npm **11.9.0**, selected through `/tmp/langlo-125-toolchain` (npm CLI from the existing local cache). An initial setup used the wrong npm executable; the install was repeated with the pinned CLI. A preliminary test run overlapped that reinstall and reported missing worker-preload modules; it is not counted as a clean baseline or a behavior red. Clean final runs below supersede it. No package or lockfile changes remain.

| Command                                                          | Observed result                                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `npm ci`                                                         | Pinned rerun succeeded; 294 packages installed, zero vulnerabilities        |
| `npm run check`                                                  | 0 errors, 0 warnings                                                        |
| `npm run lint`                                                   | Pass                                                                        |
| `npm run format:check`                                           | Pass                                                                        |
| `npm test`                                                       | 41 files, 827 tests passed; ordinary suite includes properties              |
| `npm run test:property`                                          | 4 files, 5 properties passed                                                |
| `npm run validate:curriculum`                                    | Approved bundle 1.0.0; 125 records, 164 edges                               |
| `npm run build`                                                  | Built Node adapter successfully                                             |
| `npm run test:e2e`                                               | **Failed: 38 passed, 34 failed**, desktop/mobile against fresh built server |
| `drizzle-kit check --config src/lib/server/db/drizzle.config.ts` | Pass                                                                        |
| `git diff --check`                                               | Pass                                                                        |

Logs for this run are `/tmp/langlo-125-{ci-pinned,behavior-red,green,fingerprint-mutation-red,fingerprint-green,final-check,final-lint,final-test,final-property,final-curriculum,build,e2e,format-check,drizzle-check}.log`.

### Browser acceptance remains open

The E2E run includes hidden-heading assertions, browser connection errors (`Object with guid ... was not bound in the connection`, target/page closed) and navigation/click timeouts. These were not converted into skips or weaker assertions.

A separate snapshot of unchanged base `569534b` was built at `/tmp/langlo-125-baseline`, using the same installed dependencies. Its existing desktop `public shell works with keyboard navigation and browser history` test was run with only the server/baseURL port changed to 4187 so it could coexist with the feature run. It also failed: the `Language Grammar Coach` heading was present but reported hidden. Log: `/tmp/langlo-125-baseline-e2e.log`. This establishes that particular failure predates the holdout diff; it does not establish the cause of all 34 failures. Trying the already installed full Chromium 1243 executable for the same baseline test failed to launch because `libcups.so.2` is missing (`/tmp/langlo-125-baseline-chrome.log`). No browser, OS, dependency or UI changes were made.

## Pending acceptance and compatibility

- The local browser gate above was not green. Hosted CI `foundation` (run 38960646352, head `b392672`), which runs `npm run test:e2e`, passed. No real provider, release or deployment success is inferred from local tests.
- Only disposable local fixture databases were migrated. Applying 0008 anywhere else requires a separately authorized owner action.
- Existing rows lack recoverable holdout metadata and default to practice. This migration does not infer classifications from IDs or silently rewrite previously imported questions. Correctly flagged content imports require the version/fingerprint rules; changed classification needs new content identities and curriculum versions.
- Legacy imports with omitted flags remain compatible. Introducing explicit flags, including false, intentionally changes fingerprints. The original recorded package can still be verified and adopted; new packages cannot claim that legacy identity.
- Shared answer matching and lesson runtime remain outside this approved slice. The future practice selector must exclude holdouts before sending questions to learners.
