# Portuguese (Brazil) B1/B2: platform support

Date: 2026-10-20. Board: LANGLO-259, 260 and 261 under LANGLO-258. Plan: project file `notes/pt-br-b1-b2/plan.md`. Owner decisions (2026-10-20): Portuguese is a new target language with B1 and B2 tracks only; lessons are explained in English; content follows in later PRs.

## Scope

Platform only. No Portuguese curriculum content is added: the coverage CSV, prerequisite graph, ID registry, manifest version (still 1.1.0) and module files are unchanged. No database other than disposable local fixtures was touched, no content was imported and no provider was called.

- **Contract validator** (`scripts/curriculum-contract.mjs`): `Portuguese` with levels `B1`/`B2` is a supported track. The manifest lists the five existing tracks, then optionally Portuguese B1, then Portuguese B2 (B2 never without B1) and must list exactly the tracks the catalog holds. Level order is A1 < A2 < B1 < B2 for prerequisite edges. The five existing tracks stay mandatory; `Portuguese A1`/`A2` and `B1`/`B2` on other languages are refused.
- **Bundle reader and importer** (`content-bundle.ts`, `content-import.ts`): language `pt`, levels `B1`/`B2`, tracks `pt B1` and `pt B2`. A lesson translation on a Portuguese skill is still refused (translations need an English lesson).
- **Migration `0026_portuguese_tracks.sql`** (new; written in this PR and revised after review, no existing migration, snapshot or journal entry was edited): rebuilds `skills` and `enrollments` with widened CHECKs, keeps every row (a gate aborts the migration if a row count changes), recreates the `skills` identity triggers unchanged, recreates the `enrollments` track guard with pt B1/B2, and adds triggers refusing Portuguese explanations on the Portuguese track. `schema.ts` enums follow.
- **App code:** `enrollment.ts` (`pt`, levels per track, Portuguese lessons in English only, checked on enroll and on changing the lesson language), enroll and settings pages offer only the lesson languages each track allows, `src/lib/levels.ts` (shared level list, assessed levels per track), `assessment.ts` (coverage counted over B1/B2 for Portuguese and A1/A2 otherwise; results report `foundationLevel` and `foundationGaps`, replacing `a1Gaps`, which was always the lowest level), assessment pages and `GrammarProgress.svelte` show B1/B2 topics.

Untouched: all existing migrations and Drizzle metadata entries, curriculum content, learner data, scoring, FSRS and cards, auth, Stryker and Fast Check tests, `/prototype`, the landing page track list.

Two existing tests changed: `tests/db-migrations.test.ts` excludes the four enrollment triggers 0026 intentionally replaces or adds from its before/after trigger comparison (their behavior is covered by the new migration test); `tests/assessment.test.ts` and `tests/assessment-routes.test.ts` use the renamed `foundationGaps` field (same values).

## Tests

New files (43 tests): `curriculum-contract-portuguese`, `portuguese-migration`, `content-bundle-portuguese`, `portuguese-tracks`.

Observed red before the code: `curriculum-contract-portuguese` 7 of 7 failed (missing export and unsupported track); `content-bundle-portuguese` 5 of 12 failed (language not accepted, B1/B2 not accepted by the importer); `portuguese-tracks` could not load (`../src/lib/levels` missing). The migration tests were written after the migration and passed at first run; to show they discriminate, five mutations of `0026` were applied and reverted: `pt` removed from the skills CHECK (1 failed), explanation triggers removed (1 failed), skill identity triggers removed (1 failed), pt pair removed from the track trigger (2 failed), skill rows not copied (6 failed). Four mutations of the app code were applied and reverted: assessed levels ignoring `pt` (2 failed), no explanation check on enroll (1 failed), none on lesson-language change (1 failed), gaps filtered at A1 (1 failed). Each time the restored code passed.

After the change: the four new files 43 passed; the existing files touching the changed code passed (`db-migrations`, `db-review-invariants`, `db-constraints`, `db-guards`, `db-remote-migrate`, `db-cli`, `learner-journeys`, `assessment`, `assessment-routes`, `progress-routes`, `map-render`, `content-bundle`, `content-import`, `curriculum-contract`, `content-import-script`, `content-update`, `lesson-translations`). The full suite and the browser tests were not run here (too slow in this environment); CI runs them.

Also run and passing: `npm run check` (0 errors), `npm run lint`, `npm run format:check`, `npm run build`, `npm run validate:curriculum` (125 records, 164 edges, bundle 1.1.0), `npm run content:import` dry run (1.1.0, 124 skills, 124 lessons, 1,860 questions, nothing written), `git diff --check`.

Environment note: the container has Node 22.22 and npm 10; dependencies were installed with npm 11.9.0 through `npx` and `--ignore-scripts`. The repository pins Node 24.19, so CI is the authority for the pinned toolchain.

Review follow-up: 0026 now fails loudly when foreign keys are enforced (a plain batch would cascade study history away), and the upgrade test also seeds `prerequisites` and `card_drafts`.

## Pending

- Applying migration 0026 to any non-fixture database is an owner action (the rebuild keeps rows and aborts on a count change; take the usual backup first).
- Portuguese content (B1 LANGLO-262 to 269, B2 LANGLO-270 to 277), manifest bump to 1.2.0 and import dry run (LANGLO-278) are separate PRs.
- Landing page track list not changed.
