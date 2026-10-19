# Langlo authentication contract

**Status:** T010a selection approved 2026-10-10; **T010b implementation complete
on `codex/t010b-langlo-29`** — real `/api/auth/**`, `/login`, `/recover`,
`/reset` routes and a minimal authenticated `/app` landing exist against
disposable fixtures, with observed behavior recorded in
`docs/evidence/T010.md`. T010c route-level acceptance remains pending; no live
provider, production database, or real account has been touched.

**Owner direction revised 2026-10-13:** public self-service email/password
registration is now in scope. This supersedes the earlier two-private-pilot
and no-public-registration restriction recorded below and in historical T010
evidence. Signup still requires valid data/auth configuration; SMTP is only a
recovery dependency.

## Selection

Selected by owner decision on 2026-10-10: **Better Auth 1.7.x** with its Drizzle
adapter on the existing libSQL client, plus Nodemailer behind a `Mailer`
interface for the Proton SMTP submission path.

| Component                      | Selected version                                                    | Evidence                                        |
| ------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------- |
| `better-auth`                  | `1.7.7` (published 2026-09-30)                                      | `npm view better-auth version`                  |
| `@better-auth/drizzle-adapter` | `1.7.7` (same release train)                                        | `npm view @better-auth/drizzle-adapter version` |
| `nodemailer`                   | `10.0.13` (published 2026-09-30; `10.1.0` is newer but <7 days old) | `npm view nodemailer versions`                  |
| `@better-auth/cli`             | not a dependency; `auth.gen.ts` remains for ad-hoc regeneration     | removed at PR #15 audit remediation             |

Pins satisfy the repository's ≥7-day preference as of 2026-10-10, re-verified
at T010b install. The contract constrains the major line (`1.7.x`), not the
exact patch. Note: `better-auth@1.7.7` declares an outdated optional peer range
`@sveltejs/kit ^2.0.0`; the project pins Kit 3.0.1, so install uses
`--legacy-peer-deps` and the code deliberately avoids `better-auth/svelte-kit`
— the hook calls the plain `Request → Response` handler and API methods.

### Alternatives considered

| Option                                                                                                                   | Verdict                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hand-rolled sessions on `node:crypto` (Argon2id verified present in this Node 24.19.0 runtime), Copenhagen Book guidance | Viable — smallest dependency surface and full control — but every security-critical line is ours to own. Not selected.                                                                                                                               |
| Better Auth 1.7.x                                                                                                        | **Selected.** Maintained internals for hashing, sessions, reset flow, and rate limiting; official SvelteKit integration; Drizzle adapter on our existing libSQL client. Cost: larger dependency surface and framework-owned schema/routes/internals. |
| `lucia` v3 + `@oslojs/*`                                                                                                 | Rejected — Lucia deprecated March 2025; all `@oslojs/*` packages except `@oslojs/encoding` deprecated July 2026.                                                                                                                                     |
| Auth.js / `@auth/sveltekit`                                                                                              | Rejected — project in maintenance mode under the Better Auth team since 2025-09-22; SvelteKit package experimental; credentials+database sessions are its weakest path.                                                                              |
| Hosted identity (Clerk, Supabase Auth, Keycloak, …)                                                                      | Rejected — external identity dependency; conflicts with the selected Langlo-native account model.                                                                                                                                                    |

### Sources inspected 2026-10-10

- [Better Auth: SvelteKit integration](https://better-auth.com/docs/integrations/svelte-kit) — `svelteKitHandler`, `sveltekitCookies` plugin (requires SvelteKit ≥ 2.20; this repo pins 3.0.1)
- [Better Auth: Drizzle adapter](https://better-auth.com/docs/adapters/drizzle) — `provider: 'sqlite'`, field/model mapping support
- [Better Auth: email & password](https://better-auth.com/docs/authentication/email-password) and [options reference](https://better-auth.com/docs/reference/options) — `disableSignUp`, `sendResetPassword`, `resetPasswordTokenExpiresIn`, `revokeSessionsOnPasswordReset`, custom `password.hash`/`verify`
- [Better Auth: rate limit](https://better-auth.com/docs/concepts/rate-limit) — built-in sign-in rule, `customRules`, `storage: 'memory'|'database'|'secondary-storage'`; disabled by default outside production, so tests must enable explicitly
- [Better Auth: database/secondary storage](https://better-auth.com/docs/concepts/database) — session/rate-limit/verification storage options, including `verification.storeIdentifier: 'hashed'` (newer option; availability in the installed release must be confirmed at T010b)
- [Lucia deprecation/migration](https://lucia-auth.com/lucia-v3/migrate) and [pilcrowonpaper Oslo deprecation post](https://pilcrowonpaper.com/blog/18) (2026-07-29)
- [Auth.js joins Better Auth](https://better-auth.com/blog/authjs-joins-better-auth) (2025-09-22) and [@auth/sveltekit reference](https://authjs.dev/reference/sveltekit) (experimental)
- [Node.js crypto documentation](https://nodejs.org/docs/latest-v24.x/api/crypto.html) — `crypto.argon2`/`argon2Sync` (added Node 24.7, verified working on the pinned runtime)
- [Proton: SMTP submission](https://proton.me/support/smtp-submission) — host `smtp.protonmail.ch`, port `587` STARTTLS, PLAIN/LOGIN auth, per-app SMTP tokens
- [Nodemailer](https://nodemailer.com/) and [npm registry metadata](https://www.npmjs.com/package/nodemailer) — v10 requires Node ≥ 20, zero runtime dependencies, MIT-0

## Contract by requirement

### 1. Public registration and credentials

- `emailAndPassword.enabled: true` with `emailAndPassword.disableSignUp: false`.
  The `/signup` form and Better Auth `/api/auth/sign-up/email` endpoint create
  accounts. Rate limiting is database-backed: at most five attempts per hour
  per client address. Password length is 12–128 characters.
- Signup does not require SMTP or email verification. A healthy data database
  and `BETTER_AUTH_SECRET` are required; successful signup establishes the
  ordinary server-backed session.
- No social/OAuth provider, passkey, 2FA, or organization signup is enabled.

### 2. Sessions: creation, expiry, logout, revocation, request protections

- Database-backed sessions via the Drizzle adapter (`provider: 'sqlite'`) on the
  existing libSQL client. Session rows live in this database, so logout and
  revocation delete server state — not just a cookie.
- `session.expiresIn` = 7 days and `session.updateAge` = 1 day are set
  explicitly in `auth.ts`. Session cookie cache
  (`session.cookieCache`) stays **disabled**: every request re-validates the
  session row so revocation takes effect immediately.
- Cookie contract (observed in T010b on the pinned release): `HttpOnly`,
  `SameSite=Lax`, `Path=/`, `Max-Age=604800`; `Secure` is emitted only for
  HTTPS origins (`useSecureCookies` is pinned to the configured origin's
  scheme rather than NODE_ENV). `applyAuthCookies` forwards framework cookie
  attributes through `event.cookies` without adding `Secure` on HTTP and
  decodes the already-percent-encoded signed value so it round-trips intact.
- On HTTPS origins the session cookie is named `__Host-langlo.session_token`
  (`advanced.cookies.session_token.name`, with `useSecureCookies: false`
  because Better Auth would otherwise prepend `__Secure-`). A `__Host-` cookie
  cannot carry a Domain, so a sibling subdomain cannot shadow or replace it,
  and a stale `__Secure-better-auth.session_token` cookie from earlier deploys
  is never read. HTTP origins keep the plain `better-auth.session_token` name.
- Request protections: `trustedOrigins: [APP_ORIGIN]`; Better Auth's CSRF/origin
  checks stay enabled (`advanced.disableCSRFCheck` never set); SvelteKit's
  built-in form-action origin checking remains untouched.
- `emailAndPassword.revokeSessionsOnPasswordReset: true` — a completed
  recovery invalidates every other session for that account. Verified in
  T010b: session rows for the account drop to zero on reset redemption.
- **Observed residual:** Better Auth stores session tokens **unhashed** in
  `sessions.token` (the cookie value appends a signature suffix). Database-
  at-rest confidentiality is the compensating control; recorded openly in
  T010b evidence and re-asserted at T010c.
- `BETTER_AUTH_SECRET` is required configuration (secret env, ≥ 32 chars); it
  signs/encrypts framework tokens. Never committed, never logged.

### 3. Recovery: single-use, expiring, replay- and concurrency-safe

- `emailAndPassword.sendResetPassword` delivers the reset link through the
  `Mailer` interface (§6); `resetPasswordTokenExpiresIn: 1800` (30 minutes).
  Bad or unavailable SMTP affects recovery only: signup, sign-in, and public
  routes remain available. Invalid mail configuration returns a safe
  unavailable response. Better Auth catches actual delivery exceptions; the
  server records a safe diagnostic and keeps the same reset-request response
  for known and unknown addresses. A client-visible send-failure response
  needs a delivery design that preserves that enumeration guarantee.
- `verification.storeIdentifier: 'hashed'` exists in the pinned release and
  is configured — `verifications.identifier` holds a hash of
  `reset-password:<token>` while `value` holds the user id. Raw reset tokens
  are never persisted (observed in T010b).
- Single-use: a redeemed token must be unusable again (replay), and two
  concurrent redemptions of the same token must produce exactly one success.
  Better Auth's atomic `consumeVerificationValue` (delete-if-match) provides
  this — observed in T010b: replay returns 400 `INVALID_TOKEN` and a
  concurrent barrier yields exactly one 200. T010c re-proves it under a real
  process barrier (same technique as `tests/db-concurrency.test.ts`).
- A successful reset revokes all existing sessions (§2) and issues a fresh
  session only through the normal sign-in path or framework-authenticated
  response.

### 4. Enumeration resistance and rate limits

- Uniform responses: unknown and known emails produce the same status and
  body shape on login-failure and reset-request paths — observed in T010b
  (401 `INVALID_EMAIL_OR_PASSWORD` for unknown email and wrong password
  alike; identical reset-request success body for both). T010c asserts
  response equality, not copy text.
- Timing: `sendResetPassword` is deliberately fire-and-forget so known vs
  unknown delivery does not skew the response; Better Auth also runs a dummy
  verification lookup for unknown emails. Delivery failure is confined to
  allowlisted safe diagnostics.
- Rate limits (as configured; observed deterministic 429s in T010b; T010c
  re-asserts at route level):
  - `/api/auth/sign-up/email`: 5 per 3600 seconds per client.
  - `/api/auth/sign-in/email`: 5 per 300 seconds per client.
  - `/api/auth/request-password-reset`: 3 per 600 seconds per client.
  - `/api/auth/reset-password`: 5 per 600 seconds per client.
  - `rateLimit.storage: 'database'` so limits survive process restart (single
    Node adapter); `rateLimit.enabled: true` is set explicitly in every
    environment, since the framework default only enforces in production.
    Observed: `rate_limits` rows persist in SQLite across restarts, and the
    counter saturates at `max` rather than growing on rejected requests.
- Both auth API requests and form actions overwrite the internal
  `x-langlo-client-address` header with `event.getClientAddress()`. Better Auth
  uses only that header for rate-limit identity, so client-supplied forwarded
  address headers cannot create new buckets. Adapter proxy trust remains an
  operator configuration requirement; without trusted proxy forwarding,
  requests behind the same proxy conservatively share its address.

### 5. Learner ownership across sessions

- The hook resolves `auth.api.getSession({ headers })` once per request and
  populates `event.locals.user`/`event.locals.session`.
- `event.locals.user.id` maps to the existing `LearnerSession { userId }`
  consumed by `flashcards.ts` and future owner-scoped services. The service
  signature does not change.
- All owner isolation stays enforced where it already is: `owner_id` filters
  plus composite foreign keys on `enrollments`, `study_sessions`, `attempts`,
  `evaluations`, `skill_evidence`, `card_drafts`, `deliveries`, and the native
  flashcard tables. Auth adds the verified principal; it does not replace the
  ownership model. T011 still owns query-authorization hardening.
- The `/app/**` deny-by-default guard is preserved: without a valid session it
  behaves exactly as today (GET → `/login`, mutation → safe denial).

### 6. Provisioning and mail delivery

- **Provisioning** (`npm run accounts:provision`, server-only): an operator CLI
  in the style of `tests/fixtures/cli.ts` — explicit targets, guarded against
  ambient env, no credential logging, password read from stdin. Verified path
  in T010b: provisioning uses Better Auth's internals —
  `ctx.password.hash(password)` (the
  framework's scrypt hasher, single source of truth),
  `ctx.context.internalAdapter.createUser(...)` with the admin provisioning
  source, and `linkAccount` creating the `credential`-provider account row
  (`emailVerified: true`). Provisioning a real account on a real database is a
  separate authorized step, not part of T010b.
- **Mailer interface** (`src/lib/server/mail.ts`): one method, e.g.
  `send({ to, subject, text })`. Implementations:
  - `SmtpMailer` — Nodemailer transport: host `smtp.protonmail.ch`,
    port `587`, `secure: false` (STARTTLS), `auth.user` = the custom-domain
    sender address, `auth.pass` = a per-app **SMTP token**.
  - `CaptureMailer` — test/dev implementation recording messages for
    assertions; the only mailer usable in tests.
- **Provider requirements (Proton)**: a paid Proton plan, an active
  **custom-domain** address (SMTP tokens are unavailable for `@proton.me`
  addresses), a generated per-app SMTP token (shown once), and the domain's
  anti-spoofing DNS (SPF/DKIM/DMARC) intact. Mail sent this way is not
  end-to-end encrypted through the relay.
- **Unresolved setup steps (explicit):** purchase/confirm paid plan; verify a
  custom domain on the account; configure SPF/DKIM/DMARC; generate the
  `langlo-app` SMTP token; place it in the operator secret store as
  `PROTON_SMTP_TOKEN`; send a real recovery email end-to-end (a live-provider
  acceptance gate, not provable locally).
- **SMTP timeouts:** `SmtpMailer` sets connection (10 s), greeting (10 s) and
  socket (30 s) timeouts so a hung provider connection rejects and is logged.
- **Password-changed notice:** after a successful reset
  (`emailAndPassword.onPasswordReset`) the account receives a plain-text notice
  through the same background send path; failures are logged the same way and
  never change the reset response.
- **Delivery-failure limitation:** no durable mail outbox or retry worker exists.
  Invalid configuration is detected before reset requests are handled, but an
  SMTP failure after a request begins is logged as a `mail-delivery`
  diagnostic (operation, error category and correlation id only) without
  changing the generic response. Do not present that response as proof of delivery. A future
  outbox/status design must preserve unknown-vs-known account equivalence.

### 7. Safe logging

- Better Auth's internal logger is disabled or routed through `safeDiagnostic`;
  the app logs only fixed event categories (e.g. `login`, `recovery`,
  `session`, `provision`) with outcome and correlation ID.
- Never logged: passwords, password hashes, session tokens/cookies, recovery
  tokens/URLs, SMTP credentials, `BETTER_AUTH_SECRET`, email bodies. Email
  addresses are treated as private data — logged at most as non-reversible
  identifiers (e.g. HMAC of normalized address) when an event needs an actor,
  and T010b records what is actually emitted.
- T010c asserts secret-free logs with sentinel values (synthetic password,
  token, SMTP token) across login/recovery flows.

## Schema plan — migration `0005_auth_contract.sql` (next free version; 0004 is taken)

- `@better-auth/cli generate` produced the framework schema for review; output
  was merged by hand into `src/lib/server/db/schema.ts` and expressed as the
  checked-in migration `0005_auth_contract.sql` — never applied by a CLI
  against any real database.
- Final mapping (observed): the existing `users` table serves as the `user`
  model plus four new tables — `sessions`, `accounts`, `verifications`,
  `rate_limits`. Plural names follow house convention and are bound through
  explicit `modelName` options in `auth.ts` (deterministic; the adapter's
  `usePlural` inflection was not relied on). `users.email` stays nullable +
  unique so synthetic fixture users cannot collide on a blank value, and
  `users.updated_at` carries a constant `DEFAULT 0` because SQLite rejects
  non-constant `ALTER TABLE ADD COLUMN` defaults on populated tables.
- All tables get `owner`-style FK treatment where applicable: `session` and
  `account` rows reference the user and cascade on delete, consistent with the
  existing model.
- Migration 0005 is additive only; it must not rebuild existing tables, so the
  hand-authored triggers from 0001–0003 are unaffected. `drizzle-kit check`
  and clean/repeat migration tests apply.

## Implemented interfaces (T010b)

- `src/lib/server/auth.ts` — `createAuth(config, { db, mailer })` building the
  configured `betterAuth` instance with explicit plural `modelName` mappings;
  server-only.
- `src/lib/server/auth-runtime.ts` — memoized `resolveAuth()` wiring config →
  app database → auth at the request boundary.
- `src/lib/server/auth-cookies.ts` — `applyAuthCookies` forwarding framework
  `Set-Cookie` attributes through `event.cookies` (explicit `secure: false`
  on HTTP, decoded signed value) so form actions establish sessions.
- `src/lib/server/mail.ts` — `Mailer` interface, `CaptureMailer` (in-memory),
  `FileCaptureMailer` (JSON-per-message under `MAIL_CAPTURE_DIR`),
  `SmtpMailer` (Nodemailer; `secure: false`, `requireTLS: true`).
- `src/lib/server/accounts.ts` + `scripts/accounts-provision.ts` +
  `npm run accounts:provision` — guarded operator CLI.
- `hooks.server.ts` — correlation ID, security headers, feature-specific config
  handling,
  `/api/auth/**` handled by `auth.handler`, session resolution for
  `/app/**` + `/login`, deny-by-default guard preserved.
- `src/app.d.ts` — `Locals.user`/`session`/`correlationId` typing.
- Routes `/login`, `/signup`, `/recover`, `/reset`, and a minimal `/app` landing with
  sign-out — real forms replacing placeholders; `private, no-store` +
  `noindex` headers preserved.
- `src/env.ts` + `docs/environment.md` additions registered:
  `BETTER_AUTH_SECRET`, `MAIL_TRANSPORT`, `MAIL_FROM`, `PROTON_SMTP_TOKEN`,
  `SMTP_HOST`, `SMTP_PORT`, `MAIL_CAPTURE_DIR`.

## T010b implementation boundaries (executed)

Done within bounds: pinned dependencies installed; migration
`0005_auth_contract.sql` created and verified on disposable fixtures;
auth/mail/provision modules added; hook, locals, and the three auth pages
wired; `env.ts`/`environment.md`/`routes.md`/`schema.md` updated; unit and
e2e behavior tests written for implemented behavior; observed framework
behavior (cookie flags, token storage, error shapes, rate-limit counters)
recorded in `docs/evidence/T010.md`.

Must not: provision real accounts or call live SMTP/Turso; change the
`LearnerSession` service seam or
owner-scoped queries; weaken existing guards, assertions, or headers;
introduce OAuth/social providers, passkeys, 2FA, email verification flows, or
admin/organization plugins (out of pilot scope); merge, push, or deploy
without explicit authorization.

## T010c acceptance tests

Behavior tests against real routes, real session persistence on disposable
fixture databases, and the capture mailer — no live email claims:

1. **Public registration**: the `/signup` form and `/api/auth/sign-up/email`
   create an account/session with valid data/auth configuration; invalid
   configuration fails safely, and signup rate limits are enforced.
2. **Cross-learner isolation**: learner A's valid session cannot read or
   mutate learner B's decks, notes, cards, drafts, sessions, attempts, or
   review history — at route level and service level.
3. **Login/logout**: wrong and right credentials produce the specified
   outcomes; session rows are created on login and deleted on logout;
   emitted cookie attributes match §2.
4. **Session expiry and revocation**: expired sessions deny; password-reset
   revocation kills all pre-existing sessions for that account.
5. **Recovery lifecycle**: token issuance produces a captured message
   containing a usable link; an expired token rejects; a consumed token
   rejects on replay; two concurrent redemptions (real process barrier)
   yield exactly one success and one unchanged-password outcome.
6. **Enumeration resistance**: identical status and response shape for known
   vs unknown emails on login and reset-request paths.
7. **Rate limits**: configured thresholds produce deterministic 429s on both
   login and recovery; counters persist across server restart (database
   storage).
8. **Request protections**: mismatched-Origin POSTs reject; cookie flags as
   specified; `private, no-store` and `noindex` preserved on all auth routes.
9. **Secret-free logs**: synthetic password, session token, recovery token,
   and SMTP token sentinels never appear in captured diagnostics.
10. **Provisioning**: the CLI creates a working credential against a guarded
    fixture; logs contain no password/hash; the provisioned account then
    passes the real login path.

Tests must not match exact website wording, must not weaken existing
assertions, and must not present the capture adapter as proof of live Proton
delivery.

## Remaining provider and release gates

- Proton: paid plan, custom-domain verification, SPF/DKIM/DMARC, SMTP-token
  generation, secret storage, and a real delivery check are all unresolved
  external steps.
- Turso production provisioning, real account provisioning, deployment,
  reverse-proxy trust settings, and release acceptance remain separate gates.
- T010a selected the contract only; it does not prove implementation,
  delivery, or live access.
