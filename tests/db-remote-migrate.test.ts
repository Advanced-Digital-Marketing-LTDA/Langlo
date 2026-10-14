import { afterEach, describe, expect, it } from 'vitest';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { drizzle } from 'drizzle-orm/libsql';
import {
  applyRemoteTestPlan,
  loadMigrations,
  parseRemoteTestTarget,
  readMigrationState,
  RemoteMigrationError,
  type MigrationFile
} from '../src/lib/server/db/remote-migrate';
import { runRemoteTestCli } from '../scripts/db-remote-test';
import { migrateFixtureDatabase } from '../src/lib/server/db/migrate';
import {
  createDisposableFixture,
  disposeDisposableFixture
} from './fixtures/database';

const roots: string[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

/** Local file URL standing in for the remote target; tests never open a network database. */
async function scratchUrl(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'langlo-remote-test-'));
  roots.push(root);
  return pathToFileURL(join(root, 'target.sqlite')).href;
}

function track(client: Client): Client {
  clients.push(client);
  return client;
}

async function scratchDatabase(): Promise<Client> {
  return track(createClient({ url: await scratchUrl() }));
}

/** Copy the checked-in migration folder so a test can corrupt it without touching history. */
async function copyMigrations(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'langlo-remote-migrations-'));
  roots.push(root);
  await mkdir(join(root, 'meta'));
  await copyFile(
    'drizzle/meta/_journal.json',
    join(root, 'meta/_journal.json')
  );
  for (const migration of loadMigrations())
    await copyFile(
      `drizzle/${migration.tag}.sql`,
      join(root, `${migration.tag}.sql`)
    );
  return root;
}

const host = 'langlo-pilot-test-owner.aws-eu-west-1.turso.io';
const safeEnv = {
  DATABASE_URL: `libsql://${host}`,
  TURSO_AUTH_TOKEN: 'synthetic-token-not-a-secret',
  LANGLO_MIGRATION_TARGET: 'remote-test'
};

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof RemoteMigrationError ? error.code : 'unexpected';
  }
  return undefined;
}

async function asyncCodeOf(
  fn: () => Promise<unknown>
): Promise<string | undefined> {
  try {
    await fn();
  } catch (error) {
    return error instanceof RemoteMigrationError ? error.code : 'unexpected';
  }
  return undefined;
}

describe('remote-test target validation', () => {
  it('accepts only an explicit libsql:// target with a runtime token and target class', () => {
    expect(parseRemoteTestTarget(safeEnv)).toEqual({
      url: `libsql://${host}`,
      host,
      authToken: 'synthetic-token-not-a-secret'
    });
  });

  it.each([
    ['missing URL', { ...safeEnv, DATABASE_URL: undefined }, 'TARGET_MISSING'],
    ['blank URL', { ...safeEnv, DATABASE_URL: '  ' }, 'TARGET_MISSING'],
    [
      'malformed URL',
      { ...safeEnv, DATABASE_URL: 'libsql//nope' },
      'TARGET_INVALID'
    ],
    [
      'local file',
      { ...safeEnv, DATABASE_URL: 'file:/tmp/x.sqlite' },
      'TARGET_INVALID'
    ],
    [
      'bare path',
      { ...safeEnv, DATABASE_URL: '/tmp/x.sqlite' },
      'TARGET_INVALID'
    ],
    ['in-memory', { ...safeEnv, DATABASE_URL: ':memory:' }, 'TARGET_INVALID'],
    [
      'https',
      { ...safeEnv, DATABASE_URL: `https://${host}` },
      'TARGET_INVALID'
    ],
    [
      'localhost',
      { ...safeEnv, DATABASE_URL: 'libsql://localhost:8080' },
      'TARGET_INVALID'
    ],
    [
      'loopback',
      { ...safeEnv, DATABASE_URL: 'libsql://127.0.0.1' },
      'TARGET_INVALID'
    ],
    [
      'token in query',
      { ...safeEnv, DATABASE_URL: `libsql://${host}?authToken=x` },
      'TARGET_INVALID'
    ],
    [
      'userinfo',
      { ...safeEnv, DATABASE_URL: `libsql://user:pw@${host}` },
      'TARGET_INVALID'
    ],
    [
      'path',
      { ...safeEnv, DATABASE_URL: `libsql://${host}/other` },
      'TARGET_INVALID'
    ],
    [
      'production host',
      { ...safeEnv, DATABASE_URL: 'libsql://langlo-prod-owner.turso.io' },
      'TARGET_PRODUCTION'
    ],
    [
      'production word',
      { ...safeEnv, DATABASE_URL: 'libsql://langlo-production.turso.io' },
      'TARGET_PRODUCTION'
    ],
    [
      'missing token',
      { ...safeEnv, TURSO_AUTH_TOKEN: undefined },
      'TOKEN_MISSING'
    ],
    ['blank token', { ...safeEnv, TURSO_AUTH_TOKEN: ' ' }, 'TOKEN_MISSING'],
    [
      'missing class',
      { ...safeEnv, LANGLO_MIGRATION_TARGET: undefined },
      'TARGET_CLASS_REQUIRED'
    ],
    [
      'production class',
      { ...safeEnv, LANGLO_MIGRATION_TARGET: 'production' },
      'TARGET_CLASS_REQUIRED'
    ]
  ])('rejects %s before any connection', (_name, env, code) => {
    expect(codeOf(() => parseRemoteTestTarget(env))).toBe(code);
  });

  it('never includes the supplied URL or token in rejection messages', () => {
    const env = {
      ...safeEnv,
      DATABASE_URL: `libsql://user:leaked-secret@${host}?authToken=leaked-secret`
    };
    try {
      parseRemoteTestTarget(env);
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('leaked-secret');
      expect(String((error as Error).message)).not.toContain(host);
    }
  });
});

describe('migration inventory', () => {
  it('reads the journal in order with Drizzle-compatible checksums', async () => {
    const migrations = loadMigrations();
    expect(migrations.map((m) => m.tag)).toEqual([
      '0000_initial_study',
      '0001_card_delivery_identity',
      '0002_harden_persisted_invariants',
      '0003_review_invariants',
      '0004_material_sway',
      '0005_auth_contract'
    ]);
    const whens = migrations.map((m) => m.when);
    expect([...whens].sort((a, b) => a - b)).toEqual(whens);
    expect(migrations.every((m) => /^[0-9a-f]{64}$/.test(m.hash))).toBe(true);
  });

  it('rejects a journal whose timestamps are not strictly increasing', async () => {
    const folder = await copyMigrations();
    const journalPath = join(folder, 'meta/_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    journal.entries[2].when = journal.entries[1].when;
    await writeFile(journalPath, JSON.stringify(journal));
    expect(codeOf(() => loadMigrations(folder))).toBe('JOURNAL_INVALID');
  });
});

describe('remote-test status, plan and apply (file stand-in)', () => {
  it('reports an empty target with every migration pending', async () => {
    const client = await scratchDatabase();
    const migrations = loadMigrations();
    const state = await readMigrationState(client, migrations);
    expect(state.ledgerPresent).toBe(false);
    expect(state.userTables).toEqual([]);
    expect(state.applied).toEqual([]);
    expect(state.pending.map((m) => m.tag)).toEqual(
      migrations.map((m) => m.tag)
    );
    expect(state.planId).toMatch(/^[0-9a-f]{12}$/);
  });

  it('applies pending migrations in order and a rerun is a no-op', async () => {
    const client = await scratchDatabase();
    const migrations = loadMigrations();
    const before = await readMigrationState(client, migrations);
    const result = await applyRemoteTestPlan(client, migrations, {
      host,
      confirmHost: host,
      planId: before.planId
    });
    expect(result.applied).toEqual(migrations.map((m) => m.tag));

    const ledger = await client.execute(
      'SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at'
    );
    expect(ledger.rows.map((r) => [r.hash, Number(r.created_at)])).toEqual(
      migrations.map((m) => [m.hash, m.when])
    );

    const after = await readMigrationState(client, migrations);
    expect(after.pending).toEqual([]);
    expect(after.userTables).toContain('users');
    const rerun = await applyRemoteTestPlan(client, migrations, {
      host,
      confirmHost: host,
      planId: after.planId
    });
    expect(rerun.applied).toEqual([]);
    const count = await client.execute(
      'SELECT count(*) AS n FROM __drizzle_migrations'
    );
    expect(Number(count.rows[0].n)).toBe(migrations.length);
  });

  it('continues from a prefix applied by the Drizzle migrator', async () => {
    const client = await scratchDatabase();
    const all = loadMigrations();
    const folder = await copyMigrations();
    const journalPath = join(folder, 'meta/_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    journal.entries = journal.entries.slice(0, 4);
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(drizzle(client), { migrationsFolder: folder });

    const state = await readMigrationState(client, all);
    expect(state.applied.map((m) => m.tag)).toEqual(
      all.slice(0, 4).map((m) => m.tag)
    );
    expect(state.pending.map((m) => m.tag)).toEqual([
      '0004_material_sway',
      '0005_auth_contract'
    ]);
    const result = await applyRemoteTestPlan(client, all, {
      host,
      confirmHost: host,
      planId: state.planId
    });
    expect(result.applied).toEqual([
      '0004_material_sway',
      '0005_auth_contract'
    ]);
  });

  it('treats a target already migrated by Drizzle as up to date', async () => {
    const client = await scratchDatabase();
    await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
    const state = await readMigrationState(client, loadMigrations());
    expect(state.pending).toEqual([]);
  });

  it('fails on a checksum mismatch in the applied ledger', async () => {
    const client = await scratchDatabase();
    const migrations = loadMigrations();
    const first = await readMigrationState(client, migrations);
    await applyRemoteTestPlan(client, migrations, {
      host,
      confirmHost: host,
      planId: first.planId
    });
    await client.execute({
      sql: 'UPDATE __drizzle_migrations SET hash = ? WHERE created_at = ?',
      args: ['0'.repeat(64), migrations[2].when]
    });
    expect(
      await asyncCodeOf(() => readMigrationState(client, migrations))
    ).toBe('LEDGER_DRIFT');
  });

  it('fails when an edited migration file no longer matches the ledger', async () => {
    const client = await scratchDatabase();
    await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
    const folder = await copyMigrations();
    const path = join(folder, '0003_review_invariants.sql');
    await writeFile(
      path,
      (await readFile(path, 'utf8')) + '\n-- edited after adoption\n'
    );
    expect(
      await asyncCodeOf(() =>
        readMigrationState(client, loadMigrations(folder))
      )
    ).toBe('LEDGER_DRIFT');
  });

  it('fails on ledger rows that are unknown to the journal', async () => {
    const client = await scratchDatabase();
    await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
    await client.execute({
      sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
      args: ['f'.repeat(64), 9_999_999_999_999]
    });
    expect(
      await asyncCodeOf(() => readMigrationState(client, loadMigrations()))
    ).toBe('LEDGER_DRIFT');
  });

  it('fails on tables without a ledger instead of guessing the schema state', async () => {
    const client = await scratchDatabase();
    await client.execute('CREATE TABLE unrelated (id integer primary key)');
    expect(
      await asyncCodeOf(() => readMigrationState(client, loadMigrations()))
    ).toBe('AMBIGUOUS_STATE');
  });

  it('refuses to apply without matching operator confirmation', async () => {
    const client = await scratchDatabase();
    const migrations = loadMigrations();
    const { planId } = await readMigrationState(client, migrations);
    expect(
      await asyncCodeOf(() =>
        applyRemoteTestPlan(client, migrations, {
          host,
          confirmHost: undefined,
          planId
        })
      )
    ).toBe('CONFIRMATION_REQUIRED');
    expect(
      await asyncCodeOf(() =>
        applyRemoteTestPlan(client, migrations, {
          host,
          confirmHost: 'other.turso.io',
          planId
        })
      )
    ).toBe('CONFIRMATION_MISMATCH');
    expect(
      await asyncCodeOf(() =>
        applyRemoteTestPlan(client, migrations, {
          host,
          confirmHost: host,
          planId: undefined
        })
      )
    ).toBe('CONFIRMATION_REQUIRED');
    expect(
      await asyncCodeOf(() =>
        applyRemoteTestPlan(client, migrations, {
          host,
          confirmHost: host,
          planId: 'abcdefabcdef'
        })
      )
    ).toBe('PLAN_CHANGED');
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    );
    expect(tables.rows).toEqual([]);
  });

  it('rolls back a failed apply completely and a corrected retry succeeds', async () => {
    const client = await scratchDatabase();
    const folder = await copyMigrations();
    const path = join(folder, '0005_auth_contract.sql');
    const original = await readFile(path, 'utf8');
    await writeFile(
      path,
      original +
        '\n--> statement-breakpoint\nCREATE TABLE users (broken integer);'
    );
    const broken = loadMigrations(folder);
    const first = await readMigrationState(client, broken);
    expect(
      await asyncCodeOf(() =>
        applyRemoteTestPlan(client, broken, {
          host,
          confirmHost: host,
          planId: first.planId
        })
      )
    ).toBe('APPLY_FAILED');
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    );
    expect(tables.rows).toEqual([]);

    const fixed = loadMigrations();
    const retry = await readMigrationState(client, fixed);
    expect(retry.pending).toHaveLength(fixed.length);
    const result = await applyRemoteTestPlan(client, fixed, {
      host,
      confirmHost: host,
      planId: retry.planId
    });
    expect(result.applied).toHaveLength(fixed.length);
  });

  it('refuses a stale plan when the ledger changed after review', async () => {
    const client = await scratchDatabase();
    const migrations: MigrationFile[] = loadMigrations();
    const reviewed = await readMigrationState(client, migrations);
    await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
    expect(
      await asyncCodeOf(() =>
        applyRemoteTestPlan(client, migrations, {
          host,
          confirmHost: host,
          planId: reviewed.planId
        })
      )
    ).toBe('PLAN_CHANGED');
  });
});

describe('remote-test CLI', () => {
  function capture() {
    const lines: string[] = [];
    return { lines, write: (line: string) => lines.push(line) };
  }

  it('rejects unknown commands and remote work without the explicit environment', async () => {
    for (const argv of [[], ['migrate'], ['apply', '--force']]) {
      const out = capture();
      expect(
        await runRemoteTestCli(argv, safeEnv, out.write, async () => {
          throw new Error('must not connect');
        })
      ).toBe(1);
    }
    const out = capture();
    expect(
      await runRemoteTestCli(
        ['status'],
        { ...safeEnv, LANGLO_MIGRATION_TARGET: undefined },
        out.write,
        async () => {
          throw new Error('must not connect');
        }
      )
    ).toBe(1);
    expect(out.lines.join('\n')).toContain('TARGET_CLASS_REQUIRED');
  });

  it('prints redacted status and plan output and never echoes the token', async () => {
    const url = await scratchUrl();
    const open = async () => createClient({ url });
    const client = track(createClient({ url }));
    const status = capture();
    expect(
      await runRemoteTestCli(['status'], safeEnv, status.write, open)
    ).toBe(0);
    const plan = capture();
    expect(await runRemoteTestCli(['plan'], safeEnv, plan.write, open)).toBe(0);
    const text = [...status.lines, ...plan.lines].join('\n');
    expect(text).toContain(host);
    expect(text).toContain('0005_auth_contract');
    expect(text).toMatch(/plan id: [0-9a-f]{12}/);
    expect(text).not.toContain('synthetic-token-not-a-secret');
    expect(text).not.toContain('libsql://');
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    );
    expect(tables.rows).toEqual([]);
  });

  it('applies only with --confirm-host and --plan-id from the reviewed plan', async () => {
    const url = await scratchUrl();
    const open = async () => createClient({ url });
    const client = track(createClient({ url }));
    const denied = capture();
    expect(await runRemoteTestCli(['apply'], safeEnv, denied.write, open)).toBe(
      1
    );
    expect(denied.lines.join('\n')).toContain('CONFIRMATION_REQUIRED');

    const { planId } = await readMigrationState(client, loadMigrations());
    const ok = capture();
    expect(
      await runRemoteTestCli(
        ['apply', '--confirm-host', host, '--plan-id', planId],
        safeEnv,
        ok.write,
        open
      )
    ).toBe(0);
    expect(ok.lines.join('\n')).toContain('applied 6 migration(s)');
  });

  it('reports a fixed message when the connection fails, without wrapped error text', async () => {
    const out = capture();
    const code = await runRemoteTestCli(
      ['status'],
      safeEnv,
      out.write,
      async () => {
        throw new Error(
          `connect failed for libsql://${host}?authToken=leaked-secret`
        );
      }
    );
    expect(code).toBe(1);
    expect(out.lines.join('\n')).not.toContain('leaked-secret');
    expect(out.lines.join('\n')).toContain('CONNECTION_FAILED');
  });
});

describe('fixture migrator stays fixture-only', () => {
  it('rejects the remote-test target even with a valid disposable fixture root', async () => {
    const fixture = await createDisposableFixture();
    try {
      await expect(
        migrateFixtureDatabase({
          fixtureRoot: fixture.fixtureRoot,
          databaseUrl: safeEnv.DATABASE_URL
        })
      ).rejects.toThrow('Invalid disposable fixture');
    } finally {
      await disposeDisposableFixture(fixture);
    }
  });
});
