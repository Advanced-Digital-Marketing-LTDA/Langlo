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
