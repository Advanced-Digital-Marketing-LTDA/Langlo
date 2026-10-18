# Learner journeys: enrollment, settings, practice, decks, review, Anki export

2026-10-18. Branch `claude/project-thread-jhk35g`, PR #104, starting from `eb34e6f`.

## Scope

New pages and server modules for enrollment (`/app/enroll`), settings
(`/app/settings`: lesson language per enrollment and timezone), practice sessions
(`/app/practice/[language]`, `/app/session/[id]` and `/results`), decks and notes
(`/app/decks`, approval, Anki text export) and the due-card review queue
(`/app/review`). Migration `0015_learner_preferences` adds the `learner_preferences`
table. Existing tests changed only for that migration: the migration count in
`tests/db-migrations.test.ts` moves from 15 to 16 and one new auto-index joins its
exclusion list, as earlier migrations did.

## Test order and observed output

`tests/learner-journeys.test.ts` was written together with the code, not strictly
before it. The red output below was observed on first runs and on the review fix;
it is recorded as seen, not reconstructed.

- First run of the new file: 3 failed, 16 passed.
  - A French A2 enrollment hit the database trigger `Enrollment must use a
supported track` (a raw `SQLITE_CONSTRAINT`) instead of a validation error.
    Fix: `levelsFor` in `src/lib/server/enrollment.ts` rejects French A2 before
    the insert and the enroll page offers only supported levels.
  - Notes created in the same millisecond listed in id order. Fix: order by
    `created_at, rowid`.
- `tests/db-migrations.test.ts` after adding migration 0015: 2 failed (the new
  auto-index and the migration count 16 against 15). Fixed as described above.
- Review finding (Codex P1, Anki identity): two new tests (`gives notes with the
same front different Anki identities` and the updated export layout) failed
  with `expected 1 to be 2` and a missing GUID column. Fix: the export now
  carries each note's persisted source id as the Anki `#guid` column.
- Green after the fixes: `tests/learner-journeys.test.ts` 22 passed;
  `tests/db-migrations.test.ts` and `tests/dashboard-render.test.ts` 25 passed.
  `svelte-check` (0 errors), `eslint` and `prettier --check .` are clean.

## What the tests assert

Enrollment validation, French A1 only, duplicate conflict (409) leaving the first
enrollment unchanged, owner isolation; timezone validation, replace and
isolation; lesson language only for an owned enrollment; idempotent practice start
by submission key, foreign key reuse and unenrolled language as 404, invalid key
as 400; practice summary by newest evaluation, finish only for the owner's
practice sessions, results routes; deck and note creation, draft status, cloze
validation, foreign deck as 404; due queue shows approved, unsuspended, due cards
only; every rating (again, hard, good, easy) is stored as chosen; stale revision
409 and invalid rating 400; Anki export contains approved notes only, with field
quoting, a per-note GUID, owner-only access and private no-store headers.

## Pending acceptance

- The full suite, property tests, build and browser tests were not run locally
  (the full suite is too slow in the cloud environment); CI is the first full run.
- No browser (Playwright) journey covers the new pages yet.
- The Anki export is Anki's tab-separated text import. Import into a real Anki
  client (including Windows) has not been checked, and no `.apkg` package is
  produced.
- No live provider, production database or deployment was used.
