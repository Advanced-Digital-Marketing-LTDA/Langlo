# Content update mechanism (LANGLO-166 plan; LANGLO-167 to 170)

Date: 2026-10-19. Base: `main` `ce8f05f`. Owner approved the plan and tickets in the project thread. No production database, remote database, provider call, credential or deployment was used; every database in the tests is a disposable local fixture. Migration 0016 is not applied anywhere.

## Behavior and scope

- Migration `0016_content_updates.sql` (additive): `questions.lineage_key`, `skills.retired_at`, `replaced_by`, `carry_progress`, and the `content_changes` table. No existing migration was edited.
- Importer (`content-update.ts`, `content-import.ts`): question declarations (`change`, `continues`), lineage keys, bump check (`VERSION_BUMP`), skill retirements, change log. A package without the new fields keeps its fingerprint, so already imported packages (including production's `1.0.0`) still re-import as a no-op.
- `content:import --impact --confirm-host HOST`: read-only report of the answers mastery counts today that would stop counting (same rules as mastery), including a stored current version a package quarantines, a carried retirement's unmatched items, and successive new versions of one skill.
- Mastery (`mastery.ts`): keyed by lineage key, only for keys in the skill's current version (newest version that is not quarantined); retired skills leave the catalog; an approved carry counts a retired skill's answers for its replacement. Assessments (`assessment.ts`) treat an item as answered by lineage key and skip retired skills.
- Quarantine: the importer logs `version-quarantined`; lessons, the mastery catalog, the update notice, assessments and mastery use the newest version that is not quarantined (the newest of all when every version is quarantined, so that case still reads as unavailable). A carry cannot target a retired skill.
- Lesson page: a session on an earlier version is told a newer lesson exists (`newerVersionAvailable`).
- Docs: `docs/content-update.md` (authoring rules, rollback, owner runbook); `content-import.md`, `content-maintenance.md`, `scoring-policy.md` and `schema.md` updated where they described the old behavior.
- Deviation from the plan: the "updated" notice is derived by comparing the pinned version with the newest version that has a lesson, not from `content_changes`, so it also works for versions imported before 0016. The log is the audit record.

## Existing tests changed

Only what the new rules require: a second version now declares `change` (`content-import`, `assessment`, `study-resume`, `content-reports`, `curriculum-modules`, `db-migrations` tests); quarantine imports use a patch bump (`content-import`); migration counts and the index exclusion list include 0016 (`db-migrations`, `db-remote-migrate`, `content-import-script`); exact lesson shape includes `newerVersionAvailable` (`study-resume`). No Stryker or Fast Check test was edited.

## Observed green

Node 22.22.0 (not the pinned 24.19), only new and touched test files. The earlier 17-file run below was before the review fixes; after them the files touched by those fixes (`content-update`, `assessment`, `study-resume`, `mastery`, `mastery-updates`, `content-import`, `content-import-script`) were re-run green.

```text
vitest run tests/content-update.test.ts tests/mastery-updates.test.ts tests/lesson-update-notice.test.ts \
  tests/content-import.test.ts tests/content-import.pbt.test.ts tests/content-import-script.test.ts \
  tests/assessment.test.ts tests/study-resume.test.ts tests/mastery.test.ts tests/mastery.pbt.test.ts \
  tests/content-reports.test.ts tests/curriculum-modules.test.ts tests/db-migrations.test.ts \
  tests/db-remote-migrate.test.ts tests/fr-a1-module-01.test.ts tests/learner-routes.test.ts \
  tests/learner-journeys.test.ts
Test Files 17 passed (17)   Tests 653 passed (653)
```

`svelte-check` 0 errors, eslint and prettier clean on the changed files. The full suite was not run locally; CI runs it. Not run here, left to CI: `test:property`, `test:e2e`, `build`, and everything on the pinned Node 24.19 / npm 11.9 toolchain.

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

## Fingerprint unchanged for existing packages

`validatePackage(modulesPackage(root))` on `main` (`ce8f05f`) and on this branch both give `8fc7b34c891e7d015f0ef107937b03583555316c470147231cca29c1c45a2af4` for the 32 authored modules, so a database that already imported them under `1.0.0` re-imports the same package as a no-op.

## Pending acceptance

- Not run against a real Turso database. Migration 0016 must be applied before any import that carries declarations or retirements; the owner applies it.
- The `--impact` report counts answers, not recalculated statuses.
- Existing coverage for the stale-tab (`STALE_QUESTION`), session pinning and withdrawn pinned version cases is in `study-resume.test.ts`; this change adds the notice and the update-time mastery tests, not new stale-tab behavior.
- CI results are not claimed here.
