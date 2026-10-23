# Fewer database calls on the home and analytics pages

**Scope:** how many database calls `GET /app` and `GET /app/analytics` make, and which of them wait for each other. What the pages show is unchanged. This records local validation, not a latency result: the effect is checked in GlitchTip after deploy (`GET /app`, `GET /app/analytics`).

## Why

Each call costs about 138 ms from the Coolify host to Turso (GlitchTip, 2026-10-23), and the queries themselves take a few milliseconds. Counted with a wrapper around the client, one enrolled language, sign-in lookup not counted: `/app` made 12 calls, 10 of them one after another; `/app/analytics` made 17, 14 in a row. The progress read transaction sent its five reads per language one by one, the three retention reads waited for it, the analytics page read the timezone twice, and its review counts waited for the progress reads.

## Changes

1. Progress reads (`mastery.ts`, `progress.ts`, `grammar-retention.ts`, `flashcards.ts`): after the enrollments, every track's catalog, prerequisites, answer history and current content go in one `tx.batch` inside the same read transaction (`loadEnrolledMasteryWith`). `loadProgress` adds each track's three retention reads to that batch. Progress is now begin, enrollments, one batch, commit, whatever the number of tracks. `loadEnrolledMastery` (map, practice) uses the same batch without the retention reads. The four spans `mastery.catalog`, `mastery.prerequisites`, `mastery.load-evidence` and `mastery.current-content` are replaced by one `mastery.reads` span (attributes: `statements`, `rows` = answer history rows).
2. Home (`routes/app/+page.server.ts`): the unfinished-practice checks for all tracks are sent together instead of one after another.
3. Analytics (`routes/app/analytics/+page.server.ts`, `review-analytics.ts`, `study-time.ts`): the timezone is read once; the review counts and the study-time segments are read beside the progress reads instead of after them. `loadReviewAnalytics` and `loadStudyTime` keep their behavior and are built from the new pieces.

## Red and green

`tests/home-analytics-round-trips.test.ts` (two enrolled tracks, an answer, a study schedule and a study-time segment). Red on main:

```
× loads the home page in few round trips       expected 21 to be less than or equal to 6
× loads the analytics page in few round trips  expected 25 to be less than or equal to 9
```

Green after: both pass. With one track the counts are 5 (home) and 9 (analytics), at most about 5 in a row each.

Tests changed:

- `tracing-spans.test.ts`: expects the one `mastery.reads` span instead of the four per-read spans; it still checks that the answer history rows are the learner's own.
- `lesson-load-round-trips.test.ts`: the counting wrapper moved to `tests/fixtures/counting-client.ts` so both round-trip tests use it; no assertion changed.

## Checks

`npm run check` 0 errors, 0 warnings; eslint and `prettier --check` on changed files; `npm run build` clean. Related tests only, not the full suite: `home-analytics-round-trips`, `lesson-load-round-trips`, `tracing-spans`, `study-time`, `learner-journeys`, `review-analytics`, `mastery-updates`, `grammar-retention.integration`, `mastery`, `review-analytics-render`, `study-time-render`, `mastery.pbt`, `progress-routes`, `skill-map`, `map-render`, `native-flashcards`, `native-flashcards-storage`, `attempt-write-batch`: 265 passed. Deferred to CI: `npm test`, `npm run test:property`, `npm run test:e2e`.
