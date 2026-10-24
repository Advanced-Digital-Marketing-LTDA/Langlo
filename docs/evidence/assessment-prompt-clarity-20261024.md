# Clearer assessment prompts

Date: 2026-10-24. Request (Andrew): some assessment questions are vague and do not explain what is needed. Audit them and reword only the unclear ones, very briefly.

## Scope

- Audit: all 612 holdout (assessment) questions, newest version of 204 skills, in German A1/A2, English A1/A2, French A1 and Portuguese B1/B2. 27 prompts were unclear and are reworded by a few words each; 585 are unchanged. The full before/after list is below.
- Only the `prompt` text changes. Answers, alternatives, near misses, formats, holdout flags and scoring are identical. Question ids are version-scoped, so each revised question gets the next version's id (for example `en-a1-008@2:h02` becomes `en-a1-008@3:h02`); the question number and the lineage (via `continues`) are kept.
- Each of the 27 skills gets its next lesson version (`@2`, or `@3` where an `@2` already existed), placed after the version it revises. Lesson text and translations are identical; every question declares `change: same` and `continues` its earlier question, so learner answers and grammar retention carry over (migration 0031).
- Manifest `1.4.0` to `1.5.0`. The importer refuses `1.4.1`: the English revisions repeat their Portuguese lesson translation, which counts as a minor change (`VERSION_BUMP`).

## Before and after

| #   | Question id     | Current prompt                                                              | New prompt                                                                                     |
| --- | --------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | de-a1-011@1:h01 | Which sentence introduces a new thing?                                      | Which sentence mentions a house for the first time?                                            |
| 2   | en-a1-008@2:h02 | Write the negative sentence: we / at school                                 | Write the negative sentence: we / be / at school                                               |
| 3   | en-a1-010@1:h02 | Write the sentence: I / see / egg                                           | Write the sentence (add a/an): I / see / egg                                                   |
| 4   | en-a1-012@1:h01 | Which sentence is a correct positive statement?                             | Which positive sentence uses some/any correctly?                                               |
| 5   | en-a1-014@2:h03 | Write the sentence: this film / be / interesting / than / that film         | Write the comparative sentence: this film / be / interesting / than / that film                |
| 6   | en-a1-017@2:h03 | Write the instruction: negative: run / in the school                        | Write a negative instruction: run / in the school                                              |
| 7   | en-a1-018@1:h01 | Which sentence adds a second sport to the first?                            | Which sentence joins two sports with 'and'?                                                    |
| 8   | en-a1-021@1:h02 | Write the sentence with there is or there are: ask: any apples / in the bag | Write the question with there is/are: any apples / in the bag                                  |
| 9   | en-a1-024@1:h02 | Write the sentence (use be): ask: he / at work                              | Write the question (use be): he / at work                                                      |
| 10  | en-a2-001@2:h02 | Write the sentence in the past simple: ask: they / visit / London           | Write the past simple question: they / visit / London                                          |
| 11  | en-a2-005@2:h03 | Write the sentence with will: ask: you / open / the window                  | Write the question with will: you / open / the window                                          |
| 12  | en-a2-007@1:h03 | Write the sentence with could: negative: we / hear / the music              | Write the negative sentence with could: we / hear / the music                                  |
| 13  | en-a2-009@1:h03 | Write the advice with should or shouldn't: negative: we / stay / up late    | Write negative advice with should: we / stay / up late                                         |
| 14  | en-a2-010@2:h01 | Which sentence is correct?                                                  | Which sentence uses 'would like' correctly?                                                    |
| 15  | en-a2-013@1:h01 | Which sentence describes a thing?                                           | Which sentence uses the right relative word for a thing?                                       |
| 16  | en-a2-014@1:h02 | Brush your teeth ___ you go to bed.                                         | Brush your teeth ___ you go to bed. (earlier than)                                             |
| 17  | en-a2-018@1:h01 | Which sentence about money is correct?                                      | Which sentence uses the right quantifier for 'money'?                                          |
| 18  | en-a2-019@1:h03 | Add the question tag or short answer: they / live / here (tag)              | Write a statement with a question tag: they / live / here                                      |
| 19  | en-a2-020@1:h01 | Which sentence about meat is correct?                                       | Which sentence puts 'never' in the right place?                                                |
| 20  | en-a2-023@2:h01 | Which sentence about stopping is correct?                                   | Which sentence uses 'stop' with the right verb form?                                           |
| 21  | fr-a1-001@1:h01 | La boulangerie ___ tôt. (fermer / ferme)                                    | La boulangerie ___ tôt. (fermer)                                                               |
| 22  | fr-a1-023@2:h01 | Which pronoun goes with 'vous'?                                             | Which reflexive pronoun goes with 'vous'?                                                      |
| 23  | fr-a1-027@1:h02 | Elle est ___. (acteur)                                                      | Elle est ___. (acteur, feminine)                                                               |
| 24  | pt-b1-027@2:h01 | Choose the sentence (possession):                                           | Choose the sentence: 'He has two small children'.                                              |
| 25  | pt-b2-026@1:h02 | ___ a lição. (explicar + lhe, início da frase) (colocação do pronome)       | ___ a lição. (explicar + lhe, ele, pretérito perfeito, início da frase) (colocação do pronome) |
| 26  | pt-b2-028@1:h02 | Para ler o jornal: ___ (ler + o) (pronomes combinados)                      | Write 'to read it' (ler + o): ___ (pronomes combinados)                                        |
| 27  | pt-b2-040@1:h02 | Reform spelling: eles ___ (crer, presente) (ortografia atual)               | Eles ___ . (crer, presente, 1990 spelling) (ortografia atual)                                  |

Untouched: migrations, schema, UI, grading, scoring, practice (non-holdout) questions, lesson text, every other prompt, the earlier versions.

## Test changes

- `tests/fixtures/clarified-prompts.json` (read by `clarified-prompts.ts`): the 27 new prompts, pinned word for word, keyed by the earlier question's id.
- `tests/curriculum-modules.test.ts`: the revision check accepts exactly those rewordings and nothing else; new tests that each pinned prompt is carried by the next version of its skill and that all 27 exist. The legacy-import test accounts for a later revision of a listed skill.
- `tests/fr-a1-module-01.test.ts`: the existing tests still check the four first versions with their original literals (the file loads only first versions); a new test checks the `fr-a1-001@2` revision on its own.
- `tests/content-import-script.test.ts`: the existing totals keep their original literals (55, 70, 25 and 55 x 15) by checking the earlier content only; a new test imports the 27 rewordings on top of it (27 versions, 405 questions, 19 translations, curriculum 1.5.0).
- `tests/content-bundle.test.ts`: the expected curriculum version is read from `content/curriculum-manifest.json` (now 1.5.0).

## Verification (local, run files only)

- Red then green: changing one new prompt in `content/en-a1/module-02.json` fails 2 tests in `curriculum-modules.test.ts` (the revision check and the pinned-prompt test); restored, they pass.
- Run: `curriculum-modules` (566), `content-import-script` (24), `content-bundle`, `content-bundle-portuguese`, `curriculum-contract`, `fr-a1-module-01`: all pass. ESLint clean on the changed tests; Prettier clean on changed files.
- Local import: a fresh migrated database holding 1.4.0 took 1.5.0 (`imported 0 skills, 0 prerequisites, 27 lessons, 405 questions`).
- Required checks not run locally (`npm ci`, `npm run check`, `npm run lint`, `npm run format:check`, `npm test`, `npm run test:property`, `npm run build`, `npm run test:e2e`): the container has npm 10 and Node below the pinned 24.19.0 and 11.9.0, so `npm ci` fails and dependencies were installed with `--legacy-peer-deps --ignore-scripts`; the owner's rule is never to run the full suite in the cloud (far too slow). ESLint and Prettier ran on the changed files. CI runs the full set on this pull request.
- Not run: the full suite and e2e (left to CI). Applying to any database is an owner action (`npm run content:import`, then `--impact`).
