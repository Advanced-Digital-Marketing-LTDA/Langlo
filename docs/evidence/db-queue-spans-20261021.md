# Database queue and transaction spans (step A of the database performance plan)

**Scope:** timing only. No behavior, schema, sample rate or query changed. This records local validation; it is not a latency result.

## Changes

- `acquireConnection` wraps a real wait in a `db.queue-wait` span with a `waiters` attribute (requests already waiting ahead). A free connection records no span, so a trace without one means no queueing. A wait that times out fails the span with the existing `SQLITE_BUSY` error.
- `beginWrite` and `beginRead` open a `db.transaction` span once the connection is held and end it when the transaction commits, rolls back or closes. It carries `write` and `round_trips` (calls to `execute` and `batch`; BEGIN and COMMIT not counted; a batch is one trip). Its duration is how long other requests wait behind the transaction.
- `tests/tracing-spans.test.ts` now collects `db.*` spans separately, because those tests assert the exact study and mastery span lists; one new test there asserts that `recordAttempt` and `loadProgress` each produce one traced transaction (write and read). Connection span behavior is covered by the new file.
- If the transaction span cannot start, the connection slot is released before the error propagates.

## Red and green

Observed runner output (Vitest, `tests/db-transactions-spans.test.ts`).

Red, against `db-transactions.ts` as it was before this PR (`5c0dd34`):

```
 × times a write transaction and reports its round trips when it commits
 × counts a batch as one round trip
 × marks a read transaction as not a write
 × ends the transaction span on rollback and on close without commit
 × records a queue wait with the number of waiters already ahead
 × fails the queue-wait span with the busy error when the wait times out
 × releases the connection when the transaction span cannot start
 × ends the span and frees the connection when opening the transaction fails
 Test Files  1 failed (1)
      Tests  8 failed | 2 passed (10)
```

The two passing tests are guards that hold by design (no wait span when the connection is free; non-function properties pass through).

Review follow-up, against the first PR commit (`f2b3b13`), before the fix: `releases the connection when the transaction span cannot start` failed with `Test timed out in 1000ms` (a failing span left the connection slot taken). After the fix it passes.

Green, after the change:

```
 Test Files  4 passed (4)
      Tests  30 passed (30)
```

Files run: `tests/db-transactions-spans.test.ts`, `tests/app-database-shared.test.ts`, `tests/app-database.test.ts`, `tests/tracing-spans.test.ts`. `svelte-check` reports 0 errors and 0 warnings; ESLint and Prettier are clean. The full suite, build and browser tests are left to CI.

## Reading the traces

In GlitchTip, open the slowest `study.run` traces. A long `db.queue-wait` means requests are stuck behind another transaction; a long `db.transaction` with a high `round_trips` means that transaction spends its time in round trips. Sampling is 25%.
