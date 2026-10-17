## Goal

- Add behavior-based browser coverage for the learner session lifecycle and
  make the 80% target measurable without conflating Playwright with Codecov.

## Assumptions / constraints

- “Both” means at least 80% Vitest/Codecov line coverage and at least 80% of
  the server route modules exercised by browser tests.
- Preserve the existing dirty Stryker worktree; this branch starts at
  `origin/main` `91a9e61` in `/tmp/langlo-e2e-coverage-80`.
- Use only synthetic fixture accounts and disposable fixture databases.
- Keep source behavior, CI coverage thresholds, and build configuration
  unchanged.

## Research (current state)

- Modules/subprojects involved:
  - Existing built-server Playwright acceptance suite.
  - Vitest/Codecov coverage report, which is generated independently.
- Key files/paths:
  - `tests/e2e/owner-routes.spec.ts`
  - `tests/e2e/fixture-server.ts`
  - `src/routes/app/api/study-sessions/[id]/{next,pause,resume}/+server.ts`
  - `docs/evidence/E2E-route-coverage-80.md`
- Entrypoints (API/UI/CLI/Jobs):
  - Playwright uses the built Node server and synthetic SQLite fixture.
  - CI uploads `coverage/lcov.info` produced by Vitest; it does not merge
    Playwright execution into LCOV.
- Existing patterns to follow:
  - `owner-routes.spec.ts` provisions real fixture accounts, signs in through
    the rendered login route, and asserts persisted owner-scoped API results.
  - `tests/learner-routes.test.ts` covers the expected next/pause/resume
    transitions at the handler boundary.
- Baselines on clean `origin/main`:
  - CI-equivalent Vitest LCOV: 88.14% lines (1,902/2,158), 84.52% branches,
    89.28% functions across 63 source records.
  - There are 20 `src/routes/**/+page.server.ts` and `+server.ts` modules.
    Existing browser tests exercise 17 (85%); the three session lifecycle
    endpoints are the missing modules.

## Analysis

### Options

1. Instrument the browser and Node server and merge their source maps into the
   Codecov report. This is a broad build/CI change and is unnecessary to meet
   the current Codecov target.
2. Keep Codecov as the Vitest source metric and publish a separate explicit
   browser route-module matrix. Add one authenticated end-to-end lifecycle
   journey for the three currently unexercised API modules.

### Decision

- Chosen: option 2.
- Why: It matches CI’s existing measurement, avoids unsupported coverage
  merging, and raises browser route-module coverage from 17/20 to 20/20.

### Risks / edge cases

- The next-question route needs approved synthetic content in the fixture.
- Pause must prevent question delivery; resume must restore it and clear the
  paused timestamp.
- Exercise all transitions through HTTP with the owner’s signed-in browser
  context; do not invoke route handlers directly.

### Open questions

- None. The owner selected both Codecov line coverage and E2E route/flow
  coverage as the 80% measures.

## Q&A results (captured after the session)

- Outcome/acceptance criteria:
  - Keep Codecov line coverage at or above 80%.
  - Raise exercised server route-module coverage to at least 80%; target 100%
    by covering all 20 modules.
- Scope boundaries:
  - Add the missing synthetic learner-session lifecycle browser journey and
    its evidence matrix only.
- Constraints/non-goals:
  - No production behavior, workflow, threshold, dependency, or build changes.
- Decisions made in Q&A:
  - Measure line coverage from the existing Vitest LCOV report.
  - Measure E2E route coverage as exercised route modules / all 20 server route
    modules, mapped to tests in the evidence document.
- Remaining open questions:
  - None.

## Implementation plan

1. Add the lifecycle browser journey to `tests/e2e/owner-routes.spec.ts`, using
   the existing fixture account and approved synthetic package.
2. Assert the owner can fetch the next question, cannot fetch it while paused,
   and can fetch it after resuming; check response state and answer privacy.
3. Record the 20-route matrix, baseline and final E2E result in evidence.
4. Run focused and full Playwright checks plus required local checks, then
   review the branch diff.

## Tests to run

- `npm test -- --coverage --coverage.reporter=lcov`
- Focused new `tests/e2e/owner-routes.spec.ts` browser test.
- `npm run check`, `npm run lint`, `npm run format:check`, `npm test`,
  `npm run test:property`, `npm run build`, and `npm run test:e2e`.
