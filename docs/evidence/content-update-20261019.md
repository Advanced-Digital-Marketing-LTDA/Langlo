# Content update mechanism (LANGLO-166 plan; LANGLO-167 to 170)

Date: 2026-10-19. Base: `main` `ce8f05f`. Owner approved the plan and tickets in the project thread. No production database, remote database, provider call, credential or deployment was used; every database in the tests is a disposable local fixture. Migration 0016 is not applied anywhere.

## Behavior and scope

- Migration `0016_content_updates.sql` (additive): `questions.lineage_key`, `skills.retired_at`, `replaced_by`, `carry_progress`, and the `content_changes` table. No existing migration was edited.
- Importer (`content-update.ts`, `content-import.ts`): question declarations (`change`, `continues`), lineage keys, bump check (`VERSION_BUMP`), skill retirements, change log. A package without the new fields keeps its fingerprint, so already imported packages (including production's `1.0.0`) still re-import as a no-op.
- `content:import --impact --confirm-host HOST`: read-only report of independent answers that would stop counting.
- Mastery (`mastery.ts`): keyed by lineage key, only for keys in the skill's current version (newest version that is not quarantined); retired skills leave the catalog; an approved carry counts a retired skill's answers for its replacement. Assessments (`assessment.ts`) treat an item as answered by lineage key and skip retired skills.
- Lesson page: a session on an earlier version is told a newer lesson exists (`newerVersionAvailable`).
- Docs: `docs/content-update.md` (authoring rules, rollback, owner runbook); `content-import.md`, `content-maintenance.md`, `scoring-policy.md` and `schema.md` updated where they described the old behavior.
- Deviation from the plan: the "updated" notice is derived by comparing the pinned version with the newest version that has a lesson, not from `content_changes`, so it also works for versions imported before 0016. The log is the audit record.

## Existing tests changed

Only what the new rules require: a second version now declares `change` (`content-import`, `assessment`, `study-resume`, `content-reports`, `curriculum-modules`, `db-migrations` tests); quarantine imports use a patch bump (`content-import`); migration counts and the index exclusion list include 0016 (`db-migrations`, `db-remote-migrate`, `content-import-script`); exact lesson shape includes `newerVersionAvailable` (`study-resume`). No Stryker or Fast Check test was edited.

## Observed green

Node 22.22.0 (not the pinned 24.19), only new and touched test files:

```text
vitest run tests/content-update.test.ts tests/mastery-updates.test.ts tests/lesson-update-notice.test.ts \
  tests/content-import.test.ts tests/content-import.pbt.test.ts tests/content-import-script.test.ts \
  tests/assessment.test.ts tests/study-resume.test.ts tests/mastery.test.ts tests/mastery.pbt.test.ts \
  tests/content-reports.test.ts tests/curriculum-modules.test.ts tests/db-migrations.test.ts \
  tests/db-remote-migrate.test.ts tests/fr-a1-module-01.test.ts tests/learner-routes.test.ts \
  tests/learner-journeys.test.ts
Test Files 17 passed (17)   Tests 653 passed (653)
```

`svelte-check` 0 errors, eslint and prettier clean on the changed files. The full suite was not run locally; CI runs it.

## Observed red (a guard removed, matching test fails, guard restored)

- bump check skipped: 6 failed in `content-update`
- missing-`change` check removed: 1 failed
- lineage key not inherited: 2 failed
- removed questions not logged: 1 failed
- double `continues` allowed: 1 failed
- retirement not a major change: 1 failed
- mastery current-version filter removed: 2 failed in `mastery-updates`
- carry removed: 1 failed; stored lineage key ignored: 1 failed; retired skill shown: 1 failed; quarantined newest treated as current: 1 failed
- assessment item identity by number: 1 failed in `assessment`
- notice never shown: 1 failed in `study-resume`; shown for a withdrawn version: 1 failed; newest version without a lesson counted: 1 failed

## Pending acceptance

- Not run against a real Turso database. Migration 0016 must be applied before any import that carries declarations or retirements; the owner applies it.
- The `--impact` report counts answers, not recalculated statuses.
- Existing coverage for the stale-tab (`STALE_QUESTION`), session pinning and withdrawn pinned version cases is in `study-resume.test.ts`; this change adds the notice and the update-time mastery tests, not new stale-tab behavior.
- CI results are not claimed here.
