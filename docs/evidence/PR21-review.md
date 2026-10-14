# PR 21 publication and review

Published draft: https://github.com/Bonobo791/Langlo/pull/21

Published head: `4d5d33b71b0e920c1a5e41b836f6c37e2128db79`, based on main
`6b71dcee9c597ac4f1e1a065b98de9a4f0a27707`. The owner authorized the initial
push and draft PR only. Follow-up fixes below are local and unpublished.

## Published-head checks

Quality (including unit/property/build/E2E/TestTrust/Overlock), Dependency
review, ESLint, OSSAR, CodeQL, Semgrep and the merge-evidence gate passed.
SonarCloud and CodeAnt quality gates passed. CodeRabbit skipped review because
the PR is draft; its green status does not establish a review. CodeAnt's review
completed on the published head. Codacy requires action and
reports 14 annotations plus duplication metrics.

## Findings and local fixes

- Amazon Q's recovery logging finding is addressed by using `safeDiagnostic`
  for the final failure log. The request hook already generates the UUID, so
  the original value was not user supplied; shared validation is still the
  appropriate consistency fix.
- Gitar's SMTP timing finding is valid: installed Better Auth 1.7.7 awaits the
  callback through `runInBackgroundOrAwait`. Delivery is now detached from the
  response, and the correlation ID is captured before detachment. A controlled
  pending-delivery test failed against the published code and passes locally.
- Gitar's signup redirect finding is valid. The hook now resolves signup
  sessions; both GET and stale form POST redirect signed-in users to `/app`.
  HTTP coverage verifies that a stale POST keeps the existing identity.
- Sonar's unavailable-mailer `async` warning is addressed by returning a
  rejected promise explicitly, preserving the asynchronous Mailer contract.
- Codacy's seven high-severity annotations request Unicode regex flags; all
  seven flagged expressions now use `u`. Other annotations are function-size
  and complexity thresholds, with duplication metrics. These are retained as
  maintainability observations; no functional defect was demonstrated by the
  numerical thresholds alone.
- Amazon Q's reset-cookie format suggestion concerns unchanged code and is
  recorded for a separate hardening follow-up.
- Self-review removed unreachable auth-failure alternatives after the private
  route guard has already established a non-null auth instance.
- CodeAnt's capture-transport finding is valid: unused SMTP host/port settings
  no longer disable capture recovery. The regression test was observed failing
  on the published parser and passing after the fix.
- CodeAnt's signup-test findings are addressed with explicit synthetic client
  addresses, exact five-success/two-rejection assertions, and a successful
  independent client. API request contexts are disposed in `finally`, and
  asynchronous log assertions poll until the expected correlation ID arrives.

The raw GitHub check-annotation API was outside the connector's permitted
endpoint set. Annotation details were read from the public GitHub check pages
instead. No provider credentials or production resources were accessed.

## Remaining publication gate

The local follow-up requires approval for another push and fresh hosted checks.
The draft is not ready for merge while its published timing/redirect/logging
findings remain open. SMTP request confirmation still does not prove delivery;
the documented durable delivery/status design remains a separate decision.

## Local follow-up validation

After the review fixes: `npm test` passed 288 tests in 25 files;
`npm run test:property` passed 3 tests; Svelte check reported zero errors and
warnings; ESLint and Prettier passed; build passed; all 60 desktop/mobile E2E
tests passed with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`.
`git diff --check` passed. Hosted results above apply only to the published
head, not to these unpublished fixes.
