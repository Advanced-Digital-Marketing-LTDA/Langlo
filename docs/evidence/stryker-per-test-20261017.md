# Stryker per-test coverage and failure reporting — 2026-10-17

## Scope and operation

Run `npm run test:mutation` with Node 24.19.0 and npm 11.9.0. The command first
runs `svelte-kit sync`, including after an installation with `--ignore-scripts`.
It keeps the six existing source/test scopes, four workers, and 80% break gate.
No application behavior, dependencies, or CI workflows changed. Three deterministic
mastery ordering cases were added after the new reports exposed a fluctuating gate.
Mutation runs default `FC_SEED` to `0`, honor an explicit override, and print the seed.

The native Vitest adapter now collects per-test mutation coverage. HTML and JSON
reports are written to `reports/mutation/<scope>.html` and `<scope>.json`.
They include named test definitions, `coveredBy`, `killedBy`, completed-test counts,
source locations, and assertion/exception details. Console output lists the scope,
source and test files, named/covering/killing test counts, result counts, and report
paths. Both reports are removed before their scope runs and checked afterward;
missing, empty, invalid, or stale report data cannot turn a failed run green.

`NoCoverage` is a test gap, not a successful test execution. It counts against the
mutation score and is printed with its source location. Timeouts are reported
separately from assertion-based kills. Ignored static mutants retain their reasons
and counts. An individual test labeled `covered 0` passed the baseline but did not
execute this scope's mutated code; this differs from a mutant running zero tests.

## Compatibility and error handling

The installed `@stryker-mutator/vitest-runner` 10.0.0 uses space-separated test
filters, while Vitest 5 matches suite chains with `>` separators. The issue and
upstream fix are documented in [Stryker issue 6210](https://github.com/stryker-mutator/stryker-js/issues/6210).

`scripts/stryker-vitest-runner.mjs` translates coverage IDs into Vitest 5
filters, retaining Stryker's original IDs so report links remain consistent.
New parallel workers collect test names before selecting their first mutant's
tests. This is a narrow bridge over pinned adapter internals, checked at startup;
unsupported adapter/Vitest versions fail with an explanation. No installed
dependency files are patched. Remove the bridge when the upstream fix is released.

The adapter rejects empty or skipped-only execution and unknown coverage IDs.
It preserves native errors and adds file/test context. Failed assertions retain
their messages and stacks. An exception with an empty message is explicitly
described as such, with its test and available exception type/stack. If Vitest
supplies no usable failure details, the result is a runner error rather than an
unexplained kill.

The command validates fresh JSON reports even when Stryker exits nonzero, so an
exit code cannot hide the underlying reported error. Runtime/compile errors,
pending results, empty scopes, missing coverage or killing-test links, dangling
test IDs, zero completed tests, and missing failure explanations fail the run.
Failures name the scope, command, report path, and available source/mutant/reason;
original child output and error causes are preserved. Later scopes do not run
after a failure. The new verification tests are listed explicitly in CODEOWNERS.

## Observed red and green evidence

- Native adapter before the bridge: all 14 secure-threshold mutants survived;
  Stryker reported `Ran 0.00 tests per mutant on average` (exit 1).
- The same 14 mutants with the bridge: 14 killed, zero survivors/errors;
  individual covering and killing tests were reported (exit 0).
- A parallel-worker regression failed before test-name collection was added,
  then passed after the fix.
- CLI fixtures previously accepted a successful process with missing/stale or
  malformed reports. They now fail with scope and artifact details.
- The first full native run cleared all six score gates, but report validation
  rejected fallback mutant 178 because its failure explanation was empty.
  A focused rerun now retains the failing test and exception stack for that
  mutation. Its two-mutant slice scored 50% because the other mutant survived;
  the unchanged 80% gate correctly returned exit 1 for that slice.
- A later run correctly stopped mastery at 79.35%, compared with 80.65% earlier.
  Two ordering mutants changed status between runs. Deterministic cases now pin
  timestamp precedence, insertion-sequence ties, and attempt-ID ties; the property
  seed is recorded so mutation sampling can be replayed.
- Empty-message and missing-diagnostics regressions failed before diagnostic
  enrichment, then passed. A CLI regression also confirmed that missing HTML
  cannot pass just because valid JSON exists. The focused verification suite
  passed 26 tests after these repairs.

## Final validation

The complete `npm run test:mutation` command exited 0 with `FC_SEED=0`. It
processed all 855 generated mutants in approximately two and a half minutes.
All six score gates and fresh-report validations passed, with zero runner errors.

| Scope             |   Score | Named tests | Covering tests | Killed | Survived | Uncovered | Ignored | Timeouts |
| ----------------- | ------: | ----------: | -------------: | -----: | -------: | --------: | ------: | -------: |
| prototype-results |  88.07% |          14 |             14 |     95 |       12 |         1 |       2 |        1 |
| assessment        |  83.61% |          24 |             21 |    250 |       49 |         0 |       2 |        0 |
| assessment-answer |  85.71% |          11 |              3 |     36 |        3 |         3 |       0 |        0 |
| mastery           |  81.29% |          20 |             17 |    126 |       26 |         3 |       1 |        0 |
| progress          | 100.00% |           3 |              3 |     27 |        0 |         0 |       0 |        0 |
| fallback          |  84.21% |          50 |             30 |    176 |       32 |         1 |       9 |        0 |

Eight uncovered mutants remain visible as location-specific warnings and count
against their scope's score. Fourteen static mutants are ignored under the
existing `--ignoreStatic` policy. Timeouts contribute to Stryker's score and are
listed separately from kills. Mastery ordering mutants 50, 51, and 53 changed
from Survived to Killed after the deterministic behavior cases were added.
Fallback mutant 178 now has its failing test and exception stack in the report.

Node 24.19.0 and npm 11.9.0 were used with `npm ci --ignore-scripts` and explicit
validation. `npm run check` passed with zero errors/warnings; `npm run lint`,
`npm run format:check`, `npm test` (61 files, 1,093 tests),
`npm run test:property` (5 files, 7 tests), `npm run build`, and
`npm run test:e2e` (76 tests) passed. No application source changed during this
follow-up. Generated reports remain ignored by Git.

## Acceptance boundary

Use `npm run test:mutation` for the complete gate: direct Stryker diagnostic
commands bypass the command's fresh-artifact and report-integrity checks.
The compatibility bridge depends on adapter internals and must be reviewed on
dependency upgrades. The preceding command-runner repair was pushed as `85d71ce`
at the owner's request; this per-test follow-up has not been pushed. Local checks
do not establish hosted CI, release, live-provider, or Windows Anki acceptance.
