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
- `package-lock.json` is regenerated with the pinned `npm@11.9.0 install --package-lock-only`, at the owner's request in this PR. `npm ci --ignore-scripts` failed on `main` too because the lock pinned `@babel/helper-string-parser` 7.29.7 where 7.29.11 is required. Only that entry changed.

## Red and green

- `tests/lesson-load-round-trips.test.ts` "saves an answer in few round trips": budget lowered from 15 to 12.
- `tests/tracing-spans.test.ts`: new tests for both grading spans on an unmatched typed answer, `evaluated: false` when the grader gives no usable answer, and no grading spans on a prepared match.

Red, observed with `src/lib/server/lesson-practice.ts` and then `src/lib/server/study.ts` restored to `main` (4f35cc2), new tests kept:

```
AssertionError: expected 13 to be less than or equal to 12
      Tests  1 failed | 13 skipped (14)

 FAIL  tests/tracing-spans.test.ts > an unmatched typed answer times its grading and the grading call
AssertionError: expected [ 'mastery.sync-evidence' ] to include 'study.grade-fallback'
 FAIL  tests/tracing-spans.test.ts > a grading call with no usable answer records evaluated false
AssertionError: expected undefined to deeply equal { evaluated: false }
      Tests  2 failed | 10 passed (12)
```

Green, with this PR's sources:

```
tests/tracing-spans.test.ts tests/lesson-load-round-trips.test.ts
      Tests  26 passed (26)
```

- `npm run check`, `npm run lint` on changed files, `prettier --check` on changed files and `npm test` (130 files, 2193 tests) pass on Node 22.22.0, not the pinned 24.19.0.

## Pending

- Live traces to confirm the grader's share of the delay. If it dominates, the next step is the LANGLO-288 design of saving first, showing a pending state and grading after.
- Usage-count writes (reserve before the call, tokens after) are unchanged: they cannot become one statement without moving the cap check after the call.
- `npm run test:property`, `npm run build` and `npm run test:e2e` were not run here.
