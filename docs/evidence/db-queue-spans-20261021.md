# Database queue and transaction spans (step A of the database performance plan)

**Scope:** timing only. No behavior, schema, sample rate or query changed. This records local validation; it is not a latency result.

## Changes

- `acquireConnection` wraps a real wait in a `db.queue-wait` span with a `waiters` attribute (requests already waiting ahead). A free connection records no span, so a trace without one means no queueing. A wait that times out fails the span with the existing `SQLITE_BUSY` error.
- `beginWrite` and `beginRead` open a `db.transaction` span once the connection is held and end it when the transaction commits, rolls back or closes. It carries `write` and `round_trips` (calls to `execute` and `batch`; BEGIN and COMMIT not counted; a batch is one trip). Its duration is how long other requests wait behind the transaction.
- `tests/tracing-spans.test.ts` now ignores `db.*` spans in its mock, because those tests assert the exact study and mastery span lists. Connection spans are covered by the new file.

## Red and green

- Red, before the change: 6 of 7 tests in `tests/db-transactions-spans.test.ts` failed (no span recorded). The seventh (no wait span when the connection is free) passes by design and guards against over-recording.
- Green: `tests/db-transactions-spans.test.ts`, `tests/app-database-shared.test.ts`, `tests/app-database.test.ts` and `tests/tracing-spans.test.ts` pass (26 tests); `svelte-check`, `eslint` and Prettier are clean.
- The full suite, build and browser tests are left to CI.

## Reading the traces

In GlitchTip, open the slowest `study.run` traces. A long `db.queue-wait` means requests are stuck behind another transaction; a long `db.transaction` with a high `round_trips` means that transaction spends its time in round trips. Sampling is 25%.
