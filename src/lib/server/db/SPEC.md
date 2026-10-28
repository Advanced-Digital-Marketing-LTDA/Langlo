---
id: langlo-database
type: submodule-design
status: draft
title: Server Database Services
parent: langlo-server
tags: [database, server-only]
---

## Responsibility

Own the server-side Drizzle schema, versioned migrations and database connection seams used by the application and guarded local fixtures.

## Boundary

- `openAppDatabase` follows an explicit `RuntimeConfig`; local development/test data and configured production libSQL use the application seam. Its existence does not establish a provisioned or live production database.
- Fixture access is separate: the validated fixture target uses the SQLite-only client and cannot contact a network database. Fixture migrations and reset tooling do not authorize production operations.
- Relational ownership constraints complement owner-filtered service queries; schema constraints alone do not authenticate a learner or prove route authorization.
