---
id: langlo-lib
type: module-design
status: draft
title: Application Library
parent: langlo-architecture
tags: [source-boundary, application-library]
---

## Responsibility

Provide the application’s reusable library consumed by SvelteKit routes: shared UI, client-safe helpers, browser Library readers and server-side application services. These are internal code boundaries, not independently deployed services. This source-based map remains pending owner review.

## Boundary

- Keep browser-imported modules free of privileged configuration and server-only work. Authentication, database access and provider calls belong to [`langlo-server`](server/SPEC.md).
- [`langlo-components`](components/SPEC.md) owns reusable UI; [`langlo-library`](library/SPEC.md) owns browser-side document reading; [`langlo-server`](server/SPEC.md) owns privileged application services.
- The parent [`langlo-architecture`](../../architecture.md) describes the application topology; this node narrows the shared `src/lib` boundary.
