import { runFixtureCli } from './fixtures/run-cli';
import { afterEach, expect, it } from 'vitest';
import {
  createDisposableFixture,
  disposeDisposableFixture
} from './fixtures/database';
import {
  openFixtureDatabase,
  type FixtureTarget
} from '../src/lib/server/db/connection';

const fixtures: FixtureTarget[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(disposeDisposableFixture));
});
/** Pass the fixture's explicit root and URL to the CLI instead of relying on ambient database configuration. */
function argumentsFor(target: FixtureTarget) {
  return [
    '--fixture-root',
    target.fixtureRoot,
    '--database-url',
    target.databaseUrl
  ];
}

it('explicit CLI init/migrate/seed/reset/dispose executes against actual local storage', async () => {
  const initialized = await runFixtureCli('init');
  const target: FixtureTarget = JSON.parse(initialized.stdout);
  fixtures.push(target);
  for (const command of ['migrate', 'migrate', 'seed', 'seed']) {
    await runFixtureCli(command, argumentsFor(target));
  }
  const seeded = await openFixtureDatabase(target);
  try {
    expect(
      (await seeded.client.execute('SELECT count(*) AS count FROM attempts'))
        .rows[0].count
    ).toBe(1);
  } finally {
    seeded.close();
  }
  await runFixtureCli('reset', argumentsFor(target));
  const reset = await openFixtureDatabase(target);
  try {
    expect(
      (
        await reset.client.execute(
          "SELECT name FROM sqlite_master WHERE type='table'"
        )
      ).rows
    ).toEqual([]);
  } finally {
    reset.close();
  }
  await runFixtureCli('dispose', argumentsFor(target));
  fixtures.pop();
}, 15000);

it('CLI rejects a production URL, missing explicit target and unknown commands without ambient fallback', async () => {
  const target = await createDisposableFixture();
  fixtures.push(target);
  const env = {
    ...process.env,
    DATABASE_URL: 'libsql://production.turso.io',
    TURSO_AUTH_TOKEN_2: 'synthetic-secret-do-not-log'
  };
  for (const args of [
    ['migrate'],
    [
      'reset',
      '--fixture-root',
      target.fixtureRoot,
      '--database-url',
      env.DATABASE_URL
    ],
    ['unknown', ...argumentsFor(target)]
  ]) {
    let failure: { code: number; stderr: string } | undefined;
    try {
      await runFixtureCli(args[0], args.slice(1), { env });
    } catch (error) {
      failure = error as { code: number; stderr: string };
    }
    expect(failure).toMatchObject({ code: 1 });
    expect(failure?.stderr).not.toContain(env.TURSO_AUTH_TOKEN_2);
    expect(failure?.stderr).not.toContain(env.DATABASE_URL);
  }
}, 15000);

it('SQL-only seed cold startup does not load Drizzle or the full schema graph', async () => {
  const target = await createDisposableFixture();
  fixtures.push(target);
  const { migrateFixtureDatabase } =
    await import('../src/lib/server/db/migrate');
  await migrateFixtureDatabase(target);
  const result = await runFixtureCli('seed', argumentsFor(target), {
    nodeArgs: ['--import', './tests/fixtures/forbid-orm-loader.ts']
  });
  expect(result.stdout).toContain('Disposable fixture seed completed');
  const { client, close } = await openFixtureDatabase(target);
  try {
    expect(
      (await client.execute('SELECT count(*) AS count FROM attempts')).rows[0]
        .count
    ).toBe(1);
    expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual([]);
  } finally {
    close();
  }
}, 10000);

it('subprocess timeout reports bounded safe diagnostics without target or ambient secrets', async () => {
  const target = await createDisposableFixture();
  fixtures.push(target);
  let failure:
    | (Error & { elapsedMs: number; killed: boolean; signal: string })
    | undefined;
  try {
    await runFixtureCli('seed', argumentsFor(target), {
      env: { ...process.env, TURSO_AUTH_TOKEN_2: 'synthetic-do-not-log' },
      nodeArgs: ['--eval', 'setTimeout(() => {}, 60000)'],
      timeout: 50
    });
  } catch (caught) {
    failure = caught as typeof failure;
  }
  expect(failure).toMatchObject({ killed: true, signal: 'SIGTERM' });
  expect(failure?.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(failure?.message).toContain('subprocess failed');
  expect(failure?.message).not.toContain(target.fixtureRoot);
  expect(failure?.message).not.toContain(target.databaseUrl);
  expect(failure?.message).not.toContain('synthetic-do-not-log');
}, 10000);
