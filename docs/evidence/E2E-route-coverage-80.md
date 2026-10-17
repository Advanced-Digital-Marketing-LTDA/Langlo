# E2E and line coverage measurement

This branch tracks two separate coverage measures because Playwright and Vitest
run in separate CI jobs. Playwright does not contribute to `coverage/lcov.info`
or Codecov.

## Measures

- **Vitest source line coverage:** CI runs `npm test -- --coverage
--coverage.reporter=lcov --reporter=json --reporter=default
--outputFile.json=.ci-reports/vitest.json` and uploads `coverage/lcov.info`.
  On the clean `origin/main` baseline (`91a9e613c9919b6c09a4b96076683e85dfc25207`)
  and in the final branch run, 1,902 of 2,158 instrumented source lines were
  covered: **88.14%**. The requested 80% line threshold was already met.
- **E2E route-module coverage:** Count each `+server.ts` and `+page.server.ts`
  under `src/routes` once. A route is covered when a Playwright test sends an
  HTTP request to it. This measures route reach, not source statements or
  branches. There are 20 such modules. Before this change, E2E reached 17/20
  (**85%**); the three gaps were session next, pause, and resume. The new
  browser journey exercises those routes, bringing route reach to 20/20
  (**100%**).
- **E2E browser source coverage:** Monocart records Chromium V8 coverage from
  source-mapped browser assets. The 82-case baseline had 712/941 statements
  (**75.66%**) and 230/423 branches (**54.37%**) across original `src/` records.
  The final 90 desktop/mobile cases cover 756/953 statements (**79.32%**) and
  251/427 branches (**58.78%**) across 22 original `src/` records. These are
  observed source-map records, not
  whole-repository coverage: server-rendered code that Chromium does not execute
  remains uncovered. The 80% statement and branch targets are not met.

## Route inventory

| Route                                      | Playwright coverage                                         |
| ------------------------------------------ | ----------------------------------------------------------- |
| `GET /app`                                 | `auth.spec.ts`                                              |
| `GET /app/learn/[language]/lesson/[skill]` | `exercises.spec.ts`                                         |
| `POST /app/api/attempts`                   | `exercises.spec.ts`                                         |
| `GET /app/api/attempts/[id]`               | `owner-routes.spec.ts`                                      |
| `GET, POST /app/api/cards/[id]/reviews`    | `owner-routes.spec.ts`                                      |
| `GET /app/api/decks`                       | `owner-routes.spec.ts`                                      |
| `GET /app/api/notes/[id]`                  | `owner-routes.spec.ts`                                      |
| `POST /app/api/notes/[id]/approve`         | `owner-routes.spec.ts`                                      |
| `GET /app/api/study-sessions`              | `owner-routes.spec.ts`                                      |
| `GET /app/api/study-sessions/[id]`         | `owner-routes.spec.ts`                                      |
| `GET /app/api/study-sessions/[id]/next`    | `owner-routes.spec.ts` (added)                              |
| `POST /app/api/study-sessions/[id]/pause`  | `owner-routes.spec.ts` (added)                              |
| `POST /app/api/study-sessions/[id]/resume` | `owner-routes.spec.ts` (added)                              |
| `GET /build.json`                          | `foundation.spec.ts`                                        |
| `GET /health/live`                         | `foundation.spec.ts`, `runtime.spec.ts`                     |
| `GET /health/ready`                        | `foundation.spec.ts`, `runtime.spec.ts`                     |
| `GET /login`                               | `auth.spec.ts`, `exercises.spec.ts`, `owner-routes.spec.ts` |
| `GET /recover`                             | `auth.spec.ts`                                              |
| `GET /reset`                               | `auth.spec.ts`                                              |
| `GET /signup`                              | `auth.spec.ts`, `browser-form.spec.ts`                      |

## Validation

The added test signs in as a synthetic fixture learner and drives the real built
server. It verifies that the learner can fetch a question without its accepted
answer, pause their session, receives `409` when requesting another question
while paused, resume, and fetch a question again. It runs in desktop and mobile
Playwright projects. Application route behavior did not change. Monocart
coverage configuration now collects source-mapped Chromium JavaScript data and
filters the report to original `src/` sources where maps are available.

The route behavior already existed and had integration tests, so there was no
application-change red phase. Before adding the browser case, the full focused
owner-route suite had no HTTP journey through the three lifecycle endpoints;
the added journey passed against the built server.

## Observed local validation

- `npm run check` — passed; 0 errors and 0 warnings.
- `npm run lint` — passed.
- `npm test` — passed; 1,008 tests across 51 files.
- CI LCOV command — passed; 1,902/2,158 lines (**88.14%**), 1,425/1,686
  branches (**84.52%**), and 483/541 functions (**89.28%**).
- `npm run test:property` — passed; 5 tests across 4 files.
- `npm run build` — passed.
- `npm run test:e2e -- tests/e2e/owner-routes.spec.ts` — passed; 10 cases
  across desktop and mobile.
- `npm run test:e2e` — passed; 76 cases across desktop and mobile.
- `npm run test:e2e` after adding the prototype journeys — passed; 88 cases
  across desktop and mobile, including pointer review, selecting an enrolled
  track and explaining an unenrolled track, saving preferences, and clearing
  the pending-draft queue.
- `npm run test:e2e` after adding coverage harness regressions — passed; 90
  cases across desktop and mobile. The new coverage case confirms JavaScript
  and CSS collection from pages and contexts created during a test, plus
  coverage submission to Monocart.
- Monocart generated its configured HTML, V8, JSON summary, and LCOV reports.
  The final summary contains only original `src/` records (22 records), with
  756/953 statements (**79.32%**) and 251/427 branches (**58.78%**). Empty-map
  generated bundles and dependency sources are excluded. Both 80% targets
  remain open; the report only measures source-mapped browser code.
- Focused coverage harness tests — 6 passed across 3 files. They cover cache
  cleanup and teardown generation, source-map selection and symlink/traversal
  safety, unsupported maps, and the CI artifact paths. The CI upload now fails
  when expected Playwright reports are missing.
- `npm test` — passed; 1,014 tests across 54 files. `npm run test:property` —
  passed; 5 tests across 4 files. `npm run build` and
  `npm run build:e2e-coverage` — passed.
- `npm run format:check` — passed after formatting the new plan and evidence.
