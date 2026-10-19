import { afterEach, expect, it } from 'vitest';
import type { RuntimeConfig } from '../src/lib/server/config';
import { openAppDatabase } from '../src/lib/server/db/app';
import { beginWrite } from '../src/lib/server/flashcards';

const opened: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const database of opened.splice(0)) database.close();
});

it('keeps foreign keys enabled and accepts concurrent writes through a shared client', async () => {
  const config: RuntimeConfig = {
    environment: 'test',
    origin: 'http://localhost',
    dataEnabled: true,
    databaseUrl: ':memory:',
    databaseToken: 'shared-client-test',
    revision: 'test'
  };
  const [first, second] = await Promise.all([
    openAppDatabase(config),
    openAppDatabase(config)
  ]);
  opened.push(first, second);

  expect(second.client).toBe(first.client);
  expect(
    (await first.client.execute('PRAGMA foreign_keys')).rows[0]
  ).toMatchObject({
    foreign_keys: 1
  });

  await first.client.execute(
    'CREATE TABLE shared_write_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)'
  );
  first.close();
  await second.client.execute({
    sql: 'INSERT INTO shared_write_probe (id, value) VALUES (?, ?)',
    args: [0, 'sequential request']
  });

  await second.client.execute(`CREATE TRIGGER reject_shared_write
    BEFORE INSERT ON shared_write_probe WHEN NEW.id = 99
    BEGIN SELECT RAISE(ABORT, 'intentional failure'); END`);
  const insert = async (id: number) => {
    const tx = await beginWrite(second.client);
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
  };

  await expect(insert(99)).rejects.toThrow('intentional failure');
  await second.client.execute('DROP TRIGGER reject_shared_write');

  await second.client.execute(
    'CREATE TABLE commit_parent (id INTEGER PRIMARY KEY)'
  );
  await second.client.execute(`CREATE TABLE commit_child (
    parent_id INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED
  )`);
  const rejectedCommit = async () => {
    const tx = await beginWrite(second.client);
    try {
      await tx.execute('INSERT INTO commit_child (parent_id) VALUES (99)');
      await tx.commit();
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw error;
    } finally {
      tx.close();
    }
  };
  await expect(rejectedCommit()).rejects.toThrow(
    'FOREIGN KEY constraint failed'
  );

  const afterRejectedCommit = await beginWrite(second.client);
  await afterRejectedCommit.execute(
    'INSERT INTO commit_parent (id) VALUES (1)'
  );
  await afterRejectedCommit.commit();
  afterRejectedCommit.close();

  const results = await Promise.allSettled(
    Array.from({ length: 6 }, (_, id) => insert(id + 1))
  );
  expect(
    results.filter((result) => result.status === 'fulfilled')
  ).toHaveLength(6);

  expect(
    (
      await second.client.execute(
        'SELECT COUNT(*) AS count FROM shared_write_probe'
      )
    ).rows[0].count
  ).toBe(7);
});
