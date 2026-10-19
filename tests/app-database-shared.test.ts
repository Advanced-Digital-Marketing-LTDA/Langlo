import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client';
import type { RuntimeConfig } from '../src/lib/server/config';
import { openAppDatabase } from '../src/lib/server/db/app';
import { beginWrite, executeWrite } from '../src/lib/server/flashcards';
import {
  createDisposableFixture,
  disposeDisposableFixture
} from './fixtures/database';
import type { FixtureTarget } from '../src/lib/server/db/fixture-target';

const opened: Client[] = [];
const fixtures: FixtureTarget[] = [];

afterEach(async () => {
  for (const client of opened.splice(0)) client.close();
  for (const target of fixtures.splice(0))
    await disposeDisposableFixture(target);
});

async function openShared(databaseUrl = ':memory:') {
  const config: RuntimeConfig = {
    environment: 'test',
    origin: 'http://localhost',
    dataEnabled: true,
    databaseUrl,
    databaseToken: randomUUID(),
    revision: 'test'
  };
  const [first, second] = await Promise.all([
    openAppDatabase(config),
    openAppDatabase(config)
  ]);
  opened.push(first.client);
  await first.client.execute(
    'CREATE TABLE shared_write_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)'
  );
  return { first, second, client: second.client };
}

async function insert(client: Client, id: number) {
  const tx = await beginWrite(client);
  try {
    await tx.execute({
      sql: 'INSERT INTO shared_write_probe (id, value) VALUES (?, ?)',
      args: [id, 'transactional request']
    });
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  } finally {
    tx.close();
  }
}

it('shares initialized clients and keeps request cleanup from closing them', async () => {
  const { first, second, client } = await openShared();
  expect(second.client).toBe(first.client);
  expect((await client.execute('PRAGMA foreign_keys')).rows[0]).toMatchObject({
    foreign_keys: 1
  });
  first.close();
  await insert(client, 0);
  expect(
    (await client.execute('SELECT id FROM shared_write_probe')).rows
  ).toEqual([{ id: 0 }]);
});

it('serializes concurrent transactions and releases failed statements', async () => {
  const { client } = await openShared();
  await client.execute(`CREATE TRIGGER reject_shared_write
    BEFORE INSERT ON shared_write_probe WHEN NEW.id = 99
    BEGIN SELECT RAISE(ABORT, 'intentional failure'); END`);
  await expect(insert(client, 99)).rejects.toThrow('intentional failure');
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, (_, id) => insert(client, id + 1))
  );
  expect(
    results.filter((result) => result.status === 'fulfilled')
  ).toHaveLength(6);
  expect(
    (await client.execute('SELECT COUNT(*) AS count FROM shared_write_probe'))
      .rows[0].count
  ).toBe(6);
});

it('rolls back a failed commit before releasing the next transaction', async () => {
  const { client } = await openShared();
  await client.execute('CREATE TABLE commit_parent (id INTEGER PRIMARY KEY)');
  await client.execute(`CREATE TABLE commit_child (
    parent_id INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED
  )`);
  const rejected = await beginWrite(client);
  await rejected.execute('INSERT INTO commit_child (parent_id) VALUES (99)');
  await expect(rejected.commit()).rejects.toThrow(
    'FOREIGN KEY constraint failed'
  );
  rejected.close();
  const next = await beginWrite(client);
  await next.execute('INSERT INTO commit_parent (id) VALUES (1)');
  await next.commit();
  next.close();
  expect((await client.execute('SELECT * FROM commit_child')).rows).toEqual([]);
});

it('keeps a queued standalone write outside the preceding rollback', async () => {
  const { client } = await openShared();
  const held = await beginWrite(client);
  await held.execute(
    "INSERT INTO shared_write_probe (id, value) VALUES (100, 'rolled back')"
  );
  const queued = executeWrite(client, {
    sql: 'INSERT INTO shared_write_probe (id, value) VALUES (?, ?)',
    args: [101, 'standalone request']
  });
  await held.rollback();
  held.close();
  await queued;
  expect(
    (await client.execute('SELECT id FROM shared_write_probe ORDER BY id')).rows
  ).toEqual([{ id: 101 }]);
});

it('keeps file-client reads isolated from an open transaction', async () => {
  const target = await createDisposableFixture();
  fixtures.push(target);
  const { client } = await openShared(target.databaseUrl);
  await executeWrite(
    client,
    "INSERT INTO shared_write_probe VALUES (1, 'committed')"
  );
  const held = await beginWrite(client);
  try {
    await held.execute(
      "UPDATE shared_write_probe SET value = 'uncommitted' WHERE id = 1"
    );
    expect(
      (await client.execute('SELECT value FROM shared_write_probe')).rows
    ).toEqual([{ value: 'committed' }]);
  } finally {
    await held.rollback();
    held.close();
  }
  expect(
    (await client.execute('SELECT value FROM shared_write_probe')).rows
  ).toEqual([{ value: 'committed' }]);
});

it('times out a queued writer without releasing the active transaction', async () => {
  const { client } = await openShared();
  const held = await beginWrite(client);
  vi.useFakeTimers();
  try {
    const rejected = executeWrite(
      client,
      "INSERT INTO shared_write_probe VALUES (1, 'cancelled')"
    ).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await rejected).toMatchObject({ code: 'SQLITE_BUSY' });
    const next = executeWrite(
      client,
      "INSERT INTO shared_write_probe VALUES (2, 'committed')"
    );
    await held.rollback();
    held.close();
    await next;
    expect(
      (await client.execute('SELECT id FROM shared_write_probe')).rows
    ).toEqual([{ id: 2 }]);
  } finally {
    held.close();
    vi.useRealTimers();
  }
});
