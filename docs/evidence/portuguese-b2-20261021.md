# Portuguese (Brazil) B2: curriculum content

Date: 2026-10-21. Board: LANGLO-270 to 277 under LANGLO-258, with the manifest bump and import dry run (LANGLO-278) folded in. Plan: project file `notes/pt-br-b1-b2/plan.md`. Owner decisions (2026-10-20 and 2026-10-21): Portuguese (Brazil) is a target language `pt` with B1 and B2 tracks only; a complete skill list (40 skills per level, 8 modules of 5); lessons explained in English; B1 and B2 ship as two separate PRs. B1 merged first (PR 136, with review follow-ups in PR 144).

## Scope

Content only: 40 B2 skills (`pt-b2-001` to `pt-b2-040`), 8 module files in `content/pt-b2/` (40 English lessons, 600 questions), the coverage rows, prerequisite nodes and edges, ID registry entries, and the manifest bump from 1.3.0 to 1.4.0 with `Portuguese B2` added to `included_tracks`. `tests/content-bundle.test.ts` expects version 1.4.0. Nothing else in the tests, the platform code, the existing tracks or the migrations changed.

Untouched: existing modules and skill IDs, all migrations and Drizzle metadata, learner data, scoring, FSRS, the landing page track list.

## Modules

1. Subjunctive and conditionals (`pt-b2-001` to `005`)
2. Compound and complex tenses (`006` to `010`)
3. Infinitive, gerund and participle (`011` to `015`)
4. Passive and impersonal forms (`016` to `020`)
5. Relative clauses and reported speech (`021` to `025`)
6. Clitics, government and crase (`026` to `030`)
7. Discourse connectors (`031` to `035`)
8. Register and form (`036` to `040`)

Each skill has 12 practice questions and 3 holdouts in all four formats. Holdout prompts name the grammar form needed, as a trailing parenthesis in Portuguese, following the convention of the B1 revisions. Where a prompt is tied to a construction or register (for example the simple pluperfect, mesóclise, formal clitic placement), only that construction is accepted and the near misses are the valid-looking alternatives.

## Review status

Every module carries `Reviewer decision: approved`. On 2026-10-20 the owner decided that model-authored Portuguese modules are marked approved without native or specialist review. That is a waiver by the owner, not a language-specialist review; the Portuguese was written and checked by the author only. The shared module tests check structure, answer matching, holdout separation and import, not language correctness. A native-speaker pass is still worth doing before learners rely on the course, especially for the formal-norm items (clitic placement, mesóclise, regência, crase), where Brazilian speech and the written norm differ.

## Sources

`COE-CV20` (existing row in `docs/evidence/T004.md`): CEFR Companion Volume level descriptors. B2 scope is Langlo instructional judgment from those descriptors, and Brazilian norms are used throughout, so every B2 row in the coverage CSV is `local-alignment`. No text, examples or exercises were copied from any source.

## Verification

- `npm run validate:curriculum`: PASS, 205 curriculum records, 257 edges, bundle 1.4.0.
- `npm run content:import` dry run on the repository bundle: package 1.4.0, 204 skills, 256 lessons, 3,840 questions, nothing written. No database was opened.
- Shared module tests over every `content/*/module-NN.json`, including the eight new files: constraints, holdout separation, answer and near-miss consistency, and import once then a second import adds nothing. Run: `tests/curriculum-modules.test.ts`, `tests/content-bundle.test.ts`, `tests/content-bundle-portuguese.test.ts`, `tests/curriculum-contract.test.ts`, `tests/curriculum-contract-portuguese.test.ts` (556 pass). While authoring, the holdout checks rejected several drafts (a holdout answer repeating a practice answer or text in the lesson); each was rewritten rather than the test relaxed.
- `npm run check`, `npm run lint`, `npm run format:check`, `git diff --check`.
- The full suite and browser tests were not run here (too slow in this environment); CI runs them.

Environment note: the container has Node 22 and npm 10; the repository pins Node 24 and npm 11, so CI is the authority for the pinned toolchain.

## Pending

- Importing 1.4.0 into any real database is an owner action (`npm run content:import -- --apply`, or `--impact` first); nothing here applies it.
- A native-speaker review of the B2 text.
