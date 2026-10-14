# Feature configuration, diagnostics, and public signup

**Branch:** `codex/config-error-safe-diagnostics`, based on `main` at
`6b71dcee9c597ac4f1e1a065b98de9a4f0a27707`. All evidence below is local and
uses disposable fixture databases and synthetic identities.

## Changes

- `ConfigError` retains only an allowlisted runtime variable name. Structured
  server logs include that name and the request correlation ID; values,
  arbitrary exception messages, and secret-bearing forged names are excluded.
- Invalid global data/auth configuration no longer blocks public or synthetic
  routes. `/app/**` and `/api/auth/**` return safe 503 responses when their
  required data/auth configuration or provider is unavailable. Session
  validation and deny-by-default ownership boundaries remain in place.
- SMTP validation is isolated to recovery. Invalid SMTP configuration does
  not prevent signup or sign-in. The `/signup` form and Better Auth email
  registration endpoint create normal database sessions, with a limit of five
  attempts per client per hour.
- Historical T010 no-registration acceptance was superseded by owner direction
  on 2026-10-13. Existing cross-learner isolation coverage and T011 acceptance
  remain required.

## Verification

- `npm run check` — Svelte check: 0 errors, 0 warnings.
- `npm run lint` — passed.
- `npm run format:check` — passed.
- `npm test` — 25 files, 286 tests passed.
- `npm run test:property` — 2 files, 3 tests passed.
- `npm run build` — passed.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e` — all
  60 desktop/mobile tests passed. This included public pages under invalid data
  configuration, API/form signup, signup rate limiting, denied anonymous
  access, and signup with malformed SMTP configuration.

## Remaining boundary

Invalid SMTP configuration returns a safe recovery-unavailable response. If
an actual SMTP send fails after Better Auth begins a reset request, Better Auth
normalizes the response for known and unknown accounts; this implementation
logs a safe diagnostic and preserves that enumeration resistance. The response
does not prove delivery. A durable outbox/status design is still needed before
the app can expose individual post-request delivery failures honestly without
revealing whether an account exists. No live SMTP/Turso access, real account,
production configuration, migration, deployment, push, or pull request was
performed.
