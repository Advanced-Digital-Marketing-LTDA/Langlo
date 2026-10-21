# Grammar form hints in assessment questions

Date: 2026-10-21. Request (Andrew): assessment questions did not say which grammatical form the answer needs (simple past or past participle, indicative or subjunctive, future), so some were vague. Start with English and Portuguese. Decision: option A, the form is added to the prompt text.

## Scope

- 87 holdout prompts (the questions the assessment uses) now end with the form in parentheses, for example `He ___ a new bike. (buy) (simple past)`. A prompt that ends with a colon takes the form before the colon. English: 25 skills in `en-a1` and `en-a2`. Portuguese B1: 27 skills, forms named in Portuguese (`pretérito perfeito`, `presente do subjuntivo`, ...).
- A hint is added only where the answer depends on a verb form (or a comparative, superlative, pronoun or infinitive form) and the prompt did not already name that form. Prompts that already say "in the past simple" or "subjunctive" are unchanged. Grammar-choice questions that are not about a form (articles, prepositions, vocabulary) are unchanged.
- Each affected skill gets a revision `@2` placed after its `@1` in the module file. Lesson text, answers, alternatives, near misses and practice-question wording are identical; every `@2` question declares `change: same` and `continues` its `@1` question. 52 revised lessons, 780 questions.
- `src/lib/server/content-modules.ts` passes `change` and `continues` to the importer; before, the module schema accepted them but they were dropped, so a database holding `@1` would have refused any `@2` with `MISSING_CHANGE`.
- Manifest `1.2.0` to `1.3.0`. The English revisions repeat their Portuguese lesson translation, which the importer counts as a minor change (`lesson-translation-added`), so a patch bump is refused (`VERSION_BUMP`).
- `docs/content-update.md`: one paragraph on how a revision is laid out in a module file.

Untouched: migrations, schema, UI components, grading, scoring, French and German content, the existing `@1` versions, learner data.

## Consequences to know before the owner applies it

- A new content version resets grammar retention schedules (migration 0030 triggers `grammar_retention_reset_new_content`): learners with a schedule on one of the 52 skills have it marked for reset. This follows from publishing any new version of a skill.
- `same` questions keep their lineage key, so earlier answers still count toward mastery. A learner who already saw a holdout is not offered its revised wording as a new item.
- The Portuguese B2 content PR planned as `1.3.0` needs `1.4.0` if this merges first.
- Hint wording is free text; there is no enforced vocabulary. Applying to any database is an owner action (`npm run content:import`, then `--impact`).

## Test changes

- `tests/curriculum-modules.test.ts`: new test that a revision changes nothing but the form in holdout prompts and declares itself for the importer; guards that counted one lesson per skill now look at each skill's newest version; the import-count expectation counts every stored version.
- `tests/fixtures/curriculum-module.ts`: the package builder passes `change` and `continues`.
- `tests/content-import-script.test.ts`: skill count is distinct skills; translated lessons 45 to 70; new tests that the loader passes the declarations through, and that a database holding the old package takes the revisions (52 versions, 780 `question-same`, 25 translations, `@1` rows unchanged, a patch bump refused).
- `tests/content-bundle.test.ts`: expects 1.3.0.

## Verification (local, run files only)

- Red then green: with `content-modules.ts` restored to before the change, 4 tests in `content-import-script.test.ts` fail; with it changed back they pass. Changing one `@2` answer fails the revision test for that module.
- Run: `tests/curriculum-modules.test.ts` (437), `tests/content-import-script.test.ts` (22), `tests/content-bundle.test.ts`, `tests/content-bundle-portuguese.test.ts`, `tests/curriculum-contract.test.ts`, `tests/fr-a1-module-01.test.ts`: all pass. `svelte-check`: 0 errors. Prettier and ESLint clean on changed files. `npm run content:import` dry run: package 1.3.0, 164 skills, 216 lessons, 3,240 questions.
- Not run: the full suite and e2e (left to CI).
