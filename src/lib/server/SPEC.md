---
id: langlo-server
type: module-design
status: active
title: Server Application Services
parent: langlo-lib
---

## Responsibility

Own server-side authentication/session access and application services for learner-owned grammar study, assessment, mastery evidence, grammar retention, native flashcards, private reading/vocabulary, learner content reports and versioned curriculum updates. These services coordinate persistence and guarded provider calls for the SvelteKit routes. This responsibility boundary is reconstructed from current source and remains unconfirmed by the owner.

## Boundary

- This module runs on the server. Routes pass an authenticated learner context; identity and ownership must not be taken from client-submitted identifiers. Database reads and writes remain owner-scoped.
- Browser presentation stays in routes and client modules. Database connections, private configuration, filesystem document parsing and provider credentials stay server-side; provider calls are invoked only from server code.
- Study services are intentionally documented as a coupled group, not independent layers: assessment, mastery and grammar-retention logic reference one another, and grammar retention shares scheduling operations with native flashcards. Curriculum impact projection also consults mastery logic.
- The adopted [grammar evidence policy](../../../docs/scoring-policy.md), [assessment decision](../../../docs/adr/0001-assessment-scope-and-stop.md), [grammar-retention decision](../../../docs/adr/0001-grammar-retention-is-skill-scoped.md), [content-update contract](../../../docs/content-update.md) and [content-report contract](../../../docs/content-maintenance.md) capture specific behavior; their node IDs are linked in this module's graph.
- The adopted [curriculum import contract](../../../docs/curriculum-import-contract.md) describes validation for a future importer, while runtime content import code already exists. Its exact fit to that implementation remains unconfirmed; adoption does not assert full conformance.
- Live email, Jev and OpenAI integration acceptance remains unverified.
