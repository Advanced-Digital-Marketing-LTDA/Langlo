# Portuguese B1 import conflict — 2026-10-21

**Scope:** three published B1 skills (`pt-b1-024`, `pt-b1-033`, `pt-b1-039`) whose `@1` questions were edited in place after their content was imported. No B2 file, other B1 skill or code changes.

## Problem

`npm run content:import -- --apply` against the production database stopped with `CONTENT_CONFLICT: version pt-b1-024@1`. The B1 review follow-ups (PR 144) changed the accepted alternatives of one question in each of the three skills in place. Imported versions are immutable, so the importer refuses a package whose `@1` differs from the stored one.

## Change

- `@1` of the three skills is back to its 1.3.0 content, which is identical in 1.2.0 and 1.3.0 for these skills (checked with the importer's version fingerprint).
- Each skill gains an `@2` with the corrected alternatives, every question `same` and continuing its `@1` question (`docs/content-update.md`). The corrected lists: `pt-b1-024@2:q07` (an accepted alternative removed), `q09`, `pt-b1-033@2:q08`, `pt-b1-039@2:q03`. Lesson text is unchanged.
- The curriculum version stays 1.4.0: nothing past 1.3.0 had been imported, the new B2 skills make it a minor bump, and `same` questions fit it.
- `tests/curriculum-modules.test.ts` lists these four corrections (`correctedAlternatives`) and requires the revised list to differ; `tests/content-import-script.test.ts` counts 55 revised lessons.

## Verification

Replay on scratch libSQL databases with the real importer (all migrations applied):

| Database holds       | main before this change        | after this change                                                           |
| -------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| 1.2.0 (PR 136 merge) | `CONTENT_CONFLICT pt-b1-024@1` | imports 40 skills, 95 lessons, 1425 questions; a second run imports nothing |
| 1.3.0 (PR 140 merge) | `CONTENT_CONFLICT pt-b1-024@1` | imports 40 skills, 43 lessons, 645 questions; a second run imports nothing  |

Tests run: `curriculum-modules`, `content-bundle`, `content-bundle-portuguese`, `content-import-script`, `portuguese-tracks`. The full suite is left to CI.
