# Homepage account controls

Scope: add visible Sign in and Sign up links to the homepage using existing
authentication routes and established button colors, spacing and rounding.
Controls wrap on narrow screens, have 44px minimum height and inherit the
global keyboard focus outline. Existing content, shell and auth handlers are
unchanged; signed-in users retain the auth routes' redirect to `/app`.

Base: current remote main `2d6f953477763defb6d13b00f059d449ff263bef`,
checked with `git ls-remote` and fetched before creating
`codex/homepage-auth-controls`. Open PR inspection found only #132 (grammar
retention); it does not own this homepage fix.

## Regression evidence

Added the browser regression before the implementation. Against the unchanged
main build, both desktop and mobile failed with:

```text
expect(locator).toBeVisible() failed
Locator: getByRole('link', { name: 'Sign in', exact: true })
Error: element(s) not found
2 failed
```

The test checks accessible link names, exact `/login` and `/signup` hrefs,
visibility in the initial viewport, minimum 44px target dimensions, sequential
Tab focus, visible focus outline, Enter activation and both destination headings.
Existing foundation tests cover horizontal overflow and capture both viewport
screenshots. Existing auth tests exercise local synthetic sessions and redirects.

## Validation

Node 24.19.0, npm 11.9.0. Installation succeeded with
`npm ci --ignore-scripts --cache /workspace/.npm-cache` after the default cache
was unwritable. Browser runs use the installed system Chromium via
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`; the default Playwright
browser download is absent. Browser preflight passes.

- `npm run check`: zero errors and warnings.
- `npm run lint`: passed.
- `npm run format:check`: passed; evidence file checked separately after writing.
- `npm test`: 95 files, 1,479 tests passed.
- `npm run test:property`: 6 files, 9 tests passed.
- `npm run build`: passed.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`
  after a fresh build, sequentially after unit/property tests: 126 passed across
  desktop and mobile in 3.9 minutes, exit 0 (no retries or skipped tests).

The focused homepage regression passed on desktop and mobile in the full run.
Both screenshots were visually reviewed; both layouts have visible controls and
no horizontal overflow.

The initial full browser run overlapped the rebuild in
`tests/sentry-vite-config.test.ts`: a mobile map fixture briefly could not find
`build`, and the existing server later timed out waiting for prototype hydration
after client assets were replaced. That run was stopped. The unit suite should
have run before browser validation. The fresh build and sequential full browser
rerun passed, including both affected cases; no map or prototype code was changed.

Local validation uses synthetic fixtures only and does not establish CI or
production success. No push, PR action, deployment or remote configuration change
is part of this task; publication requires Andrew's immediate approval.
