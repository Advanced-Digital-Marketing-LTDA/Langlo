# LANGLO-247 implementation evidence

**Scope:** local grammar-retention pilot implementation using synthetic fixture data. No real learner data, production database, provider calls, paid calls, remote publication, CI secrets, or deployment were used.

## Mastery protection

Grammar FSRS is a separate recall schedule. It cannot mark a skill secure or change grammar-1 mastery status. The existing `scoreGrammar` rule still requires five distinct qualifying items across at least two sessions and at least 80% correct; the first response to a logical item/lineage is the only response that can add mastery evidence. Assisted and unsure responses do not qualify. An unrated correct answer under `grammar-fsrs-1` is treated as never given, so it contributes neither a durable answer/evaluation, mastery evidence, nor a retention event. The schedule only aggregates a completed session's lowest qualifying rating for each skill, at most once per skill/session.

The LANGLO-257 cross-boundary regression reviews the same question in two completed sessions. It observes two FSRS events while mastery remains Practising with only one distinct qualifying item from one evidence session. This demonstrates that retention reviews alone cannot satisfy the mastery floor.

The LANGLO-248 stability comparison was a granularity check, not a mastery safeguard or evidence of delayed grammar recall. It showed that one skill schedule accumulates stability differently from separate schedules for new prompts. The distinction and calibration limits are recorded in [LANGLO-248 evidence](LANGLO-248.md).

## Red/green record

- The focused scheduler behavior test first failed because the grammar-retention module did not exist; it passed after the module and one-event-per-skill/session aggregation were implemented.
- The legacy-session compatibility regression first failed at the new rating gate. The server and UI were then limited to requiring ratings only for sessions tagged `grammar-fsrs-1`; the regression passed and the existing session can continue without a retention rating.
- On the rebased current-main branch, the new regressions first exposed three compatibility failures: a nullable policy marker hid prior legacy answers from exposure checks, and no-verdict fallback markers were being written to practice/legacy attempts. A NULL-safe policy comparison and scoped marker writes fixed them; the focused regression set passed 73/73 and the full suite passed 1,416/1,416.
- After `main` added the five-confirmed-wrong assessment stop, the focused test first showed a retention assessment could keep offering questions after the stop threshold when an earlier correct answer still needed a rating. The assessment now opens its end-stage when the threshold is reached, keeps the session active until every correct answer is rated, and completes when the last rating is saved.
- The browser run exposed a lost `session` query on the rating form action. The action URL now preserves it, and the focused desktop exercise suite passed 4/4.
- Initial refresh checks timed out because the existing build artifact had SvelteKit's version checker compiled as a development no-op. An explicit production-mode build restored the configured checker; the focused desktop refresh checks passed, then the full desktop/mobile E2E suite passed 104/104.
- The rebased E2E run first found that its synthetic practice session was not tagged with the new retention policy, so the test saw legacy feedback with no rating controls. It now seeds the policy explicitly and targets the distinct status messages; the full desktop/mobile suite passed 104/104. The repository's default port 4173 was occupied, so a temporary config ran the built Node server on 4189 and was removed afterward.

## Local validation

- Runtime: Node `v24.19.0`, npm `11.9.0`; `npx --yes npm@11.9.0 ci --ignore-scripts` passed.
- `npx --yes npm@11.9.0 run check`: passed, 0 errors and 0 warnings.
- `npx --yes npm@11.9.0 run lint`: passed.
- `npx --yes npm@11.9.0 run format:check`: passed.
- `npx --yes npm@11.9.0 test`: passed, 91 files and 1,423 tests.
- `npx --yes npm@11.9.0 run test:property`: passed, 5 files and 7 tests.
- `NODE_ENV=production npx --yes npm@11.9.0 run build -- --mode production`: passed with the adapter-node production build.
- `npx --yes npm@11.9.0 run test:e2e -- --config=playwright.validation.config.ts`: passed, 104 tests across desktop and mobile against the built Node server with synthetic fixtures. The temporary config changed only the local server port and was removed after validation.
- `npx --yes npm@11.9.0 exec -- vitest run tests/attempt-fallback.test.ts tests/attempt-evaluation.test.ts tests/assessment-feedback.test.ts tests/assessment.test.ts tests/grammar-retention.integration.test.ts`: passed, 5 files and 73 tests.
- `git diff --check`: passed. Migration `0026` and `0027` are forward-only additions; existing migration SQL, snapshots, and journal entries were not modified.

## Browser evidence

The synthetic desktop screenshot captures the answer, feedback and selected rating before the session is finished:

![Grammar practice feedback after a Good rating](LANGLO-247-practice-rating.png)

## Pending acceptance and limits

The synthetic FSRS feasibility comparison does not establish that the schedule predicts delayed grammar recall. LANGLO-253 calibration still needs delayed recall on unseen equivalent questions across skills, tracks, and learner experience, with leakage controls and uncertainty. CI, live provider behavior, production state, learner exposure, and release readiness remain unverified and are not authorized by this local implementation.
