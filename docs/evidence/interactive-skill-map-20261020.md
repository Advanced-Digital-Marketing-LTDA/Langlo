# Interactive skill map implementation evidence

Date: 2026-10-20

Scope: interactive grammar skill map, direct topic practice, return context, and
overall/per-language skill-state distributions.

## Behavior-first evidence

- The new skill-map utility test first failed because `src/lib/skill-map.ts`
  did not exist. Its initial implementation then passed layout/filtering and
  rounding cases but failed the zero-total distribution case. After handling
  the empty denominator, all seven unit tests passed. The separate property
  tests verify that rounded segments total 100% and acyclic graph placement
  follows its foundations.
- The progress-bar render test first failed because
  `SkillProgressBar.svelte` did not exist. It passed after the component exposed
  status counts and percentages through an accessible label and text legend.
- Route tests first failed because the map returned only a selected track and
  had no direct-practice action. After retaining all enrollments and adding the
  owner-checked, availability-checked action, all 11 progress route tests
  passed. The return-path route test also failed before `returnTo` was exposed;
  all 41 learner-route tests passed after the path was sanitized.
- Browser testing exposed that changing map state with `replaceState` did not
  refresh the selected-topic details. The component now updates its local
  selection state with the URL, and the interaction journey passed on desktop
  and mobile. A later browser assertion expected `120%` from an empty synthetic
  catalog; it was corrected to verify the actual contract: unavailable topics
  do not enter the denominator, so the overall bar reports that there are no
  available skills to measure.

## Final local validation

All checks ran after implementation with Node 24.19.0 and the repository's
required npm 11.9.0 runtime. Dependencies were installed using `npm ci
--ignore-scripts`; no package manifest or lockfile changes were made.

- `npm run check` — passed; 0 errors and 0 warnings.
- `npm run lint` — passed.
- `npm run format:check` — passed.
- `npm test` — passed; 91 files and 1,415 tests.
- `npm run test:property` — passed; 6 files and 9 property tests.
- `npm run build` — passed with the Node adapter.
- `npm run test:e2e` — after rebuilding the current worktree, all 110 desktop
  and mobile tests passed. The first run used stale generated build output and
  had eight version-refresh timeouts plus a mobile map pointer interception;
  the refresh test passed three consecutive isolated runs after rebuilding,
  and the map regression now uses keyboard interaction.
- Focused map E2E after that test correction — 4 passed across desktop and
  mobile using the built Node server and disposable synthetic fixture databases.
- [Synthetic desktop screenshot](interactive-skill-map.png) shows the segmented
  overall and language progress bars, map controls, topic states, and details.
- `git diff --check` — passed.

## PR review regression evidence

- Red: the lesson return-path test received `unavailable: true` and
  `lesson: null` without `returnTo`. Green: all 52 focused route, map and render
  tests passed after preserving the sanitized map URL for withdrawn lessons.
- Red: list-view matching rows had no `.matching` class, and a return from a
  lesson lost its `x` coordinate in the map URL. Green: the focused map E2E
  passed all 4 desktop/mobile tests after adding list match/context styling,
  tracking scroll coordinates reactively, and restoring them when each map
  viewport mounts.
- Closing details now returns focus to the selected list row when it remains
  visible, or to topic search when filters remove that row.

## Acceptance still pending

The implementation is locally validated. Product review of the resulting
interaction and any hosted CI, provider, release, or deployment acceptance are
still pending. No remote services, real learner data, or provider calls were
used. `npm ci` reported two moderate audit advisories; dependencies were not
changed because dependency maintenance is outside this feature's scope.
