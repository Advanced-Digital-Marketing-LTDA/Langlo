# PR 21: c6c94bf review

PR https://github.com/Bonobo791/Langlo/pull/21 remains draft at published head
`c6c94bf69215dd6c75eb3816173ebe408b734c77`. The prepared fixes were pushed
under owner approval; no additional branch push is authorized in this turn.

## Exact-head results

Quality, Dependency review, ESLint, OSSAR, CodeQL, Semgrep and the merge-evidence
gate passed. SonarCloud passed with zero new issues. Codacy remains
`action_required`: its reported gate is 11 new clones against a maximum of one.
The additional neutral ESLint scan says a main-branch scan configuration was
not found; the actual ESLint workflow passed.

Gitar confirmed the previous timing and signup-redirect findings resolved,
then found an IP-spoofing bypass: Better Auth accepted client-supplied
`X-Forwarded-For` as a rate-limit identity. This is valid and is fixed locally
by overwriting an internal address header from `event.getClientAddress()` for
API and form requests, and configuring Better Auth to read only that header.
HTTP tests vary both forged forwarding and internal headers and still reach
the same five-attempt limit. Form sign-in also tests forged address headers.

Local cleanup centralizes form auth dispatch and safe failure logging, recovery
unavailability responses, fixture-port allocation, server startup polling and
rate-limit resets. It addresses repeated blocks reported by the duplication
gate; only fresh hosted analysis after publication can establish its result.

## Blocked metadata operation

Automatic approval review rejected changing the PR body to update the test
count and recovery description. Its stated reason was that the exact public
description was not approved and the copied assertion of public-registration
approval was unsupported. The PR body remains unchanged. No workaround was
used. Branch-protection reads were also forbidden to the integration, so no
required-check policy was inferred from those reads.

## Local validation

The unpublished address/duplication follow-up passes `npm test` (289 tests in
26 files), `npm run test:property` (3 tests), Svelte check (zero errors and
warnings), lint, formatting and build. All 60 desktop/mobile E2E tests passed
using `/usr/bin/chromium`. No copy or website-text tests were added.

## Readiness gate

The PR was not marked ready because Codacy's gate and the new published
rate-limit finding are still unresolved. The local follow-up requires another
push approval and fresh exact-head checks. Readiness approval already exists
for after applicable checks pass; merge and deployment remain outside scope.
