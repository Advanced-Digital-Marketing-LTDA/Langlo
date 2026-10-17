# Monocart Playwright coverage plan

## Goal

Use Monocart’s Playwright reporter and coverage reporter to measure source
statement, branch, function, and line coverage exercised by the Chromium E2E
suite, alongside the existing Vitest LCOV and route-module reach measures.

## Research

- `monocart-reporter` is a Playwright test reporter that emits a standalone
  HTML test report.
- `monocart-coverage-reports` collects Chromium V8 coverage and produces V8 or
  Istanbul reports, including statement, branch, function, and line metrics.
- The upstream Playwright example starts page JS/CSS coverage in an automatic
  fixture, adds each test’s data to Monocart, clears the run cache in global
  setup, and generates the report in global teardown.
- The project’s existing Playwright suite uses Chromium in both desktop/mobile
  projects and currently consumes `build` generated without source maps.
- Client/browser V8 coverage will not measure server-only routes. Server route
  coverage remains represented by the separately documented 20/20 route-reach
  matrix, and Vitest remains the source-wide LCOV measure.

## Decisions and scope

- Install `monocart-reporter` and `monocart-coverage-reports` as development
  dependencies with lockfile updates.
- Use one automatic Playwright fixture to collect Chromium JavaScript and CSS
  coverage; use global setup/teardown to clear and generate reports.
- Add an E2E-only Vite build command with source maps and minification disabled.
  Keep the normal build and production output unchanged.
- Run the E2E suite against the dedicated coverage build in CI and upload the
  Monocart coverage and test reports as a one-day artifact.
- Keep Playwright coverage independent from the existing Vitest LCOV upload;
  do not claim browser coverage for server-only route modules.
- Limit generated output to ignored report directories.

## Files likely to change

- `package.json`, `package-lock.json`
- `playwright.config.ts`
- `scripts/playwright-environment.mjs`
- New Monocart fixture, coverage options, and global teardown under `tests/` or
  `scripts/`
- `.github/workflows/ci.yml`
- `.gitignore` only if the chosen report directory is not already ignored
- `docs/evidence/E2E-route-coverage-80.md`

## Validation

- Install with `npm install --ignore-scripts` and confirm lockfile consistency.
- Run the focused owner-route suite and full desktop/mobile Playwright suite
  against the sourcemapped E2E build.
- Confirm the generated Monocart reports contain original project source files
  and non-empty statement/branch metrics, then record the observed results.
- Run `npm run check`, `npm run lint`, `npm run format:check`, `npm test`,
  `npm run test:property`, `npm run build`, and `npm run test:e2e`.

## Risks and limits

- V8-to-source statement and branch mapping depends on usable source maps; the
  dedicated E2E build keeps minification disabled to improve mapping accuracy.
- V8 does not provide effective branch data for every JavaScript construct.
- Chromium coverage covers browser-executed sources only, not the Node server.
- The first measurement may show less than 80%; no threshold will be enforced
  until a correctly mapped baseline is observed.
