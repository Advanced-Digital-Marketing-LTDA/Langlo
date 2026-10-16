# Vitest coverage and Codecov workflow

Owner approved installing Vitest and V8 coverage, then updating the existing
Quality workflow to generate and upload LCOV. Application code, Vite configuration,
other workflows, repository secrets, and remote publication remain untouched.
Existing uncommitted package edits were preserved.

## Changes

- Installed matching `vitest` and `@vitest/coverage-v8` versions `5.0.5`, saved as
  `^5.0.5`. The initial unversioned install failed with `ERESOLVE` because npm
  selected coverage 5.0.5 alongside installed Vitest 5.0.3. Installing the matching
  pair succeeded; subsequent `npm ci` and `npm ls` passed.
- The existing CI test command now generates `coverage/lcov.info` while retaining
  the JSON report consumed by the merge-evidence gate.
- Added `codecov/codecov-action@v5` with the owner-supplied slug
  `Advanced-Digital-Marketing-LTDA/Langlo` and `secrets.CODECOV_TOKEN`. Upload runs
  after successful tests on pushes and same-repository PRs; fork PRs still run
  tests without invoking this secret-backed upload.
- Preserved all-branch push/PR triggers, pinned toolchain, `--ignore-scripts`
  CI installations, read-only workflow permissions, and existing quality checks.

## Observed validation

Node `24.19.0`; npm `11.9.0` selected through `npm exec`.

- Red: `npm test -- tests/codecov-workflow.test.ts` exited 1: 2 tests failed
  because coverage generation and the upload step were absent.
- Green: the exact CI coverage command exited 0: 470 tests passed across 40 files.
  `node scripts/validate-vitest-evidence.mjs .ci-reports/vitest.json` confirmed
  470/470 passed, with no failed or skipped/disabled tests.
- Generated LCOV contained 47 source records and completed record markers.
- `npm ci` passed and reported zero vulnerabilities.
- `npm run check`, `npm run lint`, `npm run format:check`, `npm test`,
  `npm run test:property`, `npm run build`, and `npm run test:e2e` passed after
  dependency installation. Ordinary tests passed 468 tests before the two workflow
  tests were added; properties passed 5 tests; browser tests passed 72 tests.
- Check and lint passed again after adding the workflow and regression tests.
- `git diff --check` passed.

## Publication preparation

The owner subsequently authorized pushing and explicitly removed the mandatory
PR Review Toolkit, external adversarial review, and gstack review requirements
from `AGENTS.md`. Those reviews were not run. The spec-validation rule and other
repository guidance remain in place.

Before publication, the Codecov commit was rebased onto remote main
`0cfaa1c41cd2b8530aa431bfdffc1d8f1fe601b3`, preserving incoming curriculum and
import changes. Clean installation, check, lint, formatting, coverage tests,
property tests, and build passed again on the combined tree. Coverage tests
passed 813 tests across 41 files; the existing evidence validator confirmed
zero failed or skipped/disabled tests. All 72 browser tests also passed again.

## Pending acceptance

The owner must configure `CODECOV_TOKEN` for the supplied Codecov repository.
Secret presence, slug ownership, GitHub-hosted execution, and successful receipt
by Codecov were not checked. No upload, secret change, deployment, real
provider call, or paid review ran during local validation. Local coverage generation does not prove
hosted upload success. The Vite Codecov plugin was not installed or configured.
