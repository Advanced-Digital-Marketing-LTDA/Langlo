---
id: langlo-components
type: module-design
status: draft
title: Shared UI Components
parent: langlo-lib
tags: [ui, components]
---

## Responsibility

Provide reusable Svelte presentation and interaction components for learner surfaces, including exercises, progress views, maps, reports and Library interactions. Shared answer helpers give immediate input feedback.

## Boundary

- Components render route-provided state and emit learner actions; they do not own authentication, persistence or provider access.
- Client-side input checks improve feedback but are not a trust boundary. Server services validate submitted data before state changes.
- Composition and route behavior remain in the owning SvelteKit pages.
