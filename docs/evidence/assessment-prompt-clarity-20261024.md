# Clearer assessment prompts

Date: 2026-10-24. Request (Andrew): some assessment questions are vague and do not explain what is needed. Audit them and reword only the unclear ones, very briefly.

## Scope

- Audit: all 612 holdout (assessment) questions, newest version of 204 skills, in German A1/A2, English A1/A2, French A1 and Portuguese B1/B2. 27 prompts were unclear and are reworded by a few words each; 585 are unchanged. The full before/after list is in the project notes (`notes/assessment-prompts/audit.md`).
- Only the `prompt` text changes. Answers, alternatives, near misses, ids, formats, holdout flags and scoring are identical.
- Each of the 27 skills gets its next lesson version (`@2`, or `@3` where an `@2` already existed), placed after the version it revises. Lesson text and translations are identical; every question declares `change: same` and `continues` its earlier question, so learner answers and grammar retention carry over (migration 0031).
- Manifest `1.4.0` to `1.5.0`. The importer refuses `1.4.1`: the English revisions repeat their Portuguese lesson translation, which counts as a minor change (`VERSION_BUMP`).

Untouched: migrations, schema, UI, grading, scoring, practice (non-holdout) questions, lesson text, every other prompt, the earlier versions.

## Test changes

- `tests/curriculum-modules.test.ts`: `clarifiedPrompts` pins the 27 new prompts word for word; the revision check accepts exactly those rewordings and nothing else; new tests that each pinned prompt exists and is carried by the next version, and that all 27 are found. The legacy-import test ignores wording revisions after a listed skill's correction.
- `tests/fr-a1-module-01.test.ts`: shape checks look at each skill's newest version; import expectations count every stored version.
- `tests/content-import-script.test.ts`: revised lessons 55 to 82, translated lessons 70 to 89, `lesson-translation-added` 25 to 44.
- `tests/content-bundle.test.ts`: expects 1.5.0.

## Verification (local, run files only)

- Red then green: changing one new prompt in `content/en-a1/module-02.json` fails 2 tests in `curriculum-modules.test.ts` (the revision check and the pinned-prompt test); restored, they pass.
- Run: `curriculum-modules` (565), `content-import-script` (23), `content-bundle`, `content-bundle-portuguese`, `curriculum-contract`, `fr-a1-module-01`: all pass. ESLint clean on the changed tests; Prettier clean on changed files.
- Local import: a fresh migrated database holding 1.4.0 took 1.5.0 (`imported 0 skills, 0 prerequisites, 27 lessons, 405 questions`).
- Not run: the full suite and e2e (left to CI). Applying to any database is an owner action (`npm run content:import`, then `--impact`).
