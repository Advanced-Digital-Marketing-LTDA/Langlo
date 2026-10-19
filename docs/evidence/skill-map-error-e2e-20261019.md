# Skill map per-track error alerts in a browser (PR #124)

Observed locally on 2026-10-19 with Node 24.19.0 and npm 11.9.0.
`tests/e2e/map-errors.spec.ts` starts the built server (`node build`) against a
fixture database, signs in, and checks the `{:catch}` alerts on `/app/map`.
Those branches render only in a browser, so SSR render tests cannot reach them.

## Observed RED and GREEN

For RED, the progress alert text in `src/lib/components/GrammarProgress.svelte`
was temporarily reworded. No temporary mutation was committed.

Command, using npm 11.9.0:

```sh
npx playwright test tests/e2e/map-errors.spec.ts
```

Observed RED: exit 1; the test "a track whose progress cannot load shows a
progress alert" failed on desktop and mobile because the expected "FR progress
could not be loaded" alert was not found. The mutation was then reverted.

With the original text restored, the same command produced **4 passed**
(2 tests on desktop and mobile).

## Scope of local checks

Only the new spec was run locally, against a local `npm run build`. The full
unit, property, and e2e suites, `npm run check`, `npm run lint`, and
`npm run format:check` are left to CI because the full suite is too slow in the
cloud environment.

## Pending acceptance

CI on the PR head must be green, including the full e2e run on desktop and
mobile projects.
