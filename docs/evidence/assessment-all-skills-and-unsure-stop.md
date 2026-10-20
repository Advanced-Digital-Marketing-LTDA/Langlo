# Assessment coverage and early-stop evidence

**Date:** 2026-10-20
**Scope:** local implementation and synthetic fixture validation only.

## Behavior

- New assessments contain one current, unseen holdout question per non-retired
  skill in the selected language, across levels. Start fails before saving a
  session when any such skill has no eligible holdout.
- New plans use `assessment-2`; existing `assessment-1` plans remain readable.
- Five explicit `Not sure` choices in one assessment finalize it. Replay does
  not add another choice, and evaluator uncertainty does not count.
- Results list submitted responses, give the number of unreached questions, and
  do not include unasked answers. Certain submitted answers still qualify under
  `grammar-1`; `Not sure`, unresolved, and unasked items do not.

## Test-first record

**Red before implementation:**

```text
npm test -- --run tests/assessment.test.ts tests/assessment-routes.test.ts
Test Files  2 failed (2)
Tests       13 failed | 24 passed (37)
```

The failures included missing-holdout refusal, full all-skill plans, the new
plan version, five-choice finalization, and partial-result contents.

**Green after implementation:**

```text
npm test -- --run tests/assessment.test.ts tests/assessment-routes.test.ts
Test Files  2 passed (2)
Tests       37 passed (37)
```

## Required local validation

Runtime: Node `24.19.0`; commands were run through npm `11.9.0`. `npm ci
--ignore-scripts` completed using a disposable local dependency install.

| Check                   | Result                              |
| ----------------------- | ----------------------------------- |
| `npm run check`         | Passed, 0 errors and 0 warnings     |
| `npm run lint`          | Passed                              |
| `npm run format:check`  | Passed                              |
| `npm test`              | Passed, 88 files and 1,399 tests    |
| `npm run test:property` | Passed, 5 files and 7 properties    |
| `npm run build`         | Passed with the Node adapter        |
| `npm run test:e2e`      | Passed, 104 tests across 2 projects |

## Acceptance boundary

Browser E2E includes a synthetic holdout for each of its three active skills,
checks the assessment coverage copy, and exercises all three questions. The
assessment suite also covers early finalization after five explicit `Not sure`
choices. This record does not claim CI, publication, production database,
provider, or deployment verification.

## PR review follow-up

CodeScene's first review identified complexity in assessment plan handling and
a long browser test. The follow-up refactor moved existing validation and
question selection into focused functions and shortened the browser helper.
The behavior and query remain the same. Local `check`, lint, format, 1,399 unit
tests, 7 properties, build, and 104 browser tests passed after the refactor.
Hosted CodeScene and other PR checks remain separate acceptance gates.

The PR review also caught a level-specific heading on the language-wide start
page. A desktop browser assertion for “Assess FR grammar” failed against the
old heading, then passed after the copy changed. The check used the built Node
server and synthetic fixtures.
