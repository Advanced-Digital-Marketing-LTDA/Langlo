# LANGLO-9 implementation plan

Date: 2026-10-17. Branch: `codex/langlo-9-grammar-mastery`.
Baseline: `764f3059a6c5f06a719e2a865acf2456d3c6dbff`.

Execution update: the owner subsequently authorized LANGLO-44–47 and a push
after completion. T016 was confirmed complete and its merged code integrated at
`91a9e61`. Task-specific plans were written before each implementation in
`T017.md` through `T020.md` beside this file. The initial research below records
the earlier baseline; implementation and current evidence are in those task files.

## Goal and authority

Implement [LANGLO-9](https://plan.advanceddigitalmarketingltda.com/LANGLO-9):
explain grammar mastery and recommendations from qualifying grammar evidence,
show accessible progress and manual topic navigation, and collect bounded,
owner-visible content reports without modifying published content.

The owner authorized planning and beginning work without another start approval.
The initial scope was local preparation, with T017 preceding T018, followed by
T019 and T020. The later explicit authorization added T017 implementation and
publication after completion; T016 implementation itself remains outside scope.

## Dependency audit and first work

- [x] Verify clean branch and baseline after pulling main.
- [x] Read LANGLO-9 and LANGLO-45/46/47 against the current tracker.
- [x] Verify the T017 dependency against the tracker and source.
- [x] Inspect existing study, evaluation, content, ownership and UI contracts.
- [x] Validate the current foundation and record actual results in
      `docs/evidence/LANGLO-9-preparation.md`.
- [x] After T017 passes local focused checks, integrate its code into the branch, re-read
      scoped guidance, and reconcile the evidence contract before T018 code.

At inspection, LANGLO-44 / T017 is **In Progress** (column 68), not Done.
It has no linked development artifact or issue comments. LANGLO-43 / T016 is
also In Progress according to T017's dependency link. The branch has prepared
evaluation through T015, but no assessment planner, completed assessment results
route, T016 evidence or T017 evidence. These are concrete dependency gaps;
passing existing tests cannot substitute for T017 acceptance.

## Current implementation and boundaries

- `src/lib/server/study.ts` records owner-scoped, idempotent attempts and prepared
  evaluations in one write transaction. Its `getAttempt`/`listEvaluations`
  readers currently expose evaluations without assessment completion filtering;
  reconcile their accepted T017 behavior before consuming them for progress.
- `src/lib/server/lesson-practice.ts` submits independent answers; it has no
  completed feedback/retry or placement contract. T017 must establish when an
  answer has been revealed and a subsequent response becomes assisted.
- `src/lib/server/evaluation/prepared.ts` returns `uncertain` for unmatched typed
  answers. Never infer that pending/uncertain outcomes are correct or incorrect.
- `src/lib/server/db/schema.ts` already has owner-bound `skill_evidence`, with
  uniqueness on owner/attempt/scoring version, and prerequisite edges. Reuse it;
  first inspect T017's resulting migrations. There is no content-report table.
- `src/lib/server/study-content.ts` excludes practice holdouts, pins session
  versions, checks quarantine and derives access from enrollment and session.
  Preserve those rules in every new reader and write path.
- `src/lib/server/content-import.ts` and its fixtures enforce immutable versions
  and quarantine. A report must never call an importer or edit content directly.
- `/app` currently provides account information and sign-out. The actual lesson
  route is `/app/learn/[language]/lesson/[skill]`. Keep existing links working.
- `docs/design.md` and `src/lib/prototype/` contain existing layout and accessible
  list patterns. Prototype mastery labels are synthetic; do not reuse their
  hard-coded values or treat them as scoring policy.

No changes to authentication, provider configuration, flashcard scheduling,
curriculum JSON/CSV, existing prototype screens, dependency pins or CI policy
are planned. Any schema addition is additive and tested on disposable local
fixtures only. A final branch push is now authorized. No real accounts, provider
calls, production migration, PR, deployment or tracker mutation is part of this work.

## Approach and policy decisions

Use server-derived progress over existing attempts/evaluations and the existing
evidence table, rather than a new scoring database or client-computed totals.
This preserves ownership and traceability and avoids a second source of truth.
Do not use FSRS state, flashcard ratings or prototype data as grammar evidence.

The policy document must version the qualifying-evidence rules, status
thresholds and explanation text. Thresholds are a product heuristic, not a
validated CEFR measure. Current source explicitly leaves them undecided.
Choose and document a conservative initial rule after T017's accepted evidence
and assessment sampling contract are available; do not silently inherit the
prototype's labels or invent calibration results during preparation.

## Implementation sequence

### 1. T018 / LANGLO-45: mastery and recommendations

Likely changes: `src/lib/server/mastery.ts`,
`src/lib/server/recommendations.ts`, `docs/scoring-policy.md`,
focused `tests/mastery.test.ts` and `tests/recommendations.test.ts`, a property
test for evidence duplication/order invariance, and `docs/evidence/T018.md`.
Use the accepted T017 evaluation and session-completion interfaces.

1. Write behavior tests first, observe red, then implement the smallest policy
   and owner-scoped service. Keep thresholds and scoring version together.
2. Count qualifying evidence once. A duplicate submission, additional evaluation
   of one attempt, assisted retry, or repeated presentation of an already
   evidenced item must not inflate independent evidence. Specify item identity
   and version handling explicitly in the policy and regression fixtures.
3. Exclude uncertain/pending evaluations from independent contribution. Include
   grammar practice and completed assessments only when T017's contract allows;
   do not reveal assessment performance before completion through mastery.
4. Resolve evaluation selection deterministically using its recorded evaluator
   and rubric versions; conflicting/unrecognized records fail closed. Preserve
   historical attempts and their original content versions. Quarantine must not
   manufacture new qualifying evidence.
5. Return `unknown`, `weak`, `practising` or `secure`, with qualifying counts,
   policy version and a plain-language reason. Test every threshold boundary.
6. Recommend weak topics and helpful prerequisites deterministically, using
   stable skill IDs to break ties. Treat prerequisites as guidance and preserve
   manual access to all available lessons in enrolled tracks.
7. Verify owner isolation, replay/concurrent-write behavior, evidence exclusion,
   empty histories, content version transitions and unchanged FSRS behavior.

### 2. T019 / LANGLO-46: dashboard, map and progress

Likely changes: the existing `/app` page/load, new `/app/map` and `/app/progress`
pages/loads, a small shared status component if those views need it, focused
route tests, built-server browser coverage, and `docs/evidence/T019.md`.

1. Write failing authenticated route tests for empty and populated progress,
   enrolled-track access, foreign-owner isolation and non-blocking prerequisites.
2. Read learner identity from the verified session and call the T018 services.
   Follow existing server-only database acquisition and error handling.
3. Extend existing visual patterns with status text plus color/icon, policy
   explanation, A1/A2 prerequisite guidance, recommendations and manual links
   to the actual lesson route. Keep sign-out and account information usable.
4. Use a keyboard-accessible semantic list on desktop and mobile; an interactive
   graph is unnecessary. Separate grammar evidence from flashcard due counts
   and session completion. Clearly describe unavailable/quarantined content.
5. Exercise real rendered pages on both Playwright targets, including keyboard
   navigation, empty/error states and manual navigation to an unrecommended skill.

### 3. T020 / LANGLO-47: reports and corrections

Likely changes: a server-only report service, additive schema/migration and
Drizzle metadata, lesson report action/form, owner-visible report list,
`tests/fixtures/owner-scope.ts` private-table coverage, service/route/migration
and browser tests, `docs/content-maintenance.md`, and `docs/evidence/T020.md`.

1. Write failing tests for bounded comments, exact item/version association,
   owner isolation, invalid targets, replay/duplicate taps and zero content edits.
2. Add the minimum owner-scoped report storage. Derive owner identity from the
   session and verify the referenced item/version was accessible to that owner;
   never trust a posted owner ID. Follow existing bounded-text validation.
3. Add the report action and receipt/list UI with normal escaped text rendering.
   Reports describe a concern and cannot change an answer, score or live content.
4. Document maintainer correction through a reviewed new content version and
   existing importer validation, preserving previous attempts and rubrics.
5. Reuse and test quarantine at both serving and attempt-scoring boundaries;
   include a question already loaded before quarantine. Test new-version import
   and old-history preservation using synthetic disposable databases.
6. Extend owner-scope snapshots to the new table. If any new validator script
   is needed, list its test twin explicitly in `.github/CODEOWNERS`.

## Validation and acceptance

For each behavior change, record actual red then green output in its task
evidence. Reuse the existing guarded database fixtures and existing test stack;
do not add test frameworks or call providers. Run serially with Node 24.19.0
and npm 11.9.0:

1. `npm ci` (preparation uses `--ignore-scripts`, followed by explicit checks).
2. `npm run check`
3. `npm run lint`
4. `npm run format:check`
5. `npm test`
6. `npm run test:property`
7. `npm run build`
8. `npm run test:e2e`

Record any baseline failure separately from changes. Before any later PR, resolve
or explicitly answer high-severity review findings. No PR is authorized here. Local green
checks do not establish T017 acceptance, live provider behavior, Windows Anki,
hosted CI, deployment or release success.
