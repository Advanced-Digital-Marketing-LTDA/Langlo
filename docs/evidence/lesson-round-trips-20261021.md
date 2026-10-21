# Fewer database calls per practice answer (steps C1, C2 and C3 of the database performance plan)

**Scope:** how many database calls the lesson page makes when it loads and when an answer is saved. What is stored, the questions, the answers' outcomes and the error behavior are unchanged. This records local validation, not a latency result: the effect is checked in GlitchTip after deploy (`POST lesson` time, `db.transaction` `round_trips`).

## Why

Each call costs about 127 ms from the Coolify host to Turso. One answer cost 38 calls on a local copy of main (counted with a wrapper around the client, fixture `fr-a1-001`, correct typed answer, no AI fallback): 21 to save it and 17 for the page reload SvelteKit runs after the POST. The reload read the study session row 7 times, and `practiceFeedback` ran twice.

## Changes

- C1, reload (`lesson-practice.ts`, lesson `+page.server.ts`): `practiceFor` reads the feedback on the last answer once and shares it with the exercise; the lesson reads and the practice reads run together. The page load makes 12 calls instead of 17, and its longest chain is 7 calls instead of 17.
- C2, saving (`study.ts`, `recordAttemptWrite`): the four independent reads at the start of the transaction (earlier attempt under the submission key, study session, already-answered check, earlier evidence) go in one `tx.batch`; the attempt insert, its evaluation insert and a mistake's rating go in one `tx.batch`; the assessment completion check (a read and a write) is skipped for sessions without an assessment plan, where it cannot change anything. Saving now makes 15 calls instead of 21 (transaction: begin, 11 statements, commit).
- Error order is unchanged: replay, session, question, version, plan, already answered. The prepared answer is now graded before the insert rather than after it; a corrupt question still fails the transaction and rolls it back.

- C3, indexes (new forward migration `0032_question_and_attempt_lookup_indexes`, schema `questions_content_version_idx` and `attempts_owner_session_question_idx`): Turso's top-queries view (2026-10-21) showed the next-question read at 4.02K rows read per call. Its query plan showed `SCAN q`: `questions` had no index on `content_version_id`, and the `attempts` lookup by owner, session and question had no usable index (the one that matches is partial, on `evidence_kind = 'independent'`, which the query does not state). With the migration the plan is `SEARCH q USING INDEX questions_content_version_idx (content_version_id=?)` and `attempts_owner_session_question_idx` for the answered check and the session's attempt reads. Existing migrations, snapshots and journal entries are untouched (the journal only gains an entry). The migration is applied by the deploy migrate gate, not by hand against production. It creates two indexes, which take a short time to build and add a little to each insert on those tables.

## Red and green

`tests/lesson-load-round-trips.test.ts` (5 tests). Red on main:

```
× saves an answer in few round trips      AssertionError: expected 21 to be less than or equal to 15
× reads the feedback on the last answer once for the whole page   expected 2 to be 1
× overlaps the lesson reads with the practice reads   expected 1 to be greater than or equal to 2
```

Green after: 5 passed. The review also added two tests that fail on the earlier code: a database outage beside a missing lesson must not become a 404 (red on `Promise.all`), and a lesson read and a practice read must be in flight together (red when awaited one after the other).

`tests/attempt-write-batch.test.ts` (26 tests) pins what the batched write must keep: which refusal wins when several apply, that corrupt question data leaves no attempt, evaluation or evidence row, the evidence ledger rows for correct, incorrect, not-sure and fallback answers, and the mistake rating. Run against main's `study.ts`, 24 pass (behavior unchanged) and the 2 tests that assert an assessment completion is skipped for practice answers fail, as that skip is this change. `attempt-evaluation.test.ts` also gained a test where the rating update inside the batch fails and the whole answer rolls back.

`tests/question-lookup-indexes.test.ts` (2 tests) explains the exact statement the next-question read sends. Red without the migration: both fail (`expected false to be true`, no index in the plan). Green with it: 2 passed.

Tests updated for the new migration: `db-migrations.test.ts` and `portuguese-migration.test.ts` list the pending migrations by tag, and the pre-0007 upgrade comparison excludes the two new index names, like the other later indexes.

## Checks

`npm run check` 0 errors, 0 warnings; `npm run lint`, `prettier --check` on changed files and `npm run build` (adapter-node) clean for C1 and C2; for C3 `check`, eslint and prettier on the changed files, plus `db-migrations`, `db-remote-migrate`, `portuguese-migration`, `content-import-script` (115 passed with the new tests). Because this changes the answer path, also run (not the full suite): `attempt-evaluation`, `attempt-fallback`, `assessment`, `assessment-routes`, `assessment-feedback`, `learner-routes`, `grammar-retention.integration`, `study-resume`: 200 passed. Deferred to CI: `npm test`, `npm run test:property`, `npm run test:e2e`.

## Not covered here

Remaining per-answer cost: the 4 reads before the transaction (two read the session row), 4 evidence-ledger reads inside it, and the AI fallback call for typed answers that miss the stored ones (not measured). The login session lookup (419 queries a day, indexed, so it costs the round trip) is not changed; a short-lived session cache would remove most of those.
