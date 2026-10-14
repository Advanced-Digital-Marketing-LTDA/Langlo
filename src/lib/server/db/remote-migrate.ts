import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Client, InStatement } from '@libsql/client';

/**
 * Guarded migration seam for the owner-provided isolated remote test database.
 * Separate from the fixture-only migrator in migrate.ts. It keeps Drizzle's
 * `__drizzle_migrations` ledger format so either tool sees the same state, but
 * unlike Drizzle's migrator it verifies every applied checksum, refuses
 * ambiguous state and only applies a plan the operator reviewed and confirmed.
 */

export type RemoteMigrationErrorCode =
  | 'TARGET_MISSING'
  | 'TARGET_INVALID'
  | 'TARGET_PRODUCTION'
  | 'TOKEN_MISSING'
  | 'TARGET_CLASS_REQUIRED'
  | 'JOURNAL_INVALID'
  | 'LEDGER_DRIFT'
  | 'AMBIGUOUS_STATE'
  | 'CONFIRMATION_REQUIRED'
  | 'CONFIRMATION_MISMATCH'
  | 'PLAN_CHANGED'
  | 'APPLY_FAILED';

const messages = new Map<RemoteMigrationErrorCode, string>(
  Object.entries({
    TARGET_MISSING: 'DATABASE_URL is not set',
    TARGET_INVALID:
      'DATABASE_URL must be a bare libsql://host remote URL without credentials, query or path',
    TARGET_PRODUCTION: 'DATABASE_URL names a production database',
    TOKEN_MISSING: 'TURSO_AUTH_TOKEN is not set in the runtime environment',
    TARGET_CLASS_REQUIRED:
      'set LANGLO_MIGRATION_TARGET=remote-test to confirm the target class',
    JOURNAL_INVALID: 'the migration journal or a migration file is invalid',
    LEDGER_DRIFT:
      'applied migrations do not match the checked-in migration files',
    AMBIGUOUS_STATE: 'the database has tables but no migration ledger',
    CONFIRMATION_REQUIRED:
      'apply requires --confirm-host HOST and --plan-id ID from plan',
    CONFIRMATION_MISMATCH:
      '--confirm-host does not match the DATABASE_URL host',
    PLAN_CHANGED:
      'the database or migrations changed since the reviewed plan; run plan again',
    APPLY_FAILED:
      'the migration batch did not report success; a failed batch rolls back, but a connection lost after commit can leave it applied, so run status before retrying'
  }) as [RemoteMigrationErrorCode, string][]
);

/** Fixed, credential-free failure. Never carries supplied URLs, tokens or wrapped driver errors. */
export class RemoteMigrationError extends Error {
  readonly code: RemoteMigrationErrorCode;
  constructor(code: RemoteMigrationErrorCode) {
    super(`${code}: ${messages.get(code)}`);
    this.code = code;
  }
}

export interface RemoteTestTarget {
  url: string;
  host: string;
  authToken: string;
}

const productionMarker = /(^|[^a-z0-9])prod(uction)?([^a-z0-9]|$)/iu;
// Turso targets are DNS names. Requiring dotted labels ending in an alphabetic
// TLD rejects every IP literal (IPv6, dotted, short or numeric IPv4), which
// `new URL` does not normalise for the non-special libsql: scheme.
const dnsLabel = /^[a-z0-9-]{1,63}$/u;
const topLevelLabel = /^[a-z]{2,63}$/u;
function isDnsHost(hostname: string): boolean {
  const labels = hostname.split('.');
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        dnsLabel.test(label) && !label.startsWith('-') && !label.endsWith('-')
    ) &&
    topLevelLabel.test(labels.at(-1) ?? '')
  );
}

/** A libsql:// DNS host with no port, credentials, query, fragment or path. */
function isBareRemoteUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return (
    url.protocol === 'libsql:' &&
    isDnsHost(hostname) &&
    !hostname.endsWith('.localhost') &&
    !url.port &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    (url.pathname === '' || url.pathname === '/')
  );
}

/** Validate the explicit remote-test target from the runtime environment before any connection. */
export function parseRemoteTestTarget(
  env: Record<string, string | undefined>
): RemoteTestTarget {
  if (env.LANGLO_MIGRATION_TARGET !== 'remote-test')
    throw new RemoteMigrationError('TARGET_CLASS_REQUIRED');
  const raw = env.DATABASE_URL?.trim();
  if (!raw) throw new RemoteMigrationError('TARGET_MISSING');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RemoteMigrationError('TARGET_INVALID');
  }
  if (!isBareRemoteUrl(url)) throw new RemoteMigrationError('TARGET_INVALID');
  const hostname = url.hostname.toLowerCase();
  if (productionMarker.test(hostname))
    throw new RemoteMigrationError('TARGET_PRODUCTION');
  const authToken = env.TURSO_AUTH_TOKEN?.trim();
  if (!authToken) throw new RemoteMigrationError('TOKEN_MISSING');
  return { url: `libsql://${hostname}`, host: hostname, authToken };
}

export interface MigrationFile {
  tag: string;
  when: number;
  hash: string;
  statements: string[];
}

/** Read the journal in order; hashes match Drizzle's sha256 of the whole migration file. */
export function loadMigrations(folder = 'drizzle'): MigrationFile[] {
  try {
    const journal = JSON.parse(
      readFileSync(`${folder}/meta/_journal.json`, 'utf8')
    ) as { entries?: { tag?: unknown; when?: unknown }[] };
    if (!Array.isArray(journal.entries) || journal.entries.length === 0)
      throw new Error('empty');
    let previous = -Infinity;
    return journal.entries.map((entry) => {
      if (
        typeof entry.tag !== 'string' ||
        !/^\d{4}_[a-z0-9_]+$/u.test(entry.tag) ||
        typeof entry.when !== 'number' ||
        !Number.isSafeInteger(entry.when) ||
        entry.when <= previous
      )
        throw new Error('entry');
      previous = entry.when;
      const sql = readFileSync(`${folder}/${entry.tag}.sql`, 'utf8');
      return {
        tag: entry.tag,
        when: entry.when,
        hash: createHash('sha256').update(sql).digest('hex'),
        statements: sql
          .split('--> statement-breakpoint')
          .filter((statement) => statement.trim())
      };
    });
  } catch {
    throw new RemoteMigrationError('JOURNAL_INVALID');
  }
}

export interface MigrationState {
  ledgerPresent: boolean;
  userTables: string[];
  applied: MigrationFile[];
  pending: MigrationFile[];
  planId: string;
}

const ledgerTable = '__drizzle_migrations';

/** Read-only: classify the target and derive the plan the operator must confirm. */
export async function readMigrationState(
  client: Client,
  migrations: MigrationFile[]
): Promise<MigrationState> {
  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  );
  const names = tables.rows.map((row) => String(row.name));
  const ledgerPresent = names.includes(ledgerTable);
  const userTables = names.filter(
    (name) =>
      name !== ledgerTable &&
      !name.toLowerCase().startsWith('sqlite_') &&
      !name.toLowerCase().startsWith('_litestream')
  );
  let rows: { hash: string; createdAt: number }[] = [];
  if (ledgerPresent) {
    const ledger = await client.execute(
      `SELECT hash, created_at FROM ${ledgerTable} ORDER BY created_at, id`
    );
    rows = ledger.rows.map((row) => ({
      hash: String(row.hash),
      createdAt: Number(row.created_at)
    }));
  } else if (userTables.length > 0) {
    throw new RemoteMigrationError('AMBIGUOUS_STATE');
  }
  if (rows.length > migrations.length)
    throw new RemoteMigrationError('LEDGER_DRIFT');
  rows.forEach((row, index) => {
    const expected = migrations.at(index);
    if (row.hash !== expected?.hash || row.createdAt !== expected.when)
      throw new RemoteMigrationError('LEDGER_DRIFT');
  });
  if (ledgerPresent && rows.length === 0 && userTables.length > 0)
    throw new RemoteMigrationError('AMBIGUOUS_STATE');
  const applied = migrations.slice(0, rows.length);
  const pending = migrations.slice(rows.length);
  const planId = createHash('sha256')
    .update(
      JSON.stringify({
        ledgerPresent,
        userTables,
        applied: applied.map((m) => [m.hash, m.when]),
        pending: pending.map((m) => [m.hash, m.when])
      })
    )
    .digest('hex')
    .slice(0, 12);
  return { ledgerPresent, userTables, applied, pending, planId };
}

export interface ApplyConfirmation {
  host: string;
  confirmHost: string | undefined;
  planId: string | undefined;
}

/**
 * Apply the confirmed plan in one libSQL `migrate` batch. The installed
 * @libsql/client (0.18.0) sends that batch as BEGIN … COMMIT with a ROLLBACK
 * step on any failure, for both the remote (Hrana) and local sqlite3 clients,
 * so SQLite's own transaction makes the batch all-or-nothing. A guard at the
 * start of the batch re-checks the ledger rows and table names inside the
 * transaction so a concurrent apply or schema change fails the batch.
 */
export async function applyRemoteTestPlan(
  client: Client,
  migrations: MigrationFile[],
  confirmation: ApplyConfirmation
): Promise<{ applied: string[] }> {
  if (!confirmation.confirmHost || !confirmation.planId)
    throw new RemoteMigrationError('CONFIRMATION_REQUIRED');
  if (confirmation.confirmHost !== confirmation.host)
    throw new RemoteMigrationError('CONFIRMATION_MISMATCH');
  const state = await readMigrationState(client, migrations);
  if (state.planId !== confirmation.planId)
    throw new RemoteMigrationError('PLAN_CHANGED');
  if (state.pending.length === 0) return { applied: [] };

  const batch: InStatement[] = [
    `CREATE TABLE IF NOT EXISTS ${ledgerTable} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
    // Re-check the reviewed state inside the transaction: the exact ledger rows
    // and the exact user-table names (hex-encoded, in name order).
    // abs(-9223372036854775808) raises "integer overflow", aborting the whole
    // batch when anything changed.
    {
      sql: `SELECT CASE WHEN
          coalesce((SELECT group_concat(entry, ',') FROM (SELECT hash || ':' || created_at AS entry FROM ${ledgerTable} ORDER BY created_at, id)), '') = ?
          AND coalesce((SELECT group_concat(hex(name), ',') FROM (SELECT name FROM sqlite_master WHERE type = 'table' AND name <> '${ledgerTable}' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_litestream%' ESCAPE '\\' ORDER BY name)), '') = ?
        THEN 1 ELSE abs(-9223372036854775808) END`,
      args: [
        state.applied.map((m) => `${m.hash}:${m.when}`).join(','),
        state.userTables
          .map((name) =>
            Buffer.from(name, 'utf8').toString('hex').toUpperCase()
          )
          .join(',')
      ]
    }
  ];
  for (const migration of state.pending) {
    for (const statement of migration.statements) batch.push(statement);
    batch.push({
      sql: `INSERT INTO ${ledgerTable} ("hash", "created_at") VALUES (?, ?)`,
      args: [migration.hash, migration.when]
    });
  }
  try {
    await client.migrate(batch);
  } catch {
    throw new RemoteMigrationError('APPLY_FAILED');
  }
  return { applied: state.pending.map((m) => m.tag) };
}
