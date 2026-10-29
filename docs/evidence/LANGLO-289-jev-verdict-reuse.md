# LANGLO-289: reuse saved Jev verdicts

Task: https://plan.advanceddigitalmarketingltda.com/LANGLO-289

## Behavior

Prepared grading still runs first. Unmatched written answers reuse the newest compatible correct/incorrect evaluation for the same owner, question, content version and exact answer text. Equal timestamps use evaluation ID as a deterministic tie-breaker. Existing evaluator/rubric compatibility remains required. There is no expiry or reset triggered by jev-latest changes. Uncertain outcomes and failed-grading markers are excluded.

Reused verdicts go through the existing evaluation writer and evidence/session completion path, with a separate evaluation for each new permitted attempt. Hits work without a configured provider and bypass provider calls and usage reservation. No schema, public interface, curriculum or UI changes.

## Observed validation

- Node 24.19.0; npm 11.9.0 installed under /tmp; npm ci --ignore-scripts passed.
- Red: 3 failed / 29 passed in tests/attempt-fallback.test.ts before implementation. Failures demonstrate repeat provider calls and unavailable-provider reuse missing. An initial test typo in the usage table name was corrected before recording this red run.
- Green: final focused run 33 passed, including correct/incorrect reuse, old timestamps, provider-disabled reuse, exact text, owner and question isolation, incompatible rubric/evaluator exclusion, uncertain/error exclusion, and assisted retry preservation. Existing prepared/not-sure/replay and grading-boundary tests also pass.
- npm run check: 0 errors, 0 warnings. npm run lint: passed.
- npm run format:check: failed on seven unrelated files: .ai/cezar/runs.json, .claude/settings.local.json, two .thinkrail context JSON files, .vitest/json/output.json, docs/environment.md and docs/schema.md. The two tracked docs also fail Prettier on their HEAD content. Changed files pass targeted formatting; unrelated files preserved.
- npm run test:property: 6 files, 9 tests passed.
- Initial npm test in sandbox: 119 files passed / 9 failed; 2151 tests passed / 30 failed, plus one unhandled error. Failures include EPERM on subprocesses and localhost sockets, and an analytics date mismatch. The analytics mismatch also reproduces on an untouched HEAD archive (1 passed / 1 failed).
- npm run build: passed. Initial browser invocation failed under sandbox restrictions.
- Full suite outside sandbox: 127 files passed / 1 failed; 2180 tests passed / 1 failed. The sole failure is the independently reproduced HEAD analytics date mismatch (expected 2026-10-29, received 2026-10-28). No task-related failures remain.
- Fresh build after the full suite: passed. Browser preflight outside sandbox passed. Full browser run: 189 passed / 1 failed. The mobile test `does not rewrite the lesson URL after leaving a freshly scrolled map` fails at its pending-timer assertion (exercises.spec.ts:787). It fails on an isolated rerun and also on an untouched HEAD archive after a successful baseline build. This existing navigation failure remains outside scope.

## Acceptance and limits

No live provider calls, production database, CI invocation, push or deployment. Local checks do not establish live-provider, hosted CI or release acceptance. Task created and read back as LANGLO-289, Todo, initiative 62, due date unset; no existing tracker metadata changed.

No fuzzy matching, cross-owner sharing, uncertain-verdict caching or simultaneous-call deduplication. Saved grading mistakes can persist indefinitely. Unique answers still require Jev.

## Test-audit corrections

The original reuse tests bypassed usage accounting and used a text date in an integer timestamp column. They now run `evaluateFallback` with real `typesafeUsage` and a synthetic provider. They assert one recorded call and 120/12 input/output tokens after a miss, then unchanged accounting after reuse. The old verdict uses Unix milliseconds (`946684800000`).

Two tests seed conflicting verdicts to distinguish descending creation time from descending ID on equal timestamps. A fast-check property generates Unicode answer text and sequences across two owners and two distinct answers, checks first-judgment reuse against an independent map, separate evaluation/attempt identities, idempotent replay and real call/token accounting. It uses the repository's 100-run defaults and seed/path controls, with seed 0 for recorded runs. The usage clock is fixed; all provider responses are local synthetic data.

The normal mutation runner now includes a `fallback-cache` scope for the lookup block in study.ts (lines 687–716) and both example/property test files. Update that range if the block moves. The configured 80% threshold is unchanged.

### Observed red/green proof

- Corrected focused suite: 36 tests passed (35 examples, one 100-run property).
- Standard Stryker: 13 killed, zero survivors, timeouts, uncovered mutants or errors.
- Stryker does not mutate SQL predicates or ordering internally. For those unsupported faults only, a disposable HEAD archive with the current source/tests was used. The source was committed locally before mutation, each fault was applied separately and restored in a finally block; the real working source was never changed.
- Reversing timestamp order killed the newest-verdict example; reversing ID order killed the equal-timestamp example.
- Removing owner filtering killed the property, seed 0, path `0:0:1:0:3:3:3:2`; the minimal sequence is owner B then owner A submitting the same answer.
- Removing exact-answer filtering killed the property, seed 0, path `0:0:1:0:0:1:1`; the minimal sequence is one owner submitting the two distinct answers.
- Both shrunk sequences are retained as explicit property examples. The seed/path values above describe the discovery run before those examples were added.
- Restoring the disposable source returned all 36 tests to green.

### Final verification of the corrections

- Type checking: zero errors/warnings; lint passed. Targeted formatting and git diff whitespace checks passed. Repository-wide formatting still fails on the same seven unrelated files listed above.
- Full suite: 128 files / 2183 tests passed; one analytics date test failed, matching the previously reproduced baseline failure.
- Property suite: all 7 files / 10 tests passed, using FC_SEED=0 and the final retained examples.
- Fresh build: passed.
- Final Stryker run with the retained examples: 13 killed, zero survivors, timeouts, uncovered mutants or errors. The repository report validator accepted all 36 named tests, 28 covering tests and 3 killing tests. Reports: reports/mutation/fallback-cache.json and reports/mutation/fallback-cache.html (generated, untracked).
- Browser suite: 188 passed / 2 failed. Both failures are the unchanged map-navigation timer test at tests/e2e/exercises.spec.ts:787 (desktop and mobile). The mobile case was already reproduced on untouched HEAD during the implementation audit; the desktop case failed in this run as well. No navigation source or browser test was changed.

Production code was not changed by these test-audit corrections. The successful npm 11.9.0 locked installation from the implementation was reused; dependencies and lockfile are unchanged.

## PR publication verification

The approved diff was applied to current origin/main (7b188c7, Specs and Docs Updates #191) in an isolated worktree. The historical Jev rating fix from #190 is preserved. The mutation range was shifted by two lines to match this base. Prior implementation/audit results above refer to the original checkout; final publication-branch results are recorded below.

Final publication-branch validation on Node 24.19.0 / npm 11.9.0, FC_SEED=0:

- Fresh npm ci --ignore-scripts passed.
- Type checking: zero errors/warnings; lint passed.
- Formatting: changed files passed; repository-wide check reports only unchanged docs/environment.md and docs/schema.md.
- Full suite: 2190 passed / 1 failed across 130 files. The sole failure remains the analytics date assertion in tests/home-analytics-round-trips.test.ts:186 (expected 2026-10-29, received 2026-10-28).
- Property suite: all 10 tests across 7 files passed.
- Adjusted fallback-cache scope: all 13 mutants killed; no survivors, timeouts, uncovered mutants or errors. The report validator accepted the report and its source matches this branch.
- Fresh build passed, followed sequentially by all 190 desktop/mobile browser tests passing. The earlier navigation timer failures did not reproduce on this final branch; no navigation fix is included.
- No live provider, production database or deployment validation. Push and PR publication were explicitly authorized by the owner; merge and deployment are outside scope.
