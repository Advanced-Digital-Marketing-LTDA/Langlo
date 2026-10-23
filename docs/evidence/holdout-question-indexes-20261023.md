# Holdout-question pick at assessment start: indexes (migration 0034)

**Symptom:** Turso Cloud "Top Queries" for the `langlo` database, ranked by rows read, today (UTC) on 2026-10-23, as shared by the owner: the holdout-question query in `assessmentQuestions` (`src/lib/server/assessment.ts`, run by `startAssessment`) averaged 280.49K rows read and 232 ms per call (1 call). Every other listed query read 6.40K rows or fewer.

**Cause:** its plan scanned the whole `questions` table, and for each holdout question searched the learner's attempts by `owner_id` alone, so it read every attempt the learner had ever made once per holdout question.

**Fix:** migration `0034_holdout_question_lookup_indexes` adds `attempts_owner_skill_idx` on `attempts (owner_id, skill_id)` and `questions_language_holdout_idx` on `questions (language, holdout)`. The query text is unchanged.

**Plan before** (fixture database, statement captured from `startAssessment`, relevant steps):

```
SCAN q
CORRELATED SCALAR SUBQUERY 8
SEARCH a USING INDEX attempts_owner_session_question_idx (owner_id=?)
```

**Plan after:**

```
SEARCH q USING INDEX questions_language_holdout_idx (language=? AND holdout=?)
CORRELATED SCALAR SUBQUERY 8
SEARCH a USING INDEX attempts_owner_skill_idx (owner_id=? AND skill_id=?)
```

**Red (0034 SQL file and journal entry removed), `tests/holdout-question-indexes.test.ts`:**

```
× creates both indexes as migration 0034 defines them
× finds holdout questions of a language through an index
× finds a learner's earlier answers on a skill through an index
Tests  3 failed (3)
```

**Green (with 0034):** `Tests  3 passed (3)`. `tests/db-migrations.test.ts` and `tests/portuguese-migration.test.ts`: 30 passed. Run locally on Node 22.22.0 / npm 10.9.4; CI's full suite is authoritative.

**Pending acceptance:** after deploy, the same Turso Top Queries view should show far fewer rows read for this query. Local plans use a fixture database and do not prove production row counts.
