# Stryker setup — 2026-10-16

## Scope

Owner-approved local installation using `npm init stryker@latest`, selecting the
Svelte preset, Vitest runner, JavaScript configuration, and npm. Node 24.19.0 and
npm 11.9.0 were used (npm selected through `npm exec --package=npm@11.9.0`).
Installed `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` 10.0.0;
the runner resolves the existing Vitest 5.0.5 without peer dependency errors.

`stryker.config.mjs` targets TypeScript source, excluding tests, declaration
files, generated auth code, and Drizzle configuration. Svelte templates are not
in the mutation scope. Agent-tooling directories are excluded from sandbox
copying. Temporary files and HTML mutation reports are ignored by Git.
Application code, tests, and CI workflows were not changed by this task.

## Initial validation before the isolated branch

- `npm ci`: exit 0.
- `npm run check`: exit 0; zero errors and warnings.
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm test`: exit 0; 41 files, 813 tests passed.
- `npm run test:property`: exit 0; 4 files, 5 tests passed.
- `npm run build`: exit 0.
- `npm run test:e2e`: exit 0; 72 tests passed against the built Node server.

The first scoped Stryker dry run failed with `EISDIR` while copying the
`.claude/skills/adversarial-review` directory symlink. Excluding `.claude`,
`.agents`, and `.codex` fixed sandbox creation. The repeated command passed:

```sh
npx stryker run --mutate src/lib/prototype/results.ts --dryRunOnly --concurrency 1
```

It instrumented 111 mutants and passed the 14 related tests. A real mutation
smoke run also completed with exit 0:

```sh
npx stryker run --mutate src/lib/prototype/results.ts --concurrency 1
```

With the original `testRunner: 'vitest'` it reported 2 killed, 108 survived,
1 without coverage, 1.80% mutation score; `--coverageAnalysis off` returned the
same counts. That score was corrupted: `@stryker-mutator/vitest-runner` 10.0.0
(the latest release) builds test-name filters joined with spaces, while Vitest 5
matches full names joined with `>`, so mutants ran no tests. Deleting the
`session.answers.push(answer)` line by hand failed 2 of 14 tests in
`tests/prototype-results.test.ts`, yet Stryker reported that mutant as surviving.

The config now uses Stryker's built-in command runner
(`testRunner: 'command'`, `npx vitest run`), which runs the whole suite per
mutant: slower, but correct. A scoped check with the command runner limited to
`npx vitest run tests/prototype-results.test.ts` reported 97 killed, 13
survived, 1 timeout, zero errors, 88.29% mutation score. A run with the
committed full-suite command was not performed. `@stryker-mutator/vitest-runner`
remains installed but unused. This is an installation smoke test, not an
accepted quality baseline. No threshold or CI gate was added, and no tests were
changed to pursue a score.

## Pending acceptance and limits

No full-repository mutation run was performed. No new application behavior was
introduced; the observed sandbox failure and successful rerun are the setup's
red/green evidence. Existing behavior tests provided smoke coverage.

`npm audit` reports two moderate development-dependency findings:
Stryker core → `typed-rest-client@2.3.1` → `qs@6.15.1`.
No dependency override or unrelated audit fix was applied.

Local validation does not establish CI, release, live provider, or Windows Anki
acceptance. At the time of initial validation, no push, publication, provider call, deployment,
or account access was performed.

## Isolated PR validation

The owner subsequently authorized pushing this setup in a new PR. The branch
`chore/stryker-setup` starts from `origin/main` at
`0cfaa1c` in `/tmp/langlo-stryker-setup`. It preserves main's pinned Vitest
5.0.5.
The lockfile was regenerated from main; no existing dependency version changed.

PR validation uses Node 24.19.0, npm 11.9.0, and `npm ci --ignore-scripts`, with
required checks run explicitly. All commands exited 0:

- `npm ci --ignore-scripts`, `npm run check`, `npm run lint`, and
  `npm run format:check`.
- `npm test`: 40 files, 811 tests passed.
- `npm run test:property`: 4 files, 5 tests passed.
- `npm run build`.
- `npm run test:e2e`: 72 tests passed against the built Node server.
- Scoped Stryker smoke run: 111 mutants; 2 killed, 108 survived, 1 uncovered,
  zero errors, matching the initial run.

Final diff review confirmed only the five setup files changed and no existing
lockfile dependency version changed. This was a manual diff review; the
`pr-test-analyzer`, `silent-failure-hunter`, `code-reviewer`, and
`type-design-analyzer` review agents were not run. The known audit and mutation-score limitations remain open.

No new test-hardening changes are included. The mutation score remains
provisional and the two moderate transitive audit findings remain unresolved.
External review/provider calls were not invoked. This task has no checked-in
Stryker implementation spec.

## 2026-10-17 scoped setup repair follow-up

Stryker now has six explicit source-to-test scopes and the package command runs
them sequentially. The runner passes `stryker.config.mjs` explicitly so each
`LANGLO_STRYKER_SCOPE` selection is loaded; the configuration breaks below an
80% mutation score. `test-results` is ignored to prevent sandbox-copy failures
from transient Playwright output.

The focused mastery behavior test asserts all four status explanations and the
five-item/two-session secure boundary. `npx vitest run tests/mastery.test.ts`
passed (15 tests), and a targeted manual threshold mutation caused the existing
and added secure-status assertions to fail as expected.

A fresh Stryker run with the explicit mastery config instrumented 156 mutants,
but reported 0 killed and 0% mutation score. This conflicts with the direct
behavior-test mutation check, so the Stryker score is not accepted as a valid
result and the new 80% gate correctly remains unmet for mastery until the
Vitest/Stryker execution issue is resolved. The Stryker dry run itself passed.
No broad mutation rerun, CI run, remote publication, or deployment was performed.

Validation after this follow-up: `npm run check`, `npm run lint`,
`npm run format:check`, `npm test` (58 files, 1,064 tests),
`npm run test:property` (5 files, 7 tests), and `npm run build` passed. The
standard E2E command could not bind its default port because `127.0.0.1:4173`
was already occupied; the same built-server suite ran on an alternate local
port and passed all 76 tests after rebasing onto the updated branch. Formatting
and `git diff --check` also passed.

## 2026-10-17 active-mutant environment repair

The command-runner failure was reproduced using only the secure-status condition:

```sh
LANGLO_STRYKER_SCOPE=mastery node node_modules/@stryker-mutator/core/bin/stryker.js run ./stryker.config.mjs --mutate 'src/lib/server/mastery.ts:26-26' --concurrency 1 --cleanTempDir false --reporters clear-text,json --ignoreStatic
```

Before the repair, all 14 mutants survived (0%, exit 1). In the retained sandbox,
Stryker's mutant 12 changes `accuracy >= 0.8` to `accuracy > 0.8`. Running the
installed Vitest CLI directly with `__STRYKER_ACTIVE_MUTANT__=12` failed two
mastery tests, while the same command through `npx` passed all 17 tests.
No application source was manually changed for this diagnosis.

The local `npx` executable is a Distrobox wrapper. A child-process probe printed
`undefined` for `process.env.__STRYKER_ACTIVE_MUTANT__` through `npx`, compared
with `12` through direct Node execution. The wrapper lost the variable that
activates Stryker's mutations, so Vitest exercised the original behavior for
every mutant. The command runner's `covered 0` label separately reflects its
lack of per-test coverage reporting.

The configured command now invokes `node_modules/vitest/vitest.mjs` using
`process.execPath`, preserving the sandbox working directory, active-mutant
environment, and test exit status without a package-manager wrapper. The six
source/test scopes and the 80% break threshold are unchanged. The Vitest adapter
remains unused because of its separately documented Vitest 5 test-name issue.

The new `tests/stryker-config.test.ts` runs the actual configured command against
a disposable CLI fixture with no package-manager executable on PATH. It failed
before the config change (`expected '' to be '12'`) and passed afterward,
confirming the mutant variable and failing CLI exit status reach Stryker.
The same 14-mutant Stryker reproduction then killed all 14 (100%, exit 0), with
zero survivors, timeouts, or errors. Retained diagnostic sandboxes were removed.

Importing the config in the regression test also exposed the existing Stryker
options type annotation on the scope array. The annotation now validates the
config object with `@satisfies`, retaining the inferred scope and command types.
The regression test is listed explicitly in CODEOWNERS.

Repository validation used Node 24.19.0 and npm 11.9.0, with a clean
`npm ci --ignore-scripts` install. `npm run check` passed with zero errors or
warnings; `npm run lint`, `npm run format:check`, `npm test` (59 files, 1,065
tests), `npm run test:property` (5 files, 7 tests), `npm run build`, and
`npm run test:e2e` (76 tests on the default port) passed.

The complete `npm run test:mutation` command exited 0. It tested 855 mutants in
the six configured files in approximately 9 minutes 20 seconds, using only each
scope's listed Vitest files. Every scope passed the unchanged 80% break gate:

| Scope             |   Score | Killed | Timed out | Survived |
| ----------------- | ------: | -----: | --------: | -------: |
| prototype-results |  88.29% |     97 |         1 |       13 |
| assessment        |  83.72% |    252 |         0 |       49 |
| assessment-answer |  85.71% |     36 |         0 |        6 |
| mastery           |  80.77% |    126 |         0 |       30 |
| progress          | 100.00% |     27 |         0 |        0 |
| fallback          |  83.94% |    182 |         1 |       35 |

There were zero runner errors or uncovered mutants reported. Stryker includes
timeouts in the mutation score; the table lists them separately from kills.
The six scope-specific HTML reports under `reports/mutation/` were refreshed
and remain ignored by Git. No application tests were changed to raise scores
during this repair.

Local runs do not establish hosted CI, release, live-provider, or Windows Anki
acceptance. This repair has not been pushed.
