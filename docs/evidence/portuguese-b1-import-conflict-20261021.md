# Portuguese B1 import conflict — 2026-10-21

**Scope:** three published B1 skills (`pt-b1-024`, `pt-b1-033`, `pt-b1-039`) whose `@1` questions were edited in place after their content was imported. No B2 file, other B1 skill or code changes.

## Problem

`npm run content:import -- --apply` against the production database stopped with `CONTENT_CONFLICT: version pt-b1-024@1`. The B1 review follow-ups (PR 144) changed the accepted alternatives of four questions across the three skills in place (`pt-b1-024@1:q07` and `q09`, `pt-b1-033@1:q08`, `pt-b1-039@1:q03`). Imported versions are immutable, so the importer refuses a package whose `@1` differs from the stored one.

## Change

- `@1` of the three skills is back to its 1.3.0 content, which is identical in 1.2.0 and 1.3.0 for these skills (checked with the importer's version fingerprint).
- Each skill gains an `@2` with the corrected alternatives, every question `same` and continuing its `@1` question (`docs/content-update.md`). The corrected lists: `pt-b1-024@2:q07` (an accepted alternative removed), `q09`, `pt-b1-033@2:q08`, `pt-b1-039@2:q03`. Lesson text is unchanged.
- The curriculum version stays 1.4.0: nothing past 1.3.0 had been imported, the new B2 skills make it a minor bump, and `same` questions fit it.
- `tests/curriculum-modules.test.ts` pins the corrected list of each of the four questions (`correctedAlternatives`); a revision must either add a grammar-form hint to a holdout prompt or carry exactly the listed corrections of its skill. `tests/content-import-script.test.ts` counts 55 revised lessons and has a regression test: a package whose `pt-b1-024@1` was edited in place is refused with `CONTENT_CONFLICT version pt-b1-024@1` and writes nothing, and the restored package then imports over the same database.

## Verification

Replay on scratch libSQL databases with the real importer. A database is migrated with drizzle's migrator over `drizzle/`, then the old content is imported with `DATABASE_URL=file:<db> npx tsx scripts/content-import.ts --apply --confirm-host local` from a copy of the repository whose `content/` and `docs/curriculum-coverage.csv` are taken from the old commit (without `content/pt-b2`), and the new content is imported with the same command from this branch. The old content is the merge of PR 136 (1.2.0, `11cae61`) and of PR 140 (1.3.0, `6a926b8`). The three skills' `@1` question fingerprints (the importer's own `versionFingerprint`) are equal in both and differ on main.

| Database holds | main before this change                 | after this change                                                                   |
| -------------- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| 1.2.0          | `CONTENT_CONFLICT: version pt-b1-024@1` | imports 40 skills, 95 lessons, 1425 questions; a second run imports 0 of everything |
| 1.3.0          | `CONTENT_CONFLICT: version pt-b1-024@1` | imports 40 skills, 43 lessons, 645 questions; a second run imports 0 of everything  |

The dry run on this branch reads `package 1.4.0: 204 skills, 259 lessons, 3885 questions`.

Tests run (the full suite is left to CI): `npx vitest run tests/curriculum-modules.test.ts tests/content-import-script.test.ts` 540 passed; before the test change the same files had 5 failures (the three revision guards and the two revision counts), which is what this change updates. Also passing earlier on the content change: `content-bundle`, `content-bundle-portuguese`, `portuguese-tracks`. `npm run check` 0 errors and 0 warnings, `npm run lint` and `npm run format:check` clean. `test:property` and `build` run in CI. The importer regression test documents existing refusal behavior, so it is green on main too.
