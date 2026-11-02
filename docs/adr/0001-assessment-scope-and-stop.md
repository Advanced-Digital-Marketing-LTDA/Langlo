---
id: langlo-assessment-scope-stop
type: submodule-design
status: active
title: Assessment Coverage and Early Finalization
parent: langlo-server
references: [langlo-grammar-evidence, langlo-content-versioning]
tags: [assessment]
---

# ADR 0001: Assessment coverage and early finalization

- Status: accepted
- Date: 2026-10-20

## Context

Assessments previously selected a level-dependent sample of at most twelve
holdout questions. Results were unavailable until every planned question had an
attempt. This left active skills outside the assessment and gave learners who
were unsure on many questions no way to finish early.

## Decision

- A new assessment plan contains one current, unseen holdout question for each
  non-retired skill in the selected language, across all levels. Creation fails
  before saving a session if any active skill lacks an eligible holdout.
- New plans use `assessment-2`. Saved `assessment-1` plans remain readable and
  keep their original contents.
- Either the fifth confirmed incorrect answer or the fifth explicit `Not sure`
  choice in one assessment completes it when that answer or verdict is saved.
  Each threshold is counted separately; responses need not be consecutive.
  Incorrect answers use the same recognized prepared/fallback verdicts as the
  results page, with fallback taking precedence. Evaluator uncertainty does not
  count, and replayed submissions do not increase either count.
- Results for an early-completed assessment include submitted responses only
  and a separate count of unreached questions. Unreached questions remain
  unscored and their answers are not disclosed.
- The existing grammar-evidence rules remain unchanged: only submitted
  independent responses with recognized, certain evaluations qualify. The
  completion trigger changes when evidence is synchronized, not which responses
  qualify.

## Consequences

Every active skill must have fresh assessment content before a new assessment
can start. Once a learner has seen every eligible holdout for any active skill,
another assessment waits for new or meaningfully changed holdout content.
Partial completion still records eligible evidence already submitted; explicit
`Not sure`, unresolved answers, and unreached questions do not contribute.
