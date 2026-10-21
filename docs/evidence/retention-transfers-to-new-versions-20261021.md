# Grammar retention always transfers to new content versions

Date: 2026-10-21. Request (Andrew): publishing a new lesson version reset learners' grammar retention schedules (migration 0030 triggers). A first revision of this PR kept resets for versions that change a question; Andrew rejected that: "I don't want resets of retention ... the retention data simply transfers". Asked whether to restore learners already reset from their stored recall state: "yes, make sure their history never gets lost". This PR merges before the grammar-hint PR (#139).

## Scope

- Migration `0032_retention_transfers_to_new_versions` (new; 0000 to 0031 untouched):
  - Drops the two reset triggers and the two wording-only follow triggers from 0031, and the `content_versions.retention_reset` column 0031 added.
  - Adds `grammar_retention_transfer_new_content` and `grammar_retention_transfer_published_content`: when a version becomes the newest published version of a skill (insert or status change), schedules move to it with recall state and due date unchanged and `revision` raised by one. An older version approved after a newer one moves nothing.
  - Restores rows with `reset_required = 1`: `due_at` from the `due` stored in `state_json`, `reset_required = 0`, `revision + 1`. The first statement aborts the migration if such a row has no readable ISO `due`, so nothing is guessed.
- `src/lib/server/grammar-retention.ts`: a review continues from the stored recall state whenever a schedule exists (a new card only when there is none); the progress view no longer treats a schedule on an earlier version or with the reset flag as stale.
- `src/lib/server/content-import.ts`, `src/lib/server/content-update.ts`: back to `main` (the wording-only flag logic is gone). `src/lib/server/db/schema.ts`: `retentionReset` removed.
- `docs/content-update.md`: the retention section.

Untouched: migrations 0000 to 0031 and their snapshots, the immutable `grammar_retention_events` history, FSRS scheduling, attempts, mastery, quarantine.

Not covered: a learner who was reset and then reviewed the skill before this migration already has a schedule rebuilt from a new card. Their review events are all still stored; replaying them is not part of this PR.

## Verification (local)

Node 22 with npm 11 (`npx -y npm@11.9.0 ci --ignore-scripts --engine-strict=false`; the repo pins Node 24).

Red, before the change (tests written first), `npx vitest run tests/content-update.test.ts tests/grammar-retention.integration.test.ts tests/db-migrations.test.ts -t "schedule|Portuguese retention|reset|transfer|restore"`: `Tests 12 failed | 9 passed | 80 skipped (101)`. Failing:

- content-update: keeps the schedule on the published version when a quarantined version is skipped; transfers the schedule unchanged to a version (0.2.0) with a question that changes meaning / a question removed / a question added
- grammar-retention.integration: transfers recall state and due date unchanged to a new version published by insert / by publish; continues the stored recall state of a schedule left on an earlier version / with a pending reset
- db-migrations: preserves schedules ... through the Portuguese retention rebuild; restores schedules that an earlier version reset from their stored recall state; refuses to restore a reset schedule whose stored state has no due date / an unreadable due date

Green, after: `npx vitest run tests/content-update.test.ts tests/grammar-retention.integration.test.ts tests/db-migrations.test.ts tests/portuguese-migration.test.ts`: `Test Files 4 passed (4)`, `Tests 110 passed (110)`. Related files `content-import`, `lesson-update-notice`, `db-remote-migrate`, `db-cli`, `grammar-retention`: `Test Files 5 passed (5)`, `Tests 140 passed (140)`.

Mutations (each restored afterwards):

- Review resets again when the schedule is on another version or flagged: `Tests 2 failed` (continues the stored recall state ... on an earlier version / with a pending reset).
- Progress view shows a flagged schedule as due now: `Tests 1 failed` (... with a pending reset).
- Newest-version guard removed from `grammar_retention_transfer_published_content`: `FAIL does not reset current schedules when an older version is approved by publish` and `FAIL upgrades grammar retention triggers ... only moves schedules to the newest published content`.

Checks: `npm run check`: 0 errors, 0 warnings. `npx eslint` on the changed files: exit 0. `npx prettier --check src tests drizzle/meta docs`: all match.

Not run in the container: the full `npm test`, `npm run test:property` and `npm run test:e2e`. The project owner's standing rule is that the full suite is too slow in the cloud environment; CI runs it on this pull request.
