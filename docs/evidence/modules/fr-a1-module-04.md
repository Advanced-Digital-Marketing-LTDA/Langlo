# French A1 module 04: demonstratives, partitives, places and time

Date: 2026-10-16. Skills fr-a1-013, fr-a1-014, fr-a1-015, fr-a1-016. This module PR adds content and this evidence file; the existing shared tests cover it on disposable local fixture databases. No provider, production database, credentials or learner data were used.

## Scope

Four English lessons, one per skill, in prerequisite order: demonstratives (ce, cet, cette, ces), partitive articles, place prepositions, and clock times, days and months. Each lesson has an explanation, three examples, the references from the skill's catalog `source_ids`, and one content version with 12 practice items across all four exercise formats and 3 assessment holdouts in three formats (60 items). Authored for Langlo; guided practice may reuse lesson examples. The matching rule is the one declared in module 01.

The bundle, importer, schema and migrations are unchanged. The module is not imported anywhere; releasing it needs a new curriculum version, as for module 01. It is stacked on the branch of module 03 because it relies on the shared module test introduced with module 02.

## Review

Reviewer decision: approved.

On 2026-10-16 the owner told the project thread that Claude may write the curriculum itself with no human review of the content, and that the PR review bots are the check. This is a waiver of review by the owner, not a language-specialist review. The French was written and checked by the author only, so errors in answer keys are possible; any found later are corrected as a patch to this module.

## Local PR repair audit · 2026-10-16

See [the complete PR review ledger](../open-pr-review-triage.md) for the exact
PR head, individual findings, observed red/green output and required validation.
This records a current audit of the combined local stack, not the original
module-authoring history. The original pre-change red output was not available
and is not reconstructed. A disposable mutation of this module's first practice
item to a holdout was observed to fail the count assertion (`expected 11 to be 12`);
the file was restored afterwards. The final shared-suite run covers this module.

The answer matcher tested here is local to the fixtures; these checks do not
prove runtime grading. Only typographic apostrophe variants are equivalent;
inserted or missing apostrophes remain mismatches. Multiple-choice options may
reuse words taught in the lesson, as T101 already permits.

Pending acceptance: independent verification of the earlier owner waiver and
content approval provenance, specialist language acceptance, and GitHub checks
on any future published fix. The recorded approval status is preserved; this
audit does not create a new review decision. The module must remain unreleased
until LANGLO-125 provides runtime separation of assessment holdouts from practice.
A release also needs a new curriculum version. No real import, provider, Windows
Anki, CI or release success is inferred from local fixture checks.
