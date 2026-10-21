# Practice continues after a deploy — 2026-10-21

## Behavior implemented

- Practice progress was always stored in the database; what was lost was the way back. Starting practice now continues the learner's newest unfinished (active or paused) practice session in that language. A paused practice is resumed when continued, so lessons opened from the skill map serve questions. A new session begins only after the old one is finished.
- The practice page shows "Continue practice" (never "Start practice") while a practice is unfinished, with the answer count and a confirmed "Start over". Start over finishes every unfinished practice of the language, exactly as Finish session does, and starts a fresh one. A repeated tap keeps the new session open and still finishes any older unfinished one beside it; replaying a Start over whose session is already finished returns that session and finishes nothing else.
- The home page links to the unfinished practice of each track. Practising a topic from the skill map also continues it.
- When an answer or rating cannot reach the server (no action result at all), the typed answer and the page stay, with "Could not reach the server. Your answer was not saved. Try again." A retry reuses the same submission key.
- No schema or migration change.

## Behavior evidence

- **Unit/route:** `tests/learner-journeys.test.ts` (continue, pause resumes, finish then new, other learner never touched by start or Start over, Start over with older unfinished sessions, repeated tap, replay of a finished Start over), `tests/progress-routes.test.ts` (map continues the session), `tests/practice-render.test.ts` and `tests/dashboard-render.test.ts` (labels, link, no "Start practice" once started).
- **Browser (local, desktop and mobile profiles):** `tests/e2e/exercises.spec.ts` — the unreachable-server answer test (typed answer kept, retry sends the same submission key and stores one answer), the unreachable-server rating test, and the continue test pass.
- **Red before the change (recorded):** with `Exercise.svelte` reverted, the answer test failed on desktop: `Error: expect(locator).toContainText(expected) failed — Locator: getByRole('alert') — element(s) not found`; the page had been replaced by the error page.
- Existing tests that assumed every start creates a new session now finish the fixture's seeded unfinished practice first (`tests/learner-journeys.test.ts`, `tests/progress-routes.test.ts`, `tests/grammar-retention.integration.test.ts`).
- Start over finishes the practice exactly as Finish session does, so correct answers not yet rated are dropped (`discardUnratedPracticeAnswers`); the page says so.

## Checks run locally

`svelte-check`, `eslint`, `prettier --check`, the unit files above and the three e2e tests above, on Node 22.22.0 with dependencies installed without the lockfile (`npm ci` rejects it on this Node).

## Pending acceptance

- A run on the required toolchain (Node 24.19.0, npm 11.9.0, `npm ci`) with the full command list from AGENTS.md (`check`, `lint`, `format:check`, `test`, `test:property`, `build`, `test:e2e`) and its saved output. CI runs the full suite on every push; this was not run locally.
- Real-deploy confirmation that a redeploy mid-answer keeps the typed answer (only simulated here by aborting the request).
