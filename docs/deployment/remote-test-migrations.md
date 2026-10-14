# Remote-test database migrations

`npm run db:remote-test` migrates the owner-provided isolated Turso/libSQL test database used by the Better Auth/Coolify pilot. It is separate from `npm run db:migrate`, which stays fixture-only and still rejects every remote target. Nothing runs migrations automatically: the image, startup command and CI never call this command.

## Variables

Set these only in the shell that runs the command (or as Coolify runtime variables when running from the application's terminal). Enter the token directly; never paste it into chat, commits, issues or logs.

| Variable                  | Value                                                                            |
| ------------------------- | -------------------------------------------------------------------------------- |
| `DATABASE_URL`            | `libsql://<database>-<org>.<region>.turso.io` with no token, user, query or path |
| `TURSO_AUTH_TOKEN`        | Database token, read only from the runtime environment                           |
| `LANGLO_MIGRATION_TARGET` | Exactly `remote-test`. Any other value, or none, stops before connecting         |

The command refuses any host outside `.turso.io` (the token is sent on connect), `file:`, in-memory, `http(s):`, IP-address hosts, `localhost` names, ports, credential-bearing URLs and any host containing a `prod` or `production` label. The host check is a name heuristic only; it does not prove the database is not production. The owner verifies database identity.

## Operator steps

1. In the Turso dashboard, confirm the database name and that it is the isolated pilot/test database. If it holds data you need, take a backup or note its point-in-time-restore window first.
2. `npm run db:remote-test -- status`. Read-only. Prints the host, whether the ledger exists, table names, applied and pending migrations.
3. If status reports tables you did not expect, stop and preserve the data.
4. `npm run db:remote-test -- plan`. Read-only dry run. Lists each pending migration, its statement count and checksum prefix, and a plan id.
5. `npm run db:remote-test -- apply --confirm-host <host> --plan-id <id>` using the host and id printed by step 4. Apply refuses to run without both, if the host differs, if the plan id came from a different host, or if the migration ledger, the list of table names or the migration files changed since the plan (`PLAN_CHANGED`; run `plan` again). The plan id does not cover table columns or row data, so do not run other schema changes or writes against the database between `plan` and `apply`.
6. Run `status` again and confirm `pending: 0`.

Expected output on an empty database (host is an example):

```text
$ npm run db:remote-test -- plan
target host: langlo-pilot-test-example.aws-eu-west-1.turso.io
ledger: absent
tables: 0
applied: 0/6
pending: 6 (0000_initial_study, 0001_card_delivery_identity, 0002_harden_persisted_invariants, 0003_review_invariants, 0004_material_sway, 0005_auth_contract)
  would apply 0000_initial_study (24 statement(s), sha256 ef3c4b9fc535)
  ...
plan id: b869f84d817a
to apply: npm run db:remote-test -- apply --confirm-host langlo-pilot-test-example.aws-eu-west-1.turso.io --plan-id b869f84d817a
```

Output never contains the URL scheme, token or driver error text. Failures print one fixed code: `TARGET_MISSING`, `TARGET_INVALID`, `TARGET_PRODUCTION`, `TOKEN_MISSING`, `TARGET_CLASS_REQUIRED`, `CONNECTION_FAILED`, `JOURNAL_INVALID`, `LEDGER_DRIFT`, `AMBIGUOUS_STATE`, `CONFIRMATION_REQUIRED`, `CONFIRMATION_MISMATCH`, `PLAN_CHANGED` or `APPLY_FAILED`. Any other failure after connecting, such as the connection dropping during a `status` or `plan` read, prints `UNEXPECTED: no changes were confirmed`; those commands are read-only, so rerun them.

## State rules

- The ledger is Drizzle's `__drizzle_migrations` table (`hash` = sha256 of the migration file, `created_at` = journal `when`). A database migrated by Drizzle's migrator is recognised as-is.
- Applied rows must match the journal's first N entries exactly, in order. A different hash, an unknown row or more rows than the journal is `LEDGER_DRIFT`: stop and investigate; do not edit the ledger by hand.
- Tables without a ledger (for example a schema created with `drizzle-kit push`) report `AMBIGUOUS_STATE`. The command will not guess which migrations those tables represent.

## Atomicity, retry and rollback limits

Apply sends every pending statement plus the ledger inserts as one `client.migrate` batch. In the installed `@libsql/client` 0.18.0 that batch is `BEGIN` … `COMMIT` with a conditional `ROLLBACK` step, so SQLite's transaction makes it all-or-nothing; a guard statement at the start of the batch re-checks the exact ledger rows and table names, so a concurrent change or apply aborts it. `APPLY_FAILED` means the batch did not report success. A failed batch rolls back, but if the connection drops after Turso commits, the migrations may have been applied anyway. After `APPLY_FAILED`, always run `status`: if `pending` is now 0, the apply succeeded; otherwise nothing changed, so fix the cause, then `plan` and `apply` again.

There is no down migration, destructive reset or automatic rollback. Recovery from a bad but committed migration is roll-forward with a new migration, or restore from a Turso backup/PITR, which is unverified (LANGLO-58). Any future destructive migration needs a verified backup and explicit owner review before apply.
