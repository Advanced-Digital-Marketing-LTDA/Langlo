# Remote read transactions skip the connection queue (step B of the database performance plan)

**Scope:** read transactions on remote libSQL (Turso) clients only. Writes, local file and in-memory databases, the 5 s `SQLITE_BUSY` wait, schema and queries are unchanged. This records local validation; it is not a latency result. The effect is checked in GlitchTip after deploy (`db.queue-wait` and the page timings).

## Why

GlitchTip averages after PR 138: `db.queue-wait` 2.32 s of a 2.86 s POST lesson, `db.transaction` 751 ms, one Turso call about 127 ms. The dev Turso probe (2026-10-21, `notes/db-performance/plan.md`) showed that a read transaction opens beside an open write transaction on the same client and sees the earlier snapshot, so serializing reads there is not needed. Local file and in-memory databases keep the queue because they share one connection.

## Changes

- `db-transactions.ts`: `markRemoteClient(client)` records a client as remote. `holdConnection` does not acquire the queue slot for a read transaction on a marked client (no `db.queue-wait`; the `db.transaction` span with `write: false` is still recorded). Write transactions and `executeWrite` still queue on every client.
- `db/app.ts`: `initializeDatabase` marks the client when the URL scheme is `libsql`, `http(s)` or `ws(s)`. Any other URL (file, `:memory:`) stays unmarked and queues as before.

## Red and green

`tests/db-transactions-remote-reads.test.ts` (5 tests, remote URLs use a stub client; no network). Red, before the change (2 failed, 3 passed):

```
 × opens a read transaction beside an open write transaction on a remote database
 × does not make a write wait for an open read on a remote database
AssertionError: expected false to be true // Object.is equality
```

Green, after: 5 passed; with `tests/db-transactions-spans.test.ts`, `tests/app-database-shared.test.ts` and `tests/app-database.test.ts`: `Test Files 4 passed (4)`, `Tests 30 passed (30)`.

Mutations that make the new tests fail: dropping the `markRemoteClient` call in `app.ts` (2 fail), removing the remote check in `holdConnection` (2 fail), letting writes bypass too (`still queues a second write behind an open write` fails).

`npm run check`: 0 errors, 0 warnings. The full suite is left to CI.

## CI follow-up: Node scripts could not load the database module

The first push imported `db-transactions.ts` into `db/app.ts`. That pulled `./tracing` (a SvelteKit-only import chain) into the Node scripts that open the database, and 28 e2e tests failed on `node scripts/accounts-provision.ts`:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/Langlo/Langlo/src/lib/server/tracing' imported from /home/runner/work/Langlo/Langlo/src/lib/server/db-transactions.ts
```

Reproduced locally with `node scripts/accounts-provision.ts --app --email x@example.test --name X` (same error); main loads fine. The marker now lives in `remote-clients.ts`, which has no imports, and `db-transactions.ts` and `db/app.ts` both import it. The same command now reaches its own argument check (`Provision rejected: ...`). New test `keeps the app database module loadable by plain Node scripts` loads `db/app.ts` under plain Node. With the change: 31 passed across the four test files, `npm run check` 0 errors.

## Review follow-up: more coverage

Codacy asked for tests of the span behavior and of URL classification. `tests/db-transactions-remote-reads.test.ts` now also covers: the read opening beside a write for each of `libsql`, `http`, `https`, `ws` and `wss`; a remote read recording `db.transaction` and no `db.queue-wait`; and a read still waiting behind a write (with a `db.queue-wait` span) on local `:memory:` and `file:` databases. Mutations that make it fail: dropping `ws` from the scheme list, adding `file` to it, removing the read bypass. Result: 12 passed in that file.

## Not covered here

Remote Turso behavior beyond the dev probe (waits over 2 s, many concurrent streams) is unmeasured. The dev probe showed a read beside an open write sees the snapshot from before the write commits.
