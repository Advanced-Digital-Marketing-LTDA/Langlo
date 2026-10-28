---
id: langlo-architecture
type: architecture-design
status: active
title: Langlo Application Architecture
parent: langlo-goal
---

## Drivers

Langlo is a single SvelteKit application. Route loaders and actions compose server-side services, which share the app's authenticated learner context and libSQL/Drizzle persistence. There is no evidence for independently deployed service boundaries. This topology is inferred from current source and remains unconfirmed by the owner.

## Decisions

- Keep authentication, database access, private configuration and provider credentials in `src/lib/server`. Routes call server-owned application services; browser code does not own privileged access.
- Treat `src/lib/server` as a cohesive but internally coupled application boundary, not a strict layered architecture. Assessment, mastery and grammar retention have cross-references; grammar retention shares scheduling functions with native flashcards. The importer and impact projection also reach mastery logic.
- Keep private reading and vocabulary in the same application while separating browser reading/rendering from server-side document parsing and provider calls.
- Capture the actual service responsibilities and important dependency edges in [`src/lib/server/SPEC.md`](src/lib/server/SPEC.md). Cross-cutting domain terms and durable policies are recorded in the adopted specs rather than repeated here.

## Invariants

- Every learner record and learner-specific operation is scoped to the authenticated owner; authorization is enforced at server boundaries and in persistence queries/constraints.
- Grammar mastery evidence, grammar-retention scheduling and native-card recall remain separate signals. Curriculum prerequisites express recommended teaching order, not an access or mastery gate.
- Published content versions and historical learner evidence are preserved. Corrections use a new version and the versioned lineage rules in the linked content-update spec.
- Private configuration and provider credentials remain server-only. This is a repository boundary, not evidence that live provider integrations have been accepted.
