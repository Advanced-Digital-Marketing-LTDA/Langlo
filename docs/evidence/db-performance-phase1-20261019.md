# Database performance Phase 1 evidence

**Scope:** Initiative 80, Phase 1, coordinated with the read-only mastery Step 0 in Initiative 79. This records local implementation and validation; it is not a latency result or a production acceptance.

## Changes

- `openAppDatabase` now shares its in-flight initialization, libSQL client, and Drizzle database per database URL and token. Foreign-key and local-file busy-timeout pragmas run once. Failed initialization closes and evicts the client so the next request can retry. Request cleanup retains its `close()` API but cannot close the process-wide connection.
- `beginWrite` now serializes write transactions for each shared libSQL client through commit or rollback, while preserving retries for external SQLite busy errors. This prevents overlapping transactions from colliding on the shared single connection.
- `computeMastery` reads the catalog, prerequisites, content status, attempts, and evaluations inside a read-only snapshot transaction, without writing `skill_evidence`. `loadProgress` keeps the owner-scoped enrollment check and no longer repeats that lookup once per language.
- A resolved practice or mixed-review answer synchronizes qualifying evidence in the answer transaction. The final assessment answer synchronizes only after the plan completes. A resolved fallback verdict and its evidence sync commit together. Uncertain and unfinished assessment answers add no evidence.
- No migration was added. Session verification remains uncached. No trace sampling, database region, auth setting, or replica setting changed.

## Red and green checks

- Before the client reuse change, the new app database tests observed two clients and duplicate PRAGMA setup for the same config; the shared-client identity assertion failed.
- Before transaction serialization, the shared-client test observed only 1 of 6 concurrent write transactions complete. After the queue change, all six commit, and a trigger-induced failed write rolls back so later writes can proceed.
- Before event-time evidence sync, the new mastery test showed a successful answer did not attempt the ledger write, and the renamed read API was not available. After implementation, a rejected ledger write rolls back the attempt and evaluation, while a trigger rejecting ledger inserts does not prevent a mastery read.
- Focused implementation tests: 7 files, 77 tests passed.
- `npm run check`: 0 errors and 0 warnings.
- `npm run lint`: passed.
- `npm test`: 83 files, 1,321 tests passed.
- `npm run test:property`: 5 files, 7 tests passed.
- `npm run build`: passed.
- `npm run test:e2e`: 90 tests passed, 0 failed, 0 flaky, 0 skipped.
- Scoped Prettier check and repository-wide `npm run format:check` both passed.

## Limits and next phase

- No traces were available and no timing gate was set, so this work makes no request-latency claim. The Sentry sample rate was not changed.
- The shared-client test verifies FK enforcement, client reuse across concurrent first opens, rollback release, and six concurrent transactions against a local in-memory libSQL client. The adapter rejects overlapping write transactions (`TRANSACTION_ACTIVE` in memory and `SQLITE_BUSY` for a file); application writes now queue per client. Concurrent transaction behavior against Turso was not verified because this phase uses only disposable local fixtures and no remote database access.
- Phase 2 content caching and the selected epoch-table freshness mechanism are deferred until Phase 1 review; no epoch migration is included here. No embedded replica spike was run.

## Review follow-up

- Failed commits roll back before releasing the shared-client write queue. A deferred foreign-key test verifies that a later transaction can commit after a rejected commit.
- Mastery calculation is private behind the owner-scoped enrollment loader, which still reads enrollment once before computing each enrolled language.
- Evidence synchronization now scans only the submitted attempt's lineage, or the completed assessment session's lineages, rather than replaying the learner's full history after every answer.
- Evidence synchronization now reconciles any missing qualifying row from those lineages, including an earlier attempt; a regression test deletes the first ledger row, repeats that lineage, and confirms the earlier attempt is restored.
- Resolved mixed-review answers now synchronize their evidence in the answer transaction, matching practice and assessment behavior; a focused test verifies the ledger entry.
- Standalone mutating statements now use the same per-client queue as transactions. The shared-client regression test holds a transaction open, queues a standalone write, rolls back the transaction, and confirms the standalone write persists after the rollback.
- Final local follow-up validation: `npm run check` (0 errors, 0 warnings), lint, format, build, all 1,338 tests across 83 files, seven property tests, and all 90 browser tests passed. The browser suite ran sequentially after a clean build on port 4174 using a temporary config that changed only the server address. An earlier browser run was aborted after overlapping builds invalidated its running server; its leftover server occupied port 4173. The temporary config was removed.

Mastery now acquires a queued read-only transaction for its catalog, prerequisites, evidence, and current-content lookups. This waits for an active write and prevents mixed-revision responses. The regression test failed before this change because mastery completed during an active write; it passes after the change. Snapshot reads may wait behind writes, so this phase makes no latency claim.

Queue acquisition times out after five seconds with `SQLITE_BUSY`. A timed-out waiter is removed from the queue and cancels its own slot without releasing another request's active transaction. A fake-timer test verifies that the cancelled write never executes and a later queued write proceeds after rollback. Every current transaction caller uses terminal cleanup; the caller audit found no nested `beginWrite` or `executeWrite` on the same client. The queue does not force-release a transaction while an underlying operation may still be executing.

The pinned local libSQL SDK uses a connection pool for file databases and keeps transaction connections separate from plain client operations. A disposable file-database regression test holds an uncommitted update open and confirms a concurrent plain read sees the committed value, both before and after rollback. In-memory databases have one connection, so their snapshot reads use the same queue as writes.

No application code reads `skill_evidence` for displayed mastery, recommendations, exports, or reports; these use attempts and evaluations. The ledger is an advisory traceability record.

Historical ledger reconciliation is lazy: a qualifying old attempt is restored when its lineage is next answered in a practice or mixed-review session or a completed assessment. This avoids a full-history scan on every answer; lineages never answered again are not backfilled by this phase.
