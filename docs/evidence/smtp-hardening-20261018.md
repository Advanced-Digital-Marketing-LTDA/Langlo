# SMTP hardening and password-changed notice — 2026-10-18

Scope: `SmtpMailer` timeouts, a distinct `mail-delivery` diagnostic for failed sends, and a password-changed notice emailed after a successful reset (`emailAndPassword.onPasswordReset`). Changed code: `src/lib/server/mail.ts`, `src/lib/server/auth.ts`, `src/lib/server/diagnostics.ts`. Tests: `tests/mail.test.ts` (new), `tests/auth.test.ts`. Docs: `docs/auth.md`, `docs/environment.md`.

## Observed red then green

Red: the source changes were stashed (tests kept) and `npx vitest run tests/mail.test.ts tests/auth.test.ts` was run. Result: 4 failed | 24 passed (28). Failing tests:

- `auth.test.ts` > emails a password-changed notice to the account after a successful reset
- `auth.test.ts` > logs a mail-delivery diagnostic when the notice cannot be sent and still completes the reset
- `mail.test.ts` > defines finite connection, greeting and socket limits
- `mail.test.ts` > rejects when the provider accepts the connection but never greets

Green: with the source restored, `npx vitest run tests/mail.test.ts tests/auth.test.ts tests/diagnostics.test.ts` passed 33/33. Later commits added a `createMailer` default-timeout/missing-config test (`mail.test.ts` 4/4) and a reset-email delivery-failure diagnostic test (`auth.test.ts` 27/27 at that commit).

## Review follow-up (head after 13521b3)

Automated review findings were addressed: default timeouts are pinned to 10 s / 10 s / 30 s and asserted to reach `createTransport` through `createMailer`; the no-greeting test isolates `greetingTimeout` (socket and connection timeouts set high) and asserts `ETIMEDOUT` with a greeting message and elapsed time near 300 ms; the `mail-delivery` warning now carries a closed `template` label (`reset` or `password-changed`) and an allowlisted transport `code` (never the message); timeouts are passed to nodemailer as three explicit fields. Better Auth 1.7.7 calls `onPasswordReset` after the credential update (`node_modules/better-auth/dist/api/routes/password.mjs`, line 168 follows the `updatePassword` call), so the notice is not sent for a failed update. Focused run after these changes: `tests/mail.test.ts`, `tests/auth.test.ts`, `tests/diagnostics.test.ts` 36/36.

## Checks run locally

`npm run check` 0 errors/0 warnings; `npm run lint` clean; `npm run format:check` clean; the focused vitest runs above. The full ordinary suite, property tests, build and E2E were not run locally (too slow in the cloud environment); CI runs them. The merge-evidence receipt on the PR reports 1141 tests for head 7983060.

## Not proven

- No live Proton SMTP delivery has been attempted. Custom-domain verification, SPF/DKIM/DMARC and the `langlo-app` SMTP token remain pending (see `docs/auth.md` §6); a real reset and password-changed email end to end is still the live-provider acceptance gate.
- The timeout test covers a server that accepts the TCP connection but never greets. Connection-timeout and socket-timeout paths are not exercised independently; timeout values are asserted finite and positive only.
- No STARTTLS-completing fake SMTP server exists, so a successful `SmtpMailer.send` is not exercised.
- No durable outbox or retry; a failed send is logged only.
