# Dashboard UI evidence

Date: 2026-10-18. Branch: `claude/project-thread-f64j9e`, baseline `e464879`.
Scope: `/app` dashboard, shared `/app/*` navigation, `TrackCard` and the shared
mastery labels in `src/lib/dashboard.ts`. No server code, schema, auth,
prototype screens, flashcards or CI policy changed.

## Tests

- `tests/dashboard.test.ts`: status counts, recommendation resolution
  (absent and missing-skill cases) and distinct label/symbol per status.
- `tests/dashboard-render.test.ts`: server-renders the real `.svelte` files
  (helpers in `tests/helpers/`) for the Continue card and lesson link, the empty
  state, the busy loading state, active-tab matching (exact `/app`, nested
  routes, sibling-prefix path, trailing slash) and `GrammarProgress` using the
  shared labels and symbols.

## Observed results (local, synthetic data only)

Runtime: Node `v22.22.0`, npm `10.9.4` (the pinned Node 24.19.0 / npm 11.9.0
were not available; install used `--legacy-peer-deps --no-package-lock`).

| Check                                             | Observed                                              |
| ------------------------------------------------- | ----------------------------------------------------- |
| First render run, components compiled in dev mode | Red: 9/9 failed (`push_element`); fixed in the helper |
| Render tests after the helper fix                 | Green: 9 passed                                       |
| Mutation: nav match without the exact `/app` rule | Red: nested-route test failed                         |
| Mutation: loading branch disabled                 | Red: loading-state test failed                        |
| Both mutations reverted                           | Green                                                 |
| `npx vitest run tests/dashboard*.test.ts`         | Passed, 15 tests                                      |
| `npm run check`                                   | Passed, 0 errors/0 warnings                           |
| ESLint and Prettier on changed files              | Passed                                                |

Svelte files cannot be measured by the v8 provider here (parse error), so their
branches were checked by hand: every `{#if}` arm in `+page.svelte`,
`TrackCard.svelte` and `+layout.svelte` has a rendering test.

## Pending, not proven here

Full `npm test`, `npm run test:property`, `npm run build`, `npm run test:e2e`
(desktop and mobile), hosted CI and a visual check on a phone width were not
run locally; the full suite is left to CI. Local checks do not prove release
success.
