---
id: langlo-test-invariants
type: submodule-design
status: draft
title: Testing Invariants
parent: langlo-tests
---

# Foundation invariant register

## CFG-01: remote origins cannot masquerade as local fixtures

Non-production app origins are exactly localhost, 127.0.0.1 or [::1], with no credentials, query, fragment or non-root path. Production requires an explicit HTTPS origin. The independent oracle is the stated allowlist, not the parser. Property inputs use arbitrary alphabetic lookalike suffixes. Detectable fault: change exact localhost equality to prefix matching. Regression: localhost.example. This configuration-validation invariant does not itself call or authorize a live provider.

## LOG-01: diagnostics cannot include learner answers or arbitrary exception payloads

Diagnostics contain only the allowlisted operation, safe error category and server-generated UUID. The independent oracle is exact field equality. Property inputs use bounded arbitrary Unicode error messages. Detectable fault: include the Error.message in the projection. Regressions contain synthetic answer/token/body fields. Generated tests are stateless. Logging success proves only this projection; hosting log retention and access control remain operator gates.

## PBT-01: run controls are strict and reproducible

Default 100 runs; explicit positive safe integer run count; signed 32-bit seed; replay path requires seed and numeric colon-separated path. Invalid or empty supplied values fail. Ordinary npm test discovers properties; test:property is an additional filter. No zero-test passes are allowed. Failure replay and deliberate fault evidence are recorded separately from sample counts.

## DB-01: private relations and deduplication

Owner identity must match across enrollment, session, attempt, evaluation, card and delivery references. Versioned attempts retain their original content version on upgrades. SourceID identifies one owner/language/skill/canonical mistake delivery identity despite concurrent retries. Actual local libSQL constraints and migrations are the oracle. The owner property migrates one guarded disposable fixture per assertion, then rolls back every generated case and shrink to the same seeded session/attempt baseline. Accepted writes make missing rollback observable; independent constraint faults must still fail. Migration and reset behavior have separate actual-database tests. Details and DB-specific evidence are recorded by T009 and PR1-owner-property.md.

## Limits

This register covers only the listed invariants, not complete product acceptance. The application now contains authentication, assessment/practice, mastery and retention, optional AI grading/Library requests, native flashcards and learner analytics; the presence of code and fixture tests does not establish live-provider, production database, deployment or real-account acceptance. There is no Windows connector or two-way Anki sync in the current boundary. A local result does not establish hosted CI for a revision; observe that run against its exact commit separately.
