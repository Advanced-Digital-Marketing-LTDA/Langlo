# Langlo — 80% coverage and test-evidence quality plan

**Status:** PR implementation scope and follow-up plan (GlitchTip scope correction, 2026-10-18). This PR implements dual-scope reporting and adds baseline evidence; it does NOT implement the full 80% roadmap.
**Baseline date:** 2026-10-18 UTC. **Reference commit:** `c0f93036ace5279a5b843a292653e8e7f3209c06` (`main`).
**Evidence:** [GitHub Actions run (rerun attempt 2)](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/actions/runs/39073448854), accompanying Monocart report artifact, [Playwright configuration](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/blob/main/playwright.config.ts), [Monocart configuration](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/blob/main/scripts/monocart-coverage.config.mjs), [CI workflow](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/blob/main/.github/workflows/ci.yml), [Stryker configuration](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/blob/main/stryker.config.mjs).

## 1. Goals and definitions (avoid a false 80%)

**Scope correction — important:** GlitchTip is Langlo’s error-monitoring service. Its `src/lib/glitchtip/` integration and telemetry scrubbing are **not user-facing product functionality and are not part of the 80% Playwright/browser E2E coverage gate**. Verify these separately with focused Vitest tests, privacy checks, and a synthetic end-to-end error-delivery acceptance test. Keep their measurement visible in the complete unfiltered report; excluding them from the *functional browser coverage* metric is a predeclared difference in purpose, not permission to hide missing product coverage.


**A. Product browser E2E code coverage — target ≥80% in EACH of lines, statements, functions and branches where meaningful and reliably mapped.** Measure delivered user-facing browser code (real Svelte components, forms, navigation, browser-side product logic). Do **not** include `src/lib/glitchtip/` or other explicitly documented monitoring-only instrumentation in this *product E2E* denominator. Include every eligible product file, **including eligible unexecuted files**. Version the scope and list precise inclusions/exclusions with their rationale. Publish the **unfiltered original-source Monocart score** separately as a diagnostic, without labeling it a failed product browser target. Never double-count compiled bundles, or claim browser code coverage measures the entire application.

**B. Product source coverage — target ≥80% in EACH of lines, statements, functions and branches** using Vitest unit/integration tests for product and server logic; verify current figures independently. Publish a separate complete repository-wide Vitest measurement, including any instrumented GlitchTip integration, but **do not treat the coverage of logging infrastructure as missing user-functional E2E coverage**. Keep product-code and monitoring-code denominators distinct. Do not average unit and browser percentages or merge them without compatible instrumentation and a reconciled file inventory.

**C. Actual functionality — map 100% of business-critical shipped behaviors to assertion-backed tests and ≥80% of all cataloged shipped behavior scenarios.** A feature/route counts only if its expected outcome is asserted. Route reached, DOM displayed, and code executed alone do not count as verified behavior. Track prototype behavior separately from active production functionality.

**D. Test power — existing Stryker product scopes retain ≥80% mutation score (configured today); extend mutation checks to critical learner behavior.** Distinguish assertion-based mutant kills from timeouts/errors. Require representative intentional defects in persistence, grading and owner isolation to fail the relevant assertions. GlitchTip privacy regressions must still fail focused tests, but are **not required** to raise the product browser mutation/coverage score.

**E. Logging integration reliability — separate pass/fail track, not an 80% E2E KPI.** Keep focused unit tests for redaction and safe metadata; test synthetic browser **and** backend error delivery to a test GlitchTip instance or safe local capture transport, including the alert path where deployed. If hosted verification is unavailable, mark `not-verified` explicitly, never `passed`.

### Baseline, from fresh October 18 Monocart and Playwright reports

| Unfiltered original `src/` entries in Monocart (25 mapped files only) | Covered | Total | Percentage |
|---|---:|---:|---:|
| Lines | 624 | 949 | 65.75% |
| Statements | 806 | 1,226 | 65.74% |
| Functions | 330 | 460 | 71.74% |
| Branches | 271 | 695 | 38.99% |

**These are historical diagnostic numbers, not the corrected product-only E2E baseline.** The product-only baseline and exact number of additional executed outcomes needed for 80% **must be recalculated** after source-mapping and scope validation. Do not carry over an 80% deficit calculated using monitoring-only code.

Tests: **88/88 passed** (44 distinct scenarios on desktop Chromium and 44 on mobile Chromium), 0 failed, 0 skipped; 4,475 recorded steps. Monocart displayed 0 flaky tests, but Playwright is configured with `retries: 0`, so this does **not** establish that the suite has no intermittent failures. Previous route-reach matrix recorded **20/20 server route modules reached**; route reach is *not* semantic behavior coverage.

**Important measurement risks:** Monocart's raw report includes generated JavaScript under multiple loopback origins: the raw `total` percentages are not a reliable source-coverage KPI. Only 25 original-source files appear in the mapped report; unseen source files may be missing from the denominator. Three exercise components show 0% while a genuine exercise E2E journey passes. This must be understood before changing tests.

**Why the correction matters:** `src/lib/glitchtip/scrub-event.ts` accounts for **213 browser-uncovered branch outcomes** in the 25-file unfiltered sample. These are telemetry/privacy logic, not learner journeys. **No GlitchTip browser branch quota is required.** Moving the monitoring module out of the *product* browser denominator is legitimate only when the full raw report, explicit scoped inventory, and separately passing telemetry tests remain visible. An 80% product E2E score must be calculated from real, fully inventoried product source—not obtained by omitting difficult learner-facing paths.

## 2. Implementation sequence and acceptance criteria

### PR 1 — Measurement validity and reproducibility (BLOCKER; first)

- [ ] Canonicalize Monocart paths and origin-specific bundle entries. Compare V8, source-map, LCOV and summary data: count each original source location once, never also count its generated bundles. Keep an explicit *unmapped first-party JS* diagnostics list; fail if attribution silently disappears.
- [ ] Investigate 0% for `Exercise.svelte`, `TextAnswer.svelte`, `MultipleChoice.svelte` while `tests/e2e/exercises.spec.ts` actually renders/interacts with the components. Validate that JS coverage starts before hydration, survives navigation, and is collected for the dynamically started fixture servers. Inspect generated sourcemaps and loaded scripts. Do not presume 0% means functionality is untested.
- [ ] Establish **two separate versioned inventories**: (1) all original browser-source files for the diagnostic report, and (2) the user-facing product browser files that define the 80% target. Explicitly classify `src/lib/glitchtip/**` as monitoring/instrumentation; also distinguish server-only, CSS and build-only files. Include uncovered-but-loadable product files even if not executed. Recalculate product-only 80% thresholds after mapping; retain the 25-file historical unfiltered baseline for comparability. Code must not be moved or reclassified solely to improve coverage.
- [ ] Add a validator that reconciles Monocart summary counts with LCOV, catches duplicate source/port entries, rejects empty/bogus reports, checks source-map attribution, and fails if an eligible product file is quietly dropped. Emit a reviewable report of all product/monitoring exclusions and coverage changes.
- [ ] Keep standalone reports for Playwright E2E tests, Monocart test details and Monocart V8 source coverage. Optionally add native Playwright HTML/JSON reporters: `playwright.config.ts` currently has `list` + `monocart-reporter`, not Playwright's separate built-in HTML reporter.

**Accept when:** Two comparable reruns on the same SHA yield consistent results; origins/ports cannot alter coverage or scope; missing reports and attribution errors fail explicitly. Publish `coverage-baseline.json` with independent **product browser**, **unfiltered browser diagnostics**, **product Vitest**, and **monitoring integration** sections, original source inventories, all exclusions and mapping warnings.

### PR 2 — Highest-value live learner journeys (primary increase in line/statement/function coverage)

Prioritize **real app screens, not prototype-only screens**. The following figures are per-file *observed mapped E2E coverage*, not proof that untested behavior is defective:

| Source | Lines now | Branches now | Test cases to strengthen or add |
|---|---:|---:|---|
| `src/routes/app/learn/[language]/lesson/[skill]/+page.svelte` | 27/76 | 18/64 | Exercise available/unavailable, correct/incorrect/uncertain feedback, assisted retry, report submission errors/success, no-question state, fallback language |
| `src/lib/components/exercises/Exercise.svelte` | 0/46 | 0/31 | All 4 formats, valid/invalid input, Not sure, pending/duplicate submits, server failure, assisted retry |
| `src/lib/components/exercises/answer.ts` | 2/27 | 0/24 | Trim/NFC, malformed input, blank, over-limit, invalid characters, choices not in options, multilingual accents |
| `src/lib/components/exercises/TextAnswer.svelte` | 0/23 | 0/10 | Textarea/input, accent insertion at cursor and selection, keyboard focus, validation messaging |
| `src/lib/components/exercises/MultipleChoice.svelte` | 0/6 | 0/4 | Keyboard and pointer selection, rejected options, no selection |

**Each new behavior test must verify postconditions**, e.g., after submitting a valid exercise answer the correct row exists for the right learner, survives reload, and reports the intended feedback; an invalid answer must neither record an attempt nor alter score; an assisted retry cannot improperly earn independent credit. Use controlled test databases, no external real accounts.

- [ ] Add 4-format actual lesson E2E with explicit success/failure and persisted data assertions; reuse fixtures without depending on test order.
- [ ] Add error/alternate-state journeys that the source actually supports; don't manufacture scenarios with mocks that bypass the logic being assessed.
- [ ] Add tests for repeat submissions, refused/failed server writes and recovery, account separation, and validation boundaries where they are missing. Reuse existing high-quality tests when present instead of duplicating them.
- [ ] Keep mobile and desktop test execution. Verify the application really hydrated and that browser events executed; use accessibility locators and auto-retrying assertions.

**Accept when:** The validated source-coverage measurement shows real progress toward ≥80% lines/statements/functions, with changed behavior IDs linked to test names and at least one verified persisted/negative postcondition for each critical new test. All existing 88 cases continue to pass.

### PR 3 — Product behavior branches and independent logging verification

- [ ] Close **meaningful product UI branches first**: correct/incorrect/uncertain lesson feedback, invalid submissions, retry behavior, expired sessions, card/review/deck states, duplicated requests and error recovery. Do not prioritize GlitchTip scrubber branches to raise the product E2E percentage.
- [ ] Maintain GlitchTip `scrub-event.ts` **unit/privacy tests** separately; verify secret removal, route sanitization, malformed events, safe metadata, and browser/server initialization. These tests are blocking when a privacy or logging change breaks them, but are **not counted as coverage of learner journeys**.
- [ ] Run a **separate synthetic delivery acceptance test** when a local/test GlitchTip project is available: deliberately emit one safe browser exception and one safe server exception; confirm they are ingested, attributable to the correct environment and release, redacted, and capable of alerting when notifications are configured. Do not send learner data or exercise payloads. If unavailable, report `monitoring-integration: not-verified` with the exact blocker.
- [ ] Report product-browser source branches, product/server Vitest branches, and unfiltered original-source browser branches in **separate lanes**. No GlitchTip browser branch minimum, no forced Playwright tests against internal log-processing helpers.

**Accept when:** ≥80% of the **validated product browser** line/statement/function/branch measurements and the separate product Vitest targets pass; the unfiltered original-source diagnostic remains visible and does **not** need to hit 80%. GlitchTip unit/privacy checks pass, and synthetic delivery is either verified or truthfully marked unverified. Do not claim production error capture is working without a real acceptance test.

### PR 4 — Mutation, test-review, and quality gates

- [ ] Preserve existing CI checks (Overlock and TestTrust for changed Vitest tests, and merge-evidence gate) rather than introducing redundant paid platforms. Extend review to changed Playwright tests with checks appropriate to E2E, because existing TestTrust selection is based on Vitest-style files.
- [ ] Existing `stryker.config.mjs` sets `thresholds.break=80` across six explicit modules. Extend mutation checks for selected **critical product modules** (`answer.ts`, cards/reviews/assessment logic) with scoped validation and named tests. Run targeted mutation on relevant PRs; full existing scopes nightly/on demand to limit CI cost. Telemetry scrubber mutation tests are optional, risk-driven hardening, **not an E2E coverage dependency**.
- [ ] Perform verified product fault-injection probes: drop an answer insert, invert correct/incorrect grading, allow cross-owner reads. Confirm each relevant test fails on the **intended assertion**, not a generic build failure/timeout; restore changes. Independently test that a known synthetic secret cannot pass telemetry scrubbing.
- [ ] Audit all added tests with the criteria below. Reject tests that increase coverage but leave incorrect application behavior undetected.

**Accept when:** All six existing Stryker scopes are freshly verified at ≥80% and every newly claimed critical scenario is supported by a meaningful assertion; sampled intentional defects are caught. No weakened existing assertions or silently skipped tests.

### PR 5 — Actionable evidence and CI publication

- [ ] Generate stable machine-readable `.ci-reports/qa-summary.json` and human-readable `.ci-reports/qa-summary.html` on every PR and main run, with schema validation, clear failure codes and comparative baselines.
- [ ] Publish **three distinguishable artifacts:** (1) Playwright/Monocart test outcomes with individual steps; (2) Monocart HTML/LCOV/JSON coverage split into **product-only E2E** and **unfiltered original-source diagnostics**; (3) a consolidated QA scorecard with a **separate GlitchTip logging-integration status**. Do not label the Monocart test reporter as the native Playwright HTML reporter.
- [ ] Capture screenshots and failure traces (`trace: retain-on-failure` already configured), page errors, relevant console errors, network request failures, unexpected 5xx, and sanitized server-side correlation IDs. Only flag *unexpected* errors; deliberate negative-path 4xx are expected results, not automatic failures.
- [ ] Associate errors with an exact test ID, feature ID, source file/line (when mapped), project, commit SHA, assertion, expected vs actual, and clickable trace/artifact link. GlitchTip issue URL may be added only when its deployed ingestion is confirmed; do not claim production telemetry works based solely on SDK unit tests.
- [ ] Change `upload-artifact` `retention-days: 1` to **14 days for synthetic-only CI artifacts**, with access restrictions and redaction; current Playwright artifact step uses `if-no-files-found: ignore`. Make reports required when the tests ran, otherwise record a distinct infrastructure/blocker status. Upload `test-results/` on failures.
- [ ] Add regression detection: absolute coverage and deltas from base SHA **for each scope** (product browser, unfiltered browser, product Vitest, monitoring), with denominator changes separately. Lock the product browser inventory; require explicit review for any inclusion/exclusion changes. Reject omissions of learner-facing source code or weakened assertions.

**Accept when:** A developer can locate an exact failed expectation, inspect a reproducible trace and sanitized logs, see whether the change reduced source/feature/mutation coverage, and know the next corrective action *without manually parsing CI logs*.

## 3. Required test-quality guidelines (apply to every added or changed test)

1. **Behavior first.** Name the user requirement and failure mode. Assert at least one business-level output, data mutation, side effect, or explicit no-change guarantee. A click, HTTP 200, mounted component, or executed line alone is insufficient.
2. **Independent oracle.** Expected value comes from an independent contract/fixture, not the same production helper that computes the observed result. A test that calls the production grading function for its expected grade can pass when the grading function is wrong.
3. **Negative and boundary cases.** Cover success, invalid inputs, empty/limit/Unicode, missing data, permissions, duplicate/replayed actions, 4xx/5xx, and recovery where relevant. Check persisted state is unchanged after rejected operations.
4. **Real boundary, narrow mocking.** E2E uses the actual built SvelteKit server and controlled database. Mock only outside services; never mock out the feature under test. State external dependencies and fixture versions explicitly.
5. **Independent and deterministic.** Isolate users/databases/ports, reset state, use fixed seeds and fake clocks as needed, and never rely on test execution order. No sleep-based waits. Retries, timeouts or test skips may not conceal defects.
6. **User-visible interaction.** Use accessible locators (`getByRole`, `getByLabel`) and Playwright's awaited retrying assertions. Verify keyboard and mobile usability when relevant; avoid private DOM classes as functional oracles.
7. **Test integrity.** No `expect(true)`, assertions that merely restate mocks, swallowing errors, assertion removal, increased timeouts solely to green CI, duplicate tests without new behavior, or `only`/`skip`/unjustified `.fixme` in committed suites.
8. **Failure sensitivity.** For each P0/P1 behavior, maintain an example regression that fails if functionality is broken; use mutation/fault injection periodically to validate sensitivity. Assert the specific failure rather than any generic exception.
9. **Privacy and monitoring responsibility.** Use synthetic data, redact logs/URLs/tokens, and prevent secrets in screenshots/traces. GlitchTip integration must pass focused sanitization tests and a synthetic delivery check when deployed; these are **separate from product E2E coverage**, not an exception to correctness.
10. **Do not game coverage.** Never exclude learner-facing product paths to increase a percentage, invoke helpers without meaningful assertions, delete difficult tests, remove branches, or count prototype-only cases as active app functionality. Every legitimate infrastructure exclusion must be named, rationalized and shown beside unfiltered results.

### Test-spec template for a required behavior

```text
Feature ID: LANGLO-LESSON-ANSWER-VALID
Criticality: P0
Given: seeded learner and uncompleted real lesson
When: learner submits a valid answer via rendered browser form
Then: UI displays the exact expected feedback
And: real database contains exactly one owned attempt with the normalized answer
And: result survives navigation/reload
And: other user cannot read that attempt
Negative control: change persistence to drop the insert -> test must fail on persisted state
Evidence: desktop/mobile Playwright test ID, GitHub run, trace on failure, source coverage delta
```

## 4. Required report output contract

**Minimum summary fields** (JSON plus visually readable HTML):

```json
{
  "run": {"utc": "2026-10-18T00:00:00Z", "commit": "<sha>", "ci_url": "<url>", "environment": "ci-synthetic"},
  "tests": {"desktop": {"passed": 0, "failed": 0, "flaky": 0, "skipped": 0}, "mobile": {"passed": 0, "failed": 0, "flaky": 0, "skipped": 0}},
  "coverage": {
    "browser_product_e2e": {"lines": {"covered": 0, "total": 0}, "statements": {"covered": 0, "total": 0}, "functions": {"covered": 0, "total": 0}, "branches": {"covered": 0, "total": 0}, "included_files": [], "excluded_infrastructure": ["src/lib/glitchtip/**"], "unmapped_product_files": [], "target_percent": 80},
    "browser_original_source_diagnostic": {"lines": {"covered": 0, "total": 0}, "statements": {"covered": 0, "total": 0}, "functions": {"covered": 0, "total": 0}, "branches": {"covered": 0, "total": 0}},
    "product_vitest": {"lines": {"covered": 0, "total": 0}, "statements": {"covered": 0, "total": 0}, "functions": {"covered": 0, "total": 0}, "branches": {"covered": 0, "total": 0}},
    "telemetry_integration": {"unit_privacy_tests": "pass | fail", "browser_event_ingestion": "pass | fail | not-verified", "server_event_ingestion": "pass | fail | not-verified", "alert_delivery": "pass | fail | not-verified", "production_verified": false},
    "features": {"critical_verified": 0, "critical_total": 0, "verified": 0, "total": 0},
    "mutation_scopes": []
  },
  "failures": [
    {"feature_id": "<id>", "test_id": "<id>", "project": "<device>", "error_type": "<kind>", "expected": "<safe summary>", "actual": "<safe summary>", "source_location": "<path:line>", "request_id": "<safe id>", "trace_artifact": "<url>", "glitchtip_issue": null, "reproduction": "<safe steps>", "suspected_root_cause": null}
  ],
  "warnings": ["Source-map mapping incomplete"],
  "artifacts": {"playwright_html": "<url>", "monocart_test_html": "<url>", "monocart_source_html": "<url>"},
  "status": "pass | fail | measurement-invalid | infrastructure-blocked"
}
```

The numeric zeros in this example indicate **schema placeholders**, not actual Langlo measurements.

**Human summary order:** product failures and blockers first; learner behaviors verified; four metrics with numerators/denominators for the **product E2E target**; side-by-side *unfiltered browser coverage* (diagnostic, no 80% gate); product unit/integration metrics; feature and mutation gaps; **GlitchTip unit/redaction/ingestion/alert status separately**; missing source mapping; replay steps and safe trace links; proposed fixes. A green run with uncovered critical behavior is **coverage incomplete**; passing GlitchTip unit tests cannot be described as verified live monitoring.

**Fail CI** when: unexpected failed product or GlitchTip/privacy unit tests, missing/invalid report, dropped eligible product files, missing critical assertions, under-threshold **product** metrics after validation, skipped critical tests, high-severity weakened-test findings, or leaked private data in evidence. Missing hosted GlitchTip acceptance should show `not-verified` and block any **production-monitoring verified** claim, without fabricating failures of the product E2E coverage threshold. If coverage data become invalid, report `measurement-invalid`, never an improved percentage.

## 5. Completion checklist

- [ ] Raw and source-only coverage reconcile; mapping trustworthy, original-source inventory explicit and stable.
- [ ] **Product E2E browser scope** (all eligible learner-facing files, excluding documented monitoring-only code) reaches ≥80% of all four reliably mapped metrics; any unmet target is labeled **not met**. Every exclusion is named and reviewable; the unfiltered browser report remains alongside it.
- [ ] Product Vitest lines/statements/functions/branches each ≥80% with newly verified numbers; full source-wide Vitest diagnostics remain available, including monitoring code.
- [ ] All critical shipped behaviors have assertion-backed tests; ≥80% of complete shipped scenario catalog verified.
- [ ] Core mutations/fault-injections detected by intended assertions (not generic timeouts); scoped Stryker scores verified at ≥80%.
- [ ] Both desktop and mobile E2E suites pass without skipped/flaky tests and all existing behavior remains tested.
- [ ] **GlitchTip is verified separately:** redaction/unit tests pass; synthetic browser and server error ingestion/alerts are tested against a test endpoint when available. Missing hosted checks are visibly **not verified**, not buried in product coverage.
- [ ] Every failure produces safe, actionable expected/actual, trace/logs, reproduction, ID, source mapping and CI link.
- [ ] PR gate automatically rejects inaccurate reports and weakened quality claims. No application behavior changes except separately justified bug fixes.

**Implementation ordering:** measurement/scope PR → real lesson/exercise PRs → meaningful **product** branch PR → mutation/quality validation → CI artifact publication and gates. Validate GlitchTip separately through focused privacy tests and synthetic delivery acceptance, **not as work needed to satisfy Playwright's 80% target**. Recalculate the product-only baseline and completion results on the final SHA; the unfiltered October 18 figures cannot certify product-only 80%.