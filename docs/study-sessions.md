---
id: langlo-study-sessions
type: submodule-design
status: draft
title: Study Session Services
parent: langlo-server
tags: [study-sessions, assessment, practice]
---

## Responsibility

Coordinate learner-owned practice, assessment and mixed grammar-review sessions. Session services select available versioned questions, persist attempts and evaluations, and expose resumable session state to learner routes.

## Boundary

- Services receive the learner identity resolved by the server authentication boundary. Client-supplied session and question IDs select among that learner’s records; owner-scoped queries and database relations prevent cross-learner access.
- Practice starts or continues an unfinished session and supports explicit start-over behavior. Assessments freeze a holdout plan, withhold feedback until completion, and expose results only when the saved plan is complete or its stop condition is met. Sessions can pause and resume and have no expiry.
- Mixed grammar reviews freeze a bounded set of due skills and their current questions. They remain distinct from native flashcard reviews and from grammar mastery evidence.
- These are current source behaviors, not proof of production deployment or live-provider acceptance. Cross-owner route acceptance remains a separate gate in [`Route and Request Surface`](routes.md).
