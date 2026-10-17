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
import { createClient, type Client, type InStatement } from '@libsql/client';
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

/** The same client, with `migrate` replaced to simulate races and lost responses. */
function wrapMigrate(
  client: Client,
  migrate: (statements: InStatement[]) => Promise<void>
): Client {
  return new Proxy(client, {
    get(target, key, receiver) {
      if (key === 'migrate') return migrate;
      const value = Reflect.get(target, key, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
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

  it.each([
    'libsql://[0:0:0:0:0:0:0:1]',
    'libsql://[::ffff:127.0.0.1]',
    'libsql://2130706433',
    'libsql://127.1',
    'libsql://0x7f.1',
    'libsql://LOCALHOST',
    'libsql://db.localhost',
    'libsql://10.0.0.5'
  ])('rejects IP-literal or local host %s before any connection', (url) => {
    expect(
      codeOf(() => parseRemoteTestTarget({ ...safeEnv, DATABASE_URL: url }))
    ).toBe('TARGET_INVALID');
  });

  it.each([
    'libsql://database.turso.io.attacker.example',
    'libsql://langlo-pilot-test.example.com',
    'libsql://evilturso.io',
    'libsql://turso.io'
  ])('rejects non-Turso host %s before the token is sent', (url) => {
    expect(
      codeOf(() => parseRemoteTestTarget({ ...safeEnv, DATABASE_URL: url }))
    ).toBe('TARGET_INVALID');
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
      '0005_auth_contract',
      '0006_content_version_ledger',
      '0007_content_payload_fingerprint',
      '0008_question_holdouts',
      '0009_question_payload',
      '0010_lessons_and_pause',
      '0011_one_independent_attempt',
      '0012_ai_usage',
      '0013_assessment_feedback',
      '0014_content_reports'
    ]);
    const whens = migrations.map((m) => m.when);
    expect([...whens].sort((a, b) => a - b)).toEqual(whens);
    expect(migrations.every((m) => /^[0-9a-f]{64}$/u.test(m.hash))).toBe(true);
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
    const state = await readMigrationState(client, migrations, host);
    expect(state.ledgerPresent).toBe(false);
    expect(state.userTables).toEqual([]);
    expect(state.applied).toEqual([]);
    expect(state.pending.map((m) => m.tag)).toEqual(
      migrations.map((m) => m.tag)
    );
    expect(state.planId).toMatch(/^[0-9a-f]{12}$/u);
  });

  it('applies pending migrations in order and a rerun is a no-op', async () => {
    const client = await scratchDatabase();
    const migrations = loadMigrations();
    const before = await readMigrationState(client, migrations, host);
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

    const after = await readMigrationState(client, migrations, host);
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

    const state = await readMigrationState(client, all, host);
    expect(state.applied.map((m) => m.tag)).toEqual(
      all.slice(0, 4).map((m) => m.tag)
    );
    expect(state.pending.map((m) => m.tag)).toEqual([
      '0004_material_sway',
      '0005_auth_contract',
      '0006_content_version_ledger',
      '0007_content_payload_fingerprint',
      '0008_question_holdouts',
      '0009_question_payload',
      '0010_lessons_and_pause',
      '0011_one_independent_attempt',
      '0012_ai_usage',
      '0013_assessment_feedback',
      '0014_content_reports'
    ]);
    const result = await applyRemoteTestPlan(client, all, {
      host,
      confirmHost: host,
      planId: state.planId
    });
    expect(result.applied).toEqual([
      '0004_material_sway',
      '0005_auth_contract',
      '0006_content_version_ledger',
      '0007_content_payload_fingerprint',
      '0008_question_holdouts',
      '0009_question_payload',
      '0010_lessons_and_pause',
      '0011_one_independent_attempt',
      '0012_ai_usage',
      '0013_assessment_feedback',
      '0014_content_reports'
    ]);
  });

  it('treats a target already migrated by Drizzle as up to date', async () => {
    const client = await scratchDatabase();
    await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
    const state = await readMigrationState(client, loadMigrations(), host);
    expect(state.pending).toEqual([]);
  });

  it('fails on a checksum mismatch in the applied ledger', async () => {
    const client = await scratchDatabase();
    const migrations = loadMigrations();
    const first = await readMigrationState(client, migrations, host);
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
      await asyncCodeOf(() => readMigrationState(client, migrations, host))
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
        readMigrationState(client, loadMigrations(folder), host)
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
      await asyncCodeOf(() =>
        readMigrationState(client, loadMigrations(), host)
      )
    ).toBe('LEDGER_DRIFT');
  });

  it('fails on tables without a ledger instead of guessing the schema state', async () => {
    const client = await scratchDatabase();
    await client.execute('CREATE TABLE unrelated (id integer primary key)');
    expect(
      await asyncCodeOf(() =>
        readMigrationState(client, loadMigrations(), host)
      )
    ).toBe('AMBIGUOUS_STATE');
  });

  it('binds the plan id to the target host', async () => {
    const client = await scratchDatabase();
    const migrations = loadMigrations();
    const other = 'langlo-other-test.aws-eu-west-1.turso.io';
    const { planId } = await readMigrationState(client, migrations, other);
    expect(
      (await readMigrationState(client, migrations, host)).planId
    ).not.toBe(planId);
    expect(
      await asyncCodeOf(() =>
        applyRemoteTestPlan(client, migrations, {
          host,
          confirmHost: host,
          planId
        })
      )
    ).toBe('PLAN_CHANGED');
    expect(
      (await readMigrationState(client, migrations, host)).applied
    ).toEqual([]);
  });

  it('refuses to apply without matching operator confirmation', async () => {
    const client = await scratchDatabase();
    const migrations = loadMigrations();
    const { planId } = await readMigrationState(client, migrations, host);
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
    const first = await readMigrationState(client, broken, host);
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
    const retry = await readMigrationState(client, fixed, host);
    expect(retry.pending).toHaveLength(fixed.length);
    const result = await applyRemoteTestPlan(client, fixed, {
      host,
      confirmHost: host,
      planId: retry.planId
    });
    expect(result.applied).toHaveLength(fixed.length);
  });

  it.each([
    [
      'a ledger row is rewritten',
      `UPDATE __drizzle_migrations SET hash = '${'0'.repeat(64)}' WHERE rowid = 1`
    ],
    ['a table is added', 'CREATE TABLE concurrent_writer (id integer)'],
    ['a table is renamed', 'ALTER TABLE attempts RENAME TO attempts_moved']
  ])(
    'aborts the batch when %s between the plan check and the transaction',
    async (_name, mutation) => {
      const client = await scratchDatabase();
      const all = loadMigrations();
      const folder = await copyMigrations();
      const journalPath = join(folder, 'meta/_journal.json');
      const journal = JSON.parse(await readFile(journalPath, 'utf8'));
      journal.entries = journal.entries.slice(0, 4);
      await writeFile(journalPath, JSON.stringify(journal));
      await migrate(drizzle(client), { migrationsFolder: folder });
      const { planId } = await readMigrationState(client, all, host);
      const racing = wrapMigrate(client, async (statements) => {
        await client.execute(mutation);
        await client.migrate(statements);
      });
      expect(
        await asyncCodeOf(() =>
          applyRemoteTestPlan(racing, all, { host, confirmHost: host, planId })
        )
      ).toBe('APPLY_FAILED');
      const ledger = await client.execute(
        'SELECT count(*) AS n FROM __drizzle_migrations'
      );
      expect(Number(ledger.rows[0].n)).toBe(4);
    }
  );

  it('changes the plan id when a pending migration timestamp changes', async () => {
    const client = await scratchDatabase();
    const folder = await copyMigrations();
    const before = await readMigrationState(
      client,
      loadMigrations(folder),
      host
    );
    const journalPath = join(folder, 'meta/_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    journal.entries[5].when += 1;
    await writeFile(journalPath, JSON.stringify(journal));
    const after = await readMigrationState(
      client,
      loadMigrations(folder),
      host
    );
    expect(after.planId).not.toBe(before.planId);
  });

  it('refuses a stale plan when the ledger changed after review', async () => {
    const client = await scratchDatabase();
    const migrations: MigrationFile[] = loadMigrations();
    const reviewed = await readMigrationState(client, migrations, host);
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
    expect(text).toMatch(/plan id: [0-9a-f]{12}/u);
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

    const { planId } = await readMigrationState(client, loadMigrations(), host);
    const ok = capture();
    expect(
      await runRemoteTestCli(
        ['apply', '--confirm-host', host, '--plan-id', planId],
        safeEnv,
        ok.write,
        open
      )
    ).toBe(0);
    expect(ok.lines.join('\n')).toContain('applied 15 migration(s)');
  });

  it('prints table names from the target without control characters', async () => {
    const url = await scratchUrl();
    const setup = track(createClient({ url }));
    await migrate(drizzle(setup), { migrationsFolder: 'drizzle' });
    await setup.execute(
      'CREATE TABLE "evil\nledger: present\u001b[2J" (id integer)'
    );
    const out = capture();
    await runRemoteTestCli(['status'], safeEnv, out.write, async () =>
      createClient({ url })
    );
    const text = out.lines.join('\n');
    expect(text).not.toContain('\u001b');
    expect(
      text.split('\n').filter((line) => line.startsWith('ledger:'))
    ).toHaveLength(1);
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

  it('reports CONNECTION_FAILED when a lazy client fails on its first query', async () => {
    const out = capture();
    const lazy = {
      execute: async () => {
        throw new Error(`401 for libsql://${host} token leaked-secret`);
      },
      close: () => {}
    } as unknown as Client;
    const code = await runRemoteTestCli(
      ['status'],
      safeEnv,
      out.write,
      async () => lazy
    );
    expect(code).toBe(1);
    expect(out.lines.join('\n')).not.toContain('leaked-secret');
    expect(out.lines.join('\n')).toContain('CONNECTION_FAILED');
  });

  it('reports an unknown apply outcome and asks for status when the batch errors', async () => {
    const client = await scratchDatabase();
    const all = loadMigrations();
    const { planId } = await readMigrationState(client, all, host);
    const dropped = wrapMigrate(client, async (statements) => {
      await client.migrate(statements);
      throw new Error('connection reset after commit');
    });
    const error = await applyRemoteTestPlan(dropped, all, {
      host,
      confirmHost: host,
      planId
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RemoteMigrationError);
    expect((error as Error).message).toContain('run status');
    expect((error as Error).message).not.toContain('nothing was applied');
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
