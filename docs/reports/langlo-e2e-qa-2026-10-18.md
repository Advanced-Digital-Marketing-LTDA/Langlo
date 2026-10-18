# Langlo E2E QA analysis — October 18, 2026

Source: [GitHub Actions run #39073448854, attempt 2](https://github.com/Advanced-Digital-Marketing-LTDA/Langlo/actions/runs/39073448854), commit \`c0f93036\`.

**Playwright:** 88/88 passing (44 desktop and 44 mobile), 0 failed, 0 flaky reported, 0 skipped, 4,475 steps. Retries were disabled, so zero flaky reported is not evidence that all tests are reliably non-flaky.

**Original mapped source (25 observed src/ files):** 624/949 lines (65.75%), 806/1226 statements (65.74%), 330/460 functions (71.74%), 271/695 branches (38.99%). Raw totals (14.54% lines, 13.39% statements, 15.03% functions, 5.11% branches) include generated assets and duplicated port-origin entries and must not be treated as product-wide coverage.

**Product-focused observed source (24 mapped src/ files, excluding GlitchTip):** 614/792 lines (77.53%), 796/1051 statements (75.74%), 330/443 functions (74.49%), 271/482 branches (56.22%). These are the **observed** original-source subset, not the inventory of all shippable browser code.

**Observed coverage gaps:** \`Exercise.svelte\`, \`TextAnswer.svelte\`, \`MultipleChoice.svelte\` each showed 0% while browser journeys completed, suggesting mapping or collection should be checked before concluding the functions are not tested. \`answer.ts\` had 7.40% of lines; the real lesson \`+page.svelte\` had 35.52%; both merit meaningful behavioral tests after attribution verification. The 20 prototype scenarios should not substitute for shipped learner journeys.

**Logging:** \`src/lib/glitchtip/scrub-event.ts\` recorded only 6.36% E2E lines, but it is a telemetry helper covered by Vitest privacy tests. Do **not** require 80% Playwright coverage of GlitchTip; verify synthetic error ingest and alert delivery independently. No live GlitchTip deployment is evidenced by these browser reports.

**Interpretation:** All reported Playwright assertions passed in this CI run. This does not establish complete feature testing, reliable coverage attribution, or live monitoring. Next steps: validate mapping; inventory all eligible product source, add tests for real user journeys and alternate outcomes, mutation-test high-risk paths, and produce actionable safe failure artifacts.
