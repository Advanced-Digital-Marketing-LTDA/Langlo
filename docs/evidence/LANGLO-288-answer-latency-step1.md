# LANGLO-288 step 1: time grading, one fewer answer round trip

**Scope:** first, partial step of LANGLO-288. Local fixtures and a stubbed grader only; no live provider, production database or deployment. This is not a live latency result or acceptance.

## Local measurement (before)

A throwaway probe (not committed) wrapped a fixture client, counted every round trip and added a simulated 50 ms per trip, close to the 42.7 ms dev Turso read in `remote-reads-skip-queue-20261021.md`. The grader was a stub that answers at once.

- Prepared match (multiple choice or typed): 4 reads before the write and 9 trips in the write transaction, about 0.6 s.
- Unmatched typed answer: 4 reads, a 6-trip save, then the saved-verdict lookup, two usage writes and a 6-trip grading transaction, 19 trips, about 0.95 s, plus the grader call.
- Lesson page reload after an answer: 8 queries in about 4 overlapping waves, about 0.2 s.

The database explains about 1.2 s of the reported four seconds. The rest is inferred to be the inline grader call, which had no timing. Not measured live.

## Changes

- `study.grade-fallback` span around grading after the answer is saved, and `study.jev-call` span around the grader call. Spans carry only the `evaluated` flag, never answer text. Prepared matches make neither span.
- The lesson answer action reuses its study session read (`nextQuestionIn`), so it no longer reads the session twice.

## Red and green

- `tests/lesson-load-round-trips.test.ts` "saves an answer in few round trips": budget lowered from 15 to 12. Without the action change it counts 13 and fails; with it, 12 and passes.
- `tests/tracing-spans.test.ts`: new tests for both grading spans on an unmatched typed answer and none on a prepared match.
- `npm run check`, `npm run lint` on changed files, `prettier --check` on changed files and `npm test` (130 files, 2193 tests) pass on Node 22.22.0, not the pinned 24.19.0.

## Pending

- Live traces to confirm the grader's share of the delay. If it dominates, the next step is the LANGLO-288 design of saving first, showing a pending state and grading after.
- Usage-count writes (reserve before the call, tokens after) are unchanged: they cannot become one statement without moving the cap check after the call.
- `npm run test:property`, `npm run build` and `npm run test:e2e` were not run here.
