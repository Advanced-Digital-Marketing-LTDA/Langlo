# Practice continues after a deploy — 2026-10-21

## Behavior implemented

- Practice progress was always stored in the database; what was lost was the way back. Starting practice now continues the learner's newest unfinished (active or paused) practice session in that language. A new session begins only after the old one is finished.
- The practice page shows "Continue practice" (never "Start practice") while a practice is unfinished, with the answer count and a confirmed "Start over". Start over finishes every unfinished practice of the language, exactly as Finish session does, and starts a fresh one. A repeated tap keeps the new session open.
- The home page links to the unfinished practice of each track. Practising a topic from the skill map also continues it.
- When an answer or rating cannot reach the server (no action result at all), the typed answer and the page stay, with "Could not reach the server. Your answer was not saved. Try again." A retry reuses the same submission key.
- No schema or migration change.

## Behavior evidence

- **Unit/route:** `tests/learner-journeys.test.ts` (continue, pause, finish then new, other learner, Start over with an older unfinished session, repeated tap), `tests/progress-routes.test.ts` (map continues the session), `tests/practice-render.test.ts` and `tests/dashboard-render.test.ts` (labels, link, no "Start practice" once started).
- **Browser:** `tests/e2e/exercises.spec.ts` — the unreachable-server test failed before the change (no message, page replaced) and passes after it; the continue test passes. Both ran on desktop and mobile profiles.
- Existing tests that assumed every start creates a new session now finish the fixture's seeded unfinished practice first (`tests/learner-journeys.test.ts`, `tests/progress-routes.test.ts`, `tests/grammar-retention.integration.test.ts`).

## Checks run

Only the files above, with Node 22.22.0 (the repo asks for 24.19; dependencies installed without the lockfile because `npm ci` rejects it on this Node). `svelte-check`, `eslint` on the changed files and `prettier --check` pass. The full unit and e2e suites were not run here; CI runs them.
