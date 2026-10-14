# Signup review follow-up — 2026-10-14

## Scope and baseline

Fetched `origin/main` at `40716f19cbba810957dc7b1af24def7d8eb5e1af` (PR21 merge). Changes are published in branch `fix/signup-session-boundary`, [PR23](https://github.com/Bonobo791/Langlo/pull/23), at head `958d99d4682e25c0692ddc4f9f65213e896002b8`. The closed PR21 branch is untouched. Read repository `AGENTS.md`, `docs/auth.md`, and existing proxy-policy evidence. The owner authorized publication after local validation. No production access, provider call, topology change, or new environment variable.

## Findings

- **Valid, fixed: signup after failed session lookup.** The hook previously retained a failure flag only for `/app/**`; `/signup` could resolve an action with no principal after a database failure. GET and POST signup now return 503 before resolving the page/action. Public routes remain available. Lookup exceptions are distinguished from an anonymous result.
- **Valid, fixed: signed-in API signup.** The hook now resolves identity for `/api/auth/sign-up/email`. A verified existing session returns 409 without invoking registration or forwarding any new cookie. An indeterminate identity returns 503. Anonymous registration still reaches ordinary Better Auth validation, CSRF/origin protections, database-backed rate limits, and real session creation. Form signup retains its existing redirect for signed-in learners.
- **Valid, deferred product/security design: signup enumeration.** Installed `better-auth@1.7.7`, `dist/api/routes/sign-up.mjs:155–204`, returns 422 for an existing email when verification is disabled and automatic sign-in is enabled; a new account returns a real session at lines 255–262. Generic duplicate behavior requires verification or `autoSignIn: false` and returns a synthetic user with a null token. Replacing duplicate failure with success would falsely imply account creation; issuing a session without authenticating the existing account would be unsafe. Even hiding the duplicate error code cannot hide real new-account session creation. Therefore full enumeration resistance needs an approved registration workflow change, preferably ownership verification with a truthful generic acknowledgment and no immediate session. That would change the accepted SMTP-independent public registration contract. No fake users, sessions, false account-success claims, authentication changes, or new SMTP dependency are introduced here. The existing form already uses a generic failure. Residual API disclosure is explicit and unresolved.
- **No demonstrated correctness bug: proxy env reads.** `authRequestHeaders` checks the actual adapter process variables and then validates `getClientAddress()`. The runtime parser intentionally handles application configuration while adapter configuration is checked at the authentication boundary. Direct reading neither bypasses identity validation nor brings SMTP errors back into global startup. Centralization is optional refactoring; no change is justified for these fixes. The fixed deployed-policy declaration remains `ADDRESS_HEADER=x-forwarded-for`, `XFF_DEPTH=1`. Live topology is not verified.
- **Valid product tradeoff, deferred: five signup attempts/hour/IP.** Five anonymous learners sharing NAT exhaust the bucket, and invalid attempts count too. Keep current controls pending a product decision. Recommend a layered strategy: retain an IP burst ceiling, add per-address limits and a challenge for sustained registration, and provide a controlled classroom onboarding route; choose thresholds from expected classroom cohort sizes and measured abuse. Do not simply remove the IP limit or silently invent a higher threshold. Existing tests continue to prove exactly five accepted attempts and 429 thereafter; fixture attempts explicitly send no session cookie to represent separate anonymous learners.
- **Valid, fixed: blank API name.** Installed signup schema uses `z.string()` without a nonblank constraint. A shared Better Auth before hook rejects empty and whitespace-only names before account creation. Both form and API registration use this handler; the browser's `required` attribute is no longer the only guard.
- **Valid, fixed: regex Unicode flags.** Two existing E2E diagnostics assertions lacked `/u`; flags added, assertions retained.
- **Invalid: missing ORIGIN implies HTTP.** Installed `@sveltejs/adapter-node@6.0.0`, `src/handler.js:152–154`, falls back to `https` when no protocol header is selected. No ORIGIN or origin configuration changes.

## Verification

Runtime: Node 24.19.0, npm 11.9.0. `npm ci --ignore-scripts --cache /tmp/langlo-npm-cache` completed. The initial ordinary cache location was inaccessible; using a writable temporary cache resolved installation without changing dependencies.

Observed red: targeted regression tests against unchanged main, 2 failing files, 7 failed / 23 passed. The failures prove blank name acceptance and the four signup session-boundary cases. Observed green after fixes: both files passed, 30/30 tests. Assertions cover statuses, handler/action nonexecution, missing replacement cookies, actual record absence, and public-page availability; no website copy assertions added. E2E additionally checks signed-in API denial, retained original identity, and absence of a second user row.

Full required results:

| Command                                                                  | Observed result                     |
| ------------------------------------------------------------------------ | ----------------------------------- |
| `npm run check`                                                          | Pass; 0 errors, 0 warnings          |
| `npm run lint`                                                           | Pass                                |
| `npm run format:check`                                                   | Pass, including final evidence      |
| `npm test`                                                               | 27 files; 308/308 tests passed      |
| `npm run test:property`                                                  | 2 files; 3/3 tests passed           |
| `npm run build`                                                          | Pass; adapter-node output generated |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e` | 62/62 desktop/mobile tests passed   |
| `git diff --check`                                                       | Pass                                |

The initial browser run used the absent bundled Chromium and failed browser-launch cases; auth/request cases passed. The rerun used installed system Chromium and passed the complete suite. Type, lint, and formatting checks were repeated after the final E2E assertions were added. All fixture databases and servers are disposable/local. Local checks do not prove live SMTP, production proxy topology, CI, deployment, or release acceptance. The validated signup fixes were published separately in PR23 with owner approval; further pushes and PR updates require approval.

## Read-only PR22 inspection

Owner reported PR22 while validation was running. Connected GitHub metadata and diff inspection show [PR22](https://github.com/Bonobo791/Langlo/pull/22) is open, non-draft, authored by `Bonobo791`, with base `main` at `40716f19cbba810957dc7b1af24def7d8eb5e1af` and head `revert-21-codex/config-error-safe-diagnostics` at `2dff47f4f6b69809848e292fa6956883bbd6eb04`. It changes 34 files (+231/-1332) in one commit. Its actual diff deletes the signup route, disables signup, restores blanket configuration 503s, removes trusted auth client-address handling and its tests, and removes the fixed Compose address policy. It does not implement the scoped public-signup fixes in this worktree. It conflicts with the currently delegated requirement for public signup and feature-specific failures.

The exact-head pull-request workflows reported Dependency review, ESLint, and OSSAR successful, and Quality failed. Quality's `foundation` job passed type/lint/format/unit/property/build/E2E steps but failed `Check test integrity with Overlock`; its `merge-evidence-gate` job also failed. The posted evidence-gate receipt identifies deletion of `tests/auth-request.test.ts`. These are PR22's remote results, not this branch's results. Active review comments exist on PR22; authorship does not establish permission to edit that branch.

PR22 remains with its owner. The owner subsequently chose to keep PR21 and publish these scoped public-signup fixes separately in PR23. The remote branch and draft PR were created at `958d99d4682e25c0692ddc4f9f65213e896002b8`; PR22 was neither changed nor closed. PR22 and PR23 are mutually exclusive implementation directions: PR22 reverts the PR21 behavior on which PR23 builds. PR23 preserves the proxy security protections. Do not merge the revert and expect this follow-up to remain applicable. No merge, deployment, production access, or readiness change was performed by this worker.

Local `gh pr view` and `gh api` metadata reads returned HTTP Forbidden; no mutation or escalation was attempted. The connected GitHub read-only tools successfully supplied metadata, diff, and workflow/job results, so PR inspection is not blocked.
