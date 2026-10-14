# Production signup unavailable: Turso rejects busy_timeout

**Symptom:** after the Turso schema was migrated, `/signup` still returned "Sign-up is temporarily unavailable" with an `auth`/`unexpected` diagnostic.

**Cause:** `openAppDatabase` ran `PRAGMA busy_timeout = 5000` on every connection. The owner ran the same statements against the production Turso database; Turso returned `SQL_PARSE_ERROR: SQL not allowed statement: PRAGMA busy_timeout = 5000`, while `PRAGMA foreign_keys = ON` and reads of `users`, `accounts` and `rate_limits` succeeded. Auth could therefore never open its database.

**Fix:** run `busy_timeout` only for local `file:` databases, where it applies.

**Red (before fix), `tests/app-database.test.ts`:** remote open rejected with `SQL not allowed statement`; `1 failed`.

**Green (after fix):** `check`, `lint`, `format:check`, `test` (310 passed), `test:property`, `build` and `test:e2e` (64 passed) pass locally on Node 22.22.0 / npm 10.9.4, not the pinned toolchain; CI is authoritative.

**Pending acceptance:** a production signup after redeploy. Local checks use a mocked remote client and do not prove Turso behaviour beyond the owner-reported statement results above.
