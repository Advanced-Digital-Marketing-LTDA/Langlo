# Clearer assessment prompts

Date: 2026-10-24. Request (Andrew): some assessment questions are vague and do not explain what is needed. Audit them and reword only the unclear ones, very briefly.

## Scope

- Audit: all 612 holdout (assessment) questions, newest version of 204 skills, in German A1/A2, English A1/A2, French A1 and Portuguese B1/B2. 27 prompts were unclear and are reworded by a few words each; 585 are unchanged. The full before/after list is in the project notes (`notes/assessment-prompts/audit.md`).
- Only the `prompt` text changes. Answers, alternatives, near misses, ids, formats, holdout flags and scoring are identical.
- Each of the 27 skills gets its next lesson version (`@2`, or `@3` where an `@2` already existed), placed after the version it revises. Lesson text and translations are identical; every question declares `change: same` and `continues` its earlier question, so learner answers and grammar retention carry over (migration 0031).
- Manifest `1.4.0` to `1.5.0`. The importer refuses `1.4.1`: the English revisions repeat their Portuguese lesson translation, which counts as a minor change (`VERSION_BUMP`).

Untouched: migrations, schema, UI, grading, scoring, practice (non-holdout) questions, lesson text, every other prompt, the earlier versions.

## Test changes

- `tests/fixtures/clarified-prompts.json` (read by `clarified-prompts.ts`): the 27 new prompts, pinned word for word, keyed by the earlier question's id.
- `tests/curriculum-modules.test.ts`: the revision check accepts exactly those rewordings and nothing else; new tests that each pinned prompt is carried by the next version of its skill and that all 27 exist. The legacy-import test accounts for a later revision of a listed skill.
- `tests/fr-a1-module-01.test.ts`: the existing tests still check the four first versions with their original literals (the file loads only first versions); a new test checks the `fr-a1-001@2` revision on its own.
- `tests/content-import-script.test.ts`: revision totals are the earlier 55, 70, 25 and 55 x 15 plus the pinned list (27 revisions, 19 of them English with a translation).
- `tests/content-bundle.test.ts`: the expected curriculum version is read from `content/curriculum-manifest.json` (now 1.5.0).

## Verification (local, run files only)

- Red then green: changing one new prompt in `content/en-a1/module-02.json` fails 2 tests in `curriculum-modules.test.ts` (the revision check and the pinned-prompt test); restored, they pass.
- Run: `curriculum-modules` (566), `content-import-script` (23), `content-bundle`, `content-bundle-portuguese`, `curriculum-contract`, `fr-a1-module-01`: all pass. ESLint clean on the changed tests; Prettier clean on changed files.
- Local import: a fresh migrated database holding 1.4.0 took 1.5.0 (`imported 0 skills, 0 prerequisites, 27 lessons, 405 questions`).
- Not run: the full suite and e2e (left to CI). Applying to any database is an owner action (`npm run content:import`, then `--impact`).
