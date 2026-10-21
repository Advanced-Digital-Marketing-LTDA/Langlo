# Exercises e2e: SQLITE_BUSY on answer commit

Scope: stop `tests/e2e/exercises.spec.ts` ("all four exercise formats render
and submit without overflow") failing on main (run 39588144842, desktop and
mobile). Test-only change; application code is unchanged.

## Failure

CI: after Enter on question 2, `storedAnswers` stayed at one row
(`Expected length: 2, Received length: 1`). Locally the same signature appeared
intermittently when the whole file ran, at different questions.

## Cause

The answer POST returned 500. With the server's stderr and error text captured
locally (temporary instrumentation, removed), the error was:

```text
LibsqlError: SQLITE_BUSY: database is locked
    at Sqlite3Transaction.commit (db-transactions.ts:71)
    at recordAttemptWrite (study.ts:967)
    at recordAnswer (lesson-practice.ts:215)
```

The test polls the fixture file from its own connection while the server
commits. In the default journal mode an open read blocks the commit. The
server's `busy_timeout` does not help: the libSQL local client opens a new
connection per transaction and does not carry the pragma over. This affects
local-file SQLite only.

An earlier hypothesis (a hydration race after `page.reload()`) was tested with a
hydration marker and wait; failures continued, so it was discarded.

## Change

`beforeAll` sets `PRAGMA journal_mode = WAL` on the disposable fixture database
so test reads cannot block server writes.

## Validation

Node 22.22.0 locally (CI uses 24.19.0), npm 11.9.0, system Chromium, CI-style
`build:e2e-coverage` build. Only this spec file was run.

- Before: whole-file desktop runs failed in about half of attempts.
- After: 8 of 8 whole-file desktop runs passed; 3 of 3 desktop and mobile runs
  passed (16 tests each).
- The full suite was not run locally; CI runs it.

Not changed: application database setup, `fixture-server.ts` and the other
e2e specs, which poll their fixtures in the same way.
