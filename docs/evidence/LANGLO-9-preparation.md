# LANGLO-9 preparation evidence

Date: 2026-10-17. Branch: `codex/langlo-9-grammar-mastery`.
Baseline: `764f3059a6c5f06a719e2a865acf2456d3c6dbff`.
Scope: dependency audit, implementation plan and foundation validation only.

## Observed dependency

Read LANGLO-9, LANGLO-45, LANGLO-46, LANGLO-47, LANGLO-44 and the current
project column definitions through the connected It's a Plan tools.
LANGLO-44 is In Progress (column 68); Done is column 69. LANGLO-44 has no
development link and no comments at inspection. LANGLO-9 and LANGLO-45
explicitly require T017 to pass before T018 starts. No assessment planner,
assessment/results route, T016 evidence or T017 evidence exists at this head.

This is an upstream implementation/acceptance dependency, not a request for
another start approval. The owner has already authorized proceeding. The
preparation does not implement or claim completion of T018/T019/T020 or change
tracker states. The executable feature work must follow the accepted T017
contracts once available.

## Changes

Added `docs/plans/LANGLO-9.md`, including existing callers/storage, the ordered
T018/T019/T020 work, behavior-test cases, privacy boundaries and acceptance
checks. Application code, tests, content, configuration and Git history are
unchanged by preparation.

## Runtime and checks

Node reports `v24.19.0`. The ambient npm reports `11.16.0`; installed npm
`11.9.0` under `/tmp/langlo-9-toolchain` with scripts disabled and a temporary
npm cache. All validation uses the pinned npm CLI there, rather than ambient npm.

All commands below use `node /tmp/langlo-9-toolchain/node_modules/npm/bin/npm-cli.js`
as the npm entry point. No new behavior tests or red/green claim apply to this
documentation-only preparation.

| Command                                        | Observed result                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `npm ci --ignore-scripts --no-audit --no-fund` | Passed; 480 packages installed; lockfile unchanged.                    |
| `npm run check`                                | Passed; 0 errors, 0 warnings.                                          |
| `npm run lint`                                 | Passed.                                                                |
| `npm run format:check`                         | Passed.                                                                |
| `npm test`                                     | Passed; 47 files, 944 tests.                                           |
| `npm run test:property`                        | Passed; 4 files, 5 tests.                                              |
| `npm run build`                                | Passed; Node adapter build.                                            |
| `npm run test:e2e`                             | Passed; all 74 desktop/mobile tests against the built server in 40.0s. |

Installation emitted existing `@esbuild-kit/esm-loader` and
`@esbuild-kit/core-utils` deprecation notices. Build/browser commands emitted the
environment's `NO_COLOR`/`FORCE_COLOR` warning. No dependency or environment
configuration was changed to suppress them. Audit was not run.

## Pending acceptance

T017 passing and its accepted implementation reaching this branch; then T018,
T019 and T020 implementation, observed red/green tests and review. No real
provider, production database, paid call, Windows/desktop action, remote
publication, CI run, PR, deployment or release was performed.
