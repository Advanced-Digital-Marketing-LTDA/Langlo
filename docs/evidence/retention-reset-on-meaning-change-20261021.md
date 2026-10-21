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

## Verification (local)

Commands run from the repository root with Node 22 and npm 11 (the container has Node 22; the repo pins 24, `--engine-strict=false`).

- `npx -y npm@11.9.0 ci --ignore-scripts --engine-strict=false`: installed.
- Targeted tests, `npx vitest run <files>`: `grammar-retention.integration` (35), `content-update` (45), `content-import`, `lesson-update-notice`, `db-migrations`, `portuguese-migration`, `db-remote-migrate`, `db-cli`: all pass.
- `npx svelte-check --tsconfig ./tsconfig.json`: 0 errors, 0 warnings. `npx eslint .`: exit 0. `npx prettier --check .`: all files match. `npx vite build` (adapter-node): done.
- Red then green:
  - Follow triggers disabled (their `retention_reset = 0` condition changed to `= 2`): `FAIL ... keeps recall state and due date when a wording-only version is published by insert` and `... by publish`; 31 others pass. Restored: pass.
  - Importer always storing 1: `FAIL tests/content-update.test.ts > ... keeps the schedule when every question only has its wording fixed`; 43 others pass. Restored: pass.
  - Importer fix for a quarantined baseline stashed: `FAIL ... resets the schedule when the version it continues was never published`; 44 others pass. With it: pass.
  - Newest-version guard removed from the publish-path follow trigger: `FAIL ... does not move a schedule when a wording-only version older than the newest is approved`. Restored: pass.
  - `reset_required = 0` added to the follow trigger: `FAIL ... keeps a pending reset when a wording-only version follows the version that caused it`. Restored: pass.
- Not run in the container: the full `npm test`, `npm run test:property` and `npm run test:e2e`. The project owner's standing rule is that the full suite is too slow to run in the cloud environment; CI runs it on this pull request.
