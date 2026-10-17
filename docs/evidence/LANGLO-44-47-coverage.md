# LANGLO-44–47 coverage improvement

2026-10-17. Follow-up to PR #94, starting from `27a9229`.

## Scope and behavior

Added 17 behavior tests using disposable synthetic SQLite fixtures: 11 real
assessment page/action tests, three saved-assessment edge cases, two mastery and
recommendation cases, and one progress filter case. Production files, coverage
configuration/thresholds and dependencies are unchanged by this follow-up.
The existing combined browser journey receives a test-local 40-second budget;
its assertions and the global timeout are unchanged.

The tests exercise persisted assessment creation and replay, login requirements,
owner isolation with zero-write rejection, safe question projection, invalid and
out-of-order answers, Not sure, completion/results redirects, paused-session
resume, exact completed-item reporting, report replay and owner-only listing.
Service cases cover cross-owner/reused start tokens, invalid saved-plan versions
and bounds, missing evaluations remaining uncertain, rollback of a failed mastery
ledger write, incorrect evidence contributing zero, deterministic prerequisites,
and filtering one enrollment from several tracks.

## Comparable coverage

The before run uses a clean archive of `27a9229` at
`/tmp/langlo-coverage-baseline` (1,045 tests, 57 files). The after run uses the
additional tests (1,062 tests, 58 files). Both passed. Both runs use identical
Vitest CLI include patterns so previously unimported files count in the baseline:

```sh
npm test -- --coverage \
  '--coverage.include=src/lib/server/*.ts' \
  '--coverage.include=src/routes/app/**/+page.server.ts' \
  --coverage.reporter=json --coverage.reporter=json-summary \
  --coverage.reporter=lcov --coverage.reportsDirectory=/tmp/<run>
```

Commands use Node 24.19.0 and npm 11.9.0 via
`node /tmp/langlo-9-toolchain/node_modules/npm/bin/npm-cli.js`.
Reports and logs: `/tmp/langlo-coverage-{before,after}-scoped` and matching `.log`
files. No checked-in coverage settings changed. Aggregate only the 13 new server
runtime files introduced by this PR, identified from
`git diff --name-only --diff-filter=A origin/main...27a9229`:

| Measure   | Before           | After            |
| --------- | ---------------- | ---------------- |
| Lines     | 188/263 (71.48%) | 263/263 (100%)   |
| Branches  | 149/202 (73.76%) | 194/202 (96.04%) |
| Functions | 54/83 (65.06%)   | 80/83 (96.39%)   |

| New server file                                                  | Before lines   | After lines  |
| ---------------------------------------------------------------- | -------------- | ------------ |
| `src/lib/server/assessment-answer.ts`                            | 0/13 (0%)      | 13/13 (100%) |
| `src/lib/server/assessment.ts`                                   | 78/81 (96.29%) | 81/81 (100%) |
| `src/lib/server/content-reports.ts`                              | 29/34 (85.29%) | 34/34 (100%) |
| `src/lib/server/mastery.ts`                                      | 55/55 (100%)   | 55/55 (100%) |
| `src/lib/server/progress.ts`                                     | 10/10 (100%)   | 10/10 (100%) |
| `src/lib/server/recommendations.ts`                              | 10/11 (90.9%)  | 11/11 (100%) |
| `src/routes/app/assessment/+page.server.ts`                      | 0/7 (0%)       | 7/7 (100%)   |
| `src/routes/app/assessment/[language]/+page.server.ts`           | 0/11 (0%)      | 11/11 (100%) |
| `src/routes/app/assessment/session/[id]/+page.server.ts`         | 0/19 (0%)      | 19/19 (100%) |
| `src/routes/app/assessment/session/[id]/results/+page.server.ts` | 0/14 (0%)      | 14/14 (100%) |
| `src/routes/app/map/+page.server.ts`                             | 3/3 (100%)     | 3/3 (100%)   |
| `src/routes/app/progress/+page.server.ts`                        | 3/3 (100%)     | 3/3 (100%)   |
| `src/routes/app/reports/+page.server.ts`                         | 0/2 (0%)       | 2/2 (100%)   |

The earlier default coverage run omitted unimported route modules entirely;
explicit CLI includes make this comparison meaningful. This is server coverage,
not an assertion of 100% application or Svelte component coverage. Remaining
branches include defensive form coercion and rare transaction-cleanup paths;
rollback rejection callbacks are not forced through mocks merely for a score.

## Observed red and green

The new route suite first passed 11/11 against the existing implementation.
For a regression sensitivity check, a disposable archive under
`/tmp/langlo-coverage-fault-probe` omitted the assessment form handler's
`recordAttempt` write. The Not sure/replay/completion test failed: the final
answer returned HTTP 409 instead of the expected 303 because the first answer
had never persisted. Log: `/tmp/langlo-coverage-red.log`. The mutation exists only
in that archive and was restored before the clean-install green run.

An exploratory probe that removed only the results action's question-ID check
still returned 404 for a nonexistent item through the underlying service. That
probe did not establish sensitivity to that particular guard; no mutation score
is claimed.

## Validation and boundaries

- Clean snapshot `npm ci --ignore-scripts --no-audit --no-fund`: passed,
  480 packages installed, with the committed dependency/lockfile versions.
- `npm run check`: passed, zero errors and warnings.
- `npm run lint`: passed in the clean snapshot.
- `npm run format:check`: passed in the clean snapshot; final evidence and the
  browser timeout line also receive a focused formatting check.
- `npm test`: passed in the clean installed/restored snapshot, 58 files and
  1,062 tests; log `/tmp/langlo-coverage-clean-test.log`.
- `npm run test:property`: passed, five files and seven tests.
- `npm run build`: passed against unchanged application source.
- Initial `npm run test:e2e`: 72/74 passed; the extended practice/assessment/
  progress/report journey exceeded its inherited 20-second total budget on both
  devices, including a targeted retry. The desktop trace reached the progress
  view with no failed assertion. Only this test now gets 40 seconds; every
  assertion remains. With that budget the complete journey passes in 22.9s on
  desktop and 26.2s on mobile. Final full-suite result: **74/74 passed** (3.8 minutes),
  `/tmp/langlo-coverage-e2e-final.log`.

Clean validation logs use `/tmp/langlo-coverage-clean-*.log`; install, property
and build logs use `/tmp/langlo-coverage-{ci,property,build}.log`.

The other active Codex
session owns `package.json`, `stryker.config.mjs`, `scripts/run-stryker.mjs` and
Stryker evidence; those changes are excluded from this test follow-up commit.
The shared-worktree lint initially scanned generated Stryker sandboxes; preserved
copies are at `/tmp/langlo-coverage-preserved-stryker-20261017`. A rerun passed
before the other session recreated the sandbox directory. Clean-snapshot checks
avoid depending on that transient directory state.

Hosted Codecov patch coverage is a separate result. The earlier report for
`adebee2` was 80.87% against an 82.98% target; local server coverage does not prove
the hosted patch gate. No live providers, paid calls, production data, Windows
Anki, deployment or release acceptance were exercised.
