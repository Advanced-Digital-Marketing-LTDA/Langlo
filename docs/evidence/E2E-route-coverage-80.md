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
Playwright projects. No application route behavior or coverage configuration
changed.

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
- `npm run format:check` — passed after formatting the new plan and evidence.
