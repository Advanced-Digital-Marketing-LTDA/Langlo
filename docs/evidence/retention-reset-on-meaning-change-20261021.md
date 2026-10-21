# Grammar retention resets only when a version changes what is asked

Date: 2026-10-21. Request (Andrew): publishing any new lesson version reset every learner's grammar retention schedule for the skill, even for a wording-only update ("a very bad design"). He chose a separate PR that merges before the grammar-hint PR (#139).

## Scope

- Migration `0031_retention_reset_on_meaning_change`: `content_versions.retention_reset` (integer, default 1, not null) and the two reset triggers from 0027/0030 recreated to fire only when it is not 0. Two new triggers (`grammar_retention_follow_wording_content`, `..._published_content`) move schedules to a newest published version whose flag is 0, keeping recall state and due date and raising `revision` by one. Same newest-version guard as the reset triggers.
- `src/lib/server/db/schema.ts`: the column.
- `src/lib/server/content-import.ts`: `insertVersion` stores `retention_reset = 0` when the version plan is patch-level (every question `same`, none removed), else 1.
- `docs/content-update.md`: a short section.

Untouched: migrations 0000 to 0030 and their snapshots, FSRS scheduling and stale logic in `grammar-retention.ts`, learner data, mastery, attempts, quarantine behavior.

## Behavior

- Wording-only version: schedule keeps state and due date, now on the new version, so it is not stale.
- Version that adds, changes or removes a question, or any version not inserted by the importer: reset as before.
- Existing rows get the column default, so already stored versions behave as before.

## Verification (local, run files only)

- `tests/grammar-retention.integration.test.ts`: new tests that a wording-only version keeps state and due date by insert and by publish, and does not move a schedule when it is not the newest. With the new triggers disabled, the two keep tests fail and the rest pass.
- `tests/content-update.test.ts`: new tests that an all-`same` revision keeps the schedule and that a changed, removed or added question resets it. With the importer always storing 1, the keep test fails.
- `tests/db-migrations.test.ts`, `tests/portuguese-migration.test.ts`: pending-migration lists include 0031.
- Also run and passing: `tests/db-remote-migrate.test.ts`, `tests/db-cli.test.ts`. `svelte-check` 0 errors; Prettier and ESLint clean.
- Not run: the full suite and e2e (left to CI). Applying the migration to any real database is an owner action.
