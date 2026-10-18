# Monocart reporting scope and validation

## Purpose

Use **two parallel browser E2E reporting views**. The original Monocart HTML, LCOV and JSON outputs are retained unchanged; the second generated product-only summary removes GlitchTip logging/telemetry sources from the *product E2E* denominator, while reporting their exclusion by exact path. Product source means every original-source file Monocart discovered under `src/` except `src/lib/glitchtip/`. The reporting filter affects no application runtime or test execution.

- Raw generated and unfiltered browser reports: `.ci-reports/playwright-coverage/` and original `coverage-summary.json`.
- Product-focused and unfiltered original-source comparison: `product-source-summary.json` and `product-source-summary.html`.
- Playwright results: `.ci-reports/playwright/playwright-test-report.html`.
- GlitchTip stays covered by its own unit/privacy tests and synthetic event delivery acceptance—not a browser 80% quota.

The pinned observed-source inventory in `scripts/monocart-observed-source-baseline.json` detects dropped previously mapped files. It does not establish that all browser-eligible files were ever mapped; newly mapped sources are reported separately. The reporter uses fixed input and output paths within the existing Monocart directory and rejects symlinked paths. CI retains its prior one-day artifact retention and missing-file policy until a separate privacy/retention change is reviewed.

**Measurement caveat:** product-only metrics use **only source-mapped files present in the Monocart report**. Files never loaded or mapped are absent, and bundled JavaScript entries are excluded from these source-only totals. This is not full product coverage and **must not enforce an 80% whole-product gate** until an independently validated, complete eligible-source inventory and mapping reconciliation are implemented. Missing expected mapped sources and malformed/empty metrics fail generation, never silently producing a successful empty report. The inventory is historical; it does not catch never-included eligible files.

## Historical report (2026-10-18)

Source: [CI run #39073448854, attempt 2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/actions/runs/39073448854) on `c0f93036`.
See `docs/evidence/langlo-e2e-qa-2026-10-18.md` for the original analysis and interpretation.

| Metric | Product source observed (excluding GlitchTip) | Unfiltered mapped original `src/` |
| --- | ---: | ---: |
| Lines | 614/792 (77.53%) | 624/949 (65.75%) |
| Statements | 796/1051 (75.74%) | 806/1226 (65.74%) |
| Functions | 330/443 (74.49%) | 330/460 (71.74%) |
| Branches | 271/482 (56.22%) | 271/695 (38.99%) |

These are **historical diagnostics**; regenerate for each new CI run. GlitchTip was low in E2E because its sanitization is mostly exercised in Vitest, not browser journeys. Its exclusion is a scope decision, *not* evidence that Langlo has reached 80%.

## Quality-test guidelines

1. Name a user behavior and a concrete expected outcome. Interacting with a UI element or receiving HTTP 200 is insufficient.
2. Assert persistent state, correctness, authorization and appropriate non-effects of invalid operations. Use independently specified expected values, not the same production helper as the oracle.
3. Include negative paths, boundaries, alternate states, accessibility and mobile interactions where material. Keep synthetic fixtures and deterministic isolation.
4. Confirm representative deliberate defects cause the correct tests to fail on **the intended assertion**. Preserve existing Stryker scopes and Overlock/TestTrust integrity gates.
5. Never weaken an assertion, increase retries to conceal failures, omit real product files, or count prototype tests as shipped-product behavior.
6. Keep GlitchTip privacy/redaction tests passing and independently verify safe browser/server synthetic event ingestion before claiming deployed monitoring works.

## Quality of the outputs

The report must distinguish: passed/failed/flaky/skipped tests; covered/total/percent for each metric and scope; any exclusions and missing/unmapped source files; actual functional journeys verified; mutations detected vs surviving; expected vs actual for failures, reproduction steps, sanitized traces/screenshots, and source/commit/run IDs. Present deficits and measurement uncertainties before declaring success. A green E2E suite is **not** evidence that all functionality was validated.

## Next work

1. Fix generated bundle/port deduplication and map the three exercise components currently reported 0% despite passing real-browser exercise tests.
2. Build a versioned full browser-eligible inventory including *unexecuted* product sources; reconcile source maps and code coverage before enforcing 80%.
3. Add meaningful learner journey and alternative-path assertions, particularly real lesson feedback, answer handling, failed saves, retry, persistence and permissions.
4. Run separate product Vitest/mutation coverage and GlitchTip integration verification, and improve actionable Playwright failure evidence.
