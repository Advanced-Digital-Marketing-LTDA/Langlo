# Fewer database calls when rating a practice answer (R1, R2 and R3)

**Scope:** how many database calls the lesson page makes when a correct grammar answer is rated, and how the page moves to the next question afterwards. What is stored, the ownership checks, the refusals and the ledger rows are unchanged. This records local validation, not a latency result: the effect is checked in GlitchTip after deploy (`POST lesson` time for `?/rate`).

## Why

Each call costs about 127 to 139 ms from the Coolify host to Turso, and the queries themselves take 1 to 12 ms. One rated grammar question cost 47 calls on main (counted with a wrapper around the client, fixture `fr-a1-001`, retention policy on, correct answer, rating `good`): answer 14, reload 10, rating 11, reload 12. The rating read the attempt and the session before its transaction and again inside it; the ledger read the attempt again to find its lineage; the reload read the session row three times and the retry question with two more calls.

## Changes

- R1, rating save (`study.ts`, `mastery.ts`, `lesson-practice.ts`): the lesson's skill, session and practice-mode checks run on the attempt rows the rating transaction already reads (`grammarAttemptRows` now also returns the question's lineage key), so the two reads before the transaction are gone. The rating path syncs the ledger from those rows' lineages instead of reading the attempt again (`syncLineageEvidence`). The ledger's history read and its two current-content reads go in one `tx.batch`; this also applies to the answer path and assessment completion, which use the same ledger sync. Saving a rating now makes 6 calls instead of 11 (begin, attempt read, update, one batch, evidence insert, commit). Saving an answer makes 13 instead of 14.
- R2, reload (`lesson-practice.ts`, `study-content.ts`): the lesson half reads the session once (`ownSession`, then `sessionLessonIn`) instead of twice; the practice half reads the session once and passes it to the next-question lookup (`nextQuestionIn`); the assisted retry question comes from the feedback read (same question, same `holdout = 0` rule) instead of two more calls. The reload after a rating makes 8 calls instead of 12, and its longest chain is 4 calls instead of 7.
- R3, no second reload (`lesson-practice.ts`, lesson `+page.svelte`): the rating result carries the rating and the session's next exercise (`{ rated, rating, exercise }`, the same shape and notices the page load produces). The rating form updates with `invalidateAll: false`, and the page shows the rated feedback and the returned exercise until the next form result, such as the next answer, reloads it. The rating request makes 8 calls (the save plus 2 for the next question) and no reload follows.

One rated grammar question: 47 calls before, about 28 after (answer 13, reload 7, rating 8).

## Red and green

`tests/lesson-load-round-trips.test.ts`, new `lesson rating round trips` tests. Red on main:

```
× saves a rating in few round trips and keeps the ledger   expected 11 to be less than or equal to 6
× returns the next question with the rating, so the page need not reload   expected { rated: true } to match object { rated: true, rating: 'good', …(1) }
× reloads after a rating in few round trips   expected 12 to be less than or equal to 8
```

Green after: 12 passed. The four refusal tests (another skill, another session, another learner, an assessment session: `NOT_FOUND`, rating left empty) pass on main and after, since the checks moved into the transaction.

Tests changed:

- `lesson-load-round-trips.test.ts`, overlap test: the lesson-side read it looks for is now the enrollment read (`explanation_language`), which only the lesson half sends. It looked for `assessment_plan`, which both halves send, and the lesson half no longer reads the session twice.
- `learner-journeys.test.ts`, lesson rating action: the success result is now checked with the rating and the next exercise instead of `{ rated: true }` alone.

## Checks

`npm run check` 0 errors, 0 warnings; eslint and `prettier --check` on changed files; `npm run build` (adapter-node, Node 24.19) clean. Related unit and integration tests, not the full suite: `lesson-load-round-trips`, `attempt-write-batch`, `grammar-retention.integration`, `assessment-feedback`, `assessment-routes`, `assessment`, `study-resume`, `lesson-translations`, `question-lookup-indexes`, `attempt-evaluation`, `portuguese-tracks`, `learner-journeys`, `lesson-update-notice`, `mastery-updates`, `mastery`, `mastery.pbt`: 310 passed. E2E, desktop project only, `exercises.spec.ts` rating and exercise specs (rating in place keeps scroll, rating once on retry after the server is unreachable, live region, buttons disabled until interactive, all four formats, map context through answer, retry and report): 6 passed. Deferred to CI: `npm test`, `npm run test:property`, the full `npm run test:e2e` and the mobile project.

## Review fix: refused answer after a rating

The rated result is kept in page state until the page data loads again, instead of being read from the latest form result. Before, a refused answer to the returned exercise (session paused elsewhere) replaced the form result, so the page fell back to the pre-rating data: the rating buttons came back and the refusal message was not shown. New e2e test `keeps the rated feedback and next question when the next answer is refused`: red with the old page (`getByRole('alert')` not found), green with the fix. Desktop rating and exercise specs: 7 passed. `npm run check` 0 errors.
