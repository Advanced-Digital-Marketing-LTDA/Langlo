# Fewer database calls per practice answer (steps C1 and C2 of the database performance plan)

**Scope:** how many database calls the lesson page makes when it loads and when an answer is saved. What is stored, the questions, the answers' outcomes and the error behavior are unchanged. This records local validation, not a latency result: the effect is checked in GlitchTip after deploy (`POST lesson` time, `db.transaction` `round_trips`).

## Why

Each call costs about 127 ms from the Coolify host to Turso. One answer cost 38 calls on a local copy of main (counted with a wrapper around the client, fixture `fr-a1-001`, correct typed answer, no AI fallback): 21 to save it and 17 for the page reload SvelteKit runs after the POST. The reload read the study session row 7 times, and `practiceFeedback` ran twice.

## Changes

- C1, reload (`lesson-practice.ts`, lesson `+page.server.ts`): `practiceFor` reads the feedback on the last answer once and shares it with the exercise; the lesson reads and the practice reads run together. The page load makes 12 calls instead of 17, and its longest chain is 7 calls instead of 17.
- C2, saving (`study.ts`, `recordAttemptWrite`): the four independent reads at the start of the transaction (earlier attempt under the submission key, study session, already-answered check, earlier evidence) go in one `tx.batch`; the attempt insert, its evaluation insert and a mistake's rating go in one `tx.batch`; the assessment completion check (a read and a write) is skipped for sessions without an assessment plan, where it cannot change anything. Saving now makes 15 calls instead of 21 (transaction: begin, 11 statements, commit).
- Error order is unchanged: replay, session, question, version, plan, already answered. The prepared answer is now graded before the insert rather than after it; a corrupt question still fails the transaction and rolls it back.

## Red and green

`tests/lesson-load-round-trips.test.ts` (4 tests). Red on main:

```
× saves an answer in few round trips      AssertionError: expected 21 to be less than or equal to 15
× reads the feedback on the last answer once for the whole page   expected 2 to be 1
× overlaps the lesson reads with the practice reads   expected 1 to be greater than or equal to 2
```

Green after: 4 passed.

## Checks

`npm run check` 0 errors, 0 warnings; `npm run lint`, `prettier --check` on changed files and `npm run build` (adapter-node) clean. Because this changes the answer path, also run (not the full suite): `attempt-evaluation`, `attempt-fallback`, `assessment`, `assessment-routes`, `assessment-feedback`, `learner-routes`, `grammar-retention.integration`, `study-resume`: 200 passed. Deferred to CI: `npm test`, `npm run test:property`, `npm run test:e2e`.

## Not covered here

Remaining per-answer cost: the 4 reads before the transaction (two read the session row), 4 evidence-ledger reads inside it, and the AI fallback call for typed answers that miss the stored ones (not measured). The question-list query that reads about 4,000 rows is a separate fix (an index migration), not in this change.
