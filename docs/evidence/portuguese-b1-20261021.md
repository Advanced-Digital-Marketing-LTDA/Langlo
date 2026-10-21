# Portuguese (Brazil) B1: curriculum content

Date: 2026-10-21. Board: LANGLO-262 to 269 under LANGLO-258; LANGLO-278 (manifest bump and import dry run) is folded into this PR for B1 and into the B2 PR for B2. Plan: project file `notes/pt-br-b1-b2/plan.md`. Owner decisions (2026-10-20 and 2026-10-21): Portuguese (Brazil) is a target language `pt` with B1 and B2 tracks only; a complete skill list (40 skills per level, 8 modules of 5); lessons explained in English; B1 and B2 ship as two separate PRs.

## Scope

Content only: 40 B1 skills (`pt-b1-001` to `pt-b1-040`), 8 module files in `content/pt-b1/` (40 English lessons, 600 questions), the coverage rows, prerequisite nodes and edges, ID registry entries, and the manifest bump from 1.1.0 to 1.2.0 with `Portuguese B1` added to `included_tracks`. Platform support (validator, importer, migration 0026, app code) was merged earlier in the Portuguese platform PR.

Two test helpers changed so the shared module tests can run on Portuguese: `tests/fixtures/curriculum-module.ts` lets an example carry a `pt` sentence, and `tests/curriculum-modules.test.ts` reads that sentence when checking that practised text appears in the lesson (English tracks still read `en`). `tests/content-bundle.test.ts` expects version 1.2.0. `tests/curriculum-contract-portuguese.test.ts` appended synthetic `pt-b1-001` rows to the checked-in catalog, which now holds the real ones, so it builds its fixtures from the catalog without the Portuguese rows (same assertions). Nothing else in the tests, the existing tracks or the migrations changed.

Untouched: existing modules and skill IDs, all migrations and Drizzle metadata, learner data, scoring, FSRS, the landing page track list.

## Review status

Every module carries `Reviewer decision: approved`. On 2026-10-20 the owner decided that model-authored Portuguese modules are marked approved without native or specialist review. That is a waiver by the owner, not a language-specialist review; the Portuguese was written and checked by the author only. The shared module tests check structure, answer matching, holdout separation and import, not language correctness. A native-speaker pass is still worth doing before learners rely on the course.

## Sources

Registered in `docs/evidence/T004.md`:

- `CAMOES-REF-PLE` (new row): Camões Instituto da Cooperação e da Língua, Referencial Camões PLE, B1 grammar inventory (v1.1, 17 Nov 2017). It describes European Portuguese and is used only as a topic list. Brazilian norms (você and a gente, estar plus gerúndio, post-1990 spelling, proclisis in speech) are Langlo judgment, so every B1 row in the coverage CSV is `local-alignment`. The licence cell says open reuse is not established, bibliography only.
- `COE-CV20` (existing row): CEFR Companion Volume level descriptors.

No text, examples or exercises were copied from either source.

## Skill order differs from the plan

The plan's B1 numbering put some dependants before their prerequisites. The skills were reordered so every prerequisite precedes what needs it, for example past participles (`pt-b1-004`) and the perfeito composto sit before the compound tenses that use them. The skill list itself is the plan's; only the numbering moved. IDs are new, so nothing existing is renumbered.

## Verification

- `npm run validate:curriculum`: PASS, 165 records, 198 edges, bundle 1.2.0.
- `npm run content:import` dry run on the repository bundle: package 1.2.0, 164 skills, 164 lessons, 2,460 questions, nothing written. No database was opened.
- Shared module tests over every `content/*/module-NN.json`, including the eight new files: constraints, holdout separation, answer and near-miss consistency, and import once then a second import adds nothing. Run: `tests/curriculum-modules.test.ts`, `tests/content-bundle.test.ts`, `tests/content-bundle-portuguese.test.ts`, `tests/curriculum-contract.test.ts` (429 passed). While authoring, the holdout and alternative checks rejected several drafts; each was rewritten rather than the test relaxed.
- `npm run check` (0 errors), `npm run lint`, `npm run format:check`, `git diff --check`.
- The full suite and browser tests were not run here (too slow in this environment); CI runs them.

Environment note: the container has Node 22.22 and npm 10; dependencies were installed with npm 11.9.0 through `npx` and `--ignore-scripts`. The repository pins Node 24.19, so CI is the authority for the pinned toolchain.

## Pending

- Importing 1.2.0 into any real database is an owner action (`npm run content:import -- --apply`, or `--impact` first); nothing here applies it.
- A native-speaker review of the B1 text.
- B2 (LANGLO-270 to 277) follows in its own PR, manifest 1.3.0.
