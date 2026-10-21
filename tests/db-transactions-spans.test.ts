import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';

type Recorded = {
  name: string;
  attributes?: Record<string, unknown>;
  set: Record<string, unknown>;
  ended: boolean;
};
const recorded = vi.hoisted<Recorded[]>(() => []);

vi.mock('@sentry/sveltekit', () => ({
  startSpan: (
    options: { name: string; attributes?: Record<string, unknown> },
    run: (active: { setAttribute: (k: string, v: unknown) => void }) => unknown
  ) => {
    const entry: Recorded = {
      name: options.name,
      attributes: options.attributes,
      set: {},
      ended: false
    };
    recorded.push(entry);
    const result = run({
      setAttribute: (key, value) => {
        entry.set[key] = value;
      }
    });
    const finish = () => {
      entry.ended = true;
    };
    Promise.resolve(result).then(finish, finish);
    return result;
  }
}));

import {
  beginRead,
  beginWrite,
  executeWrite
} from '../src/lib/server/db-transactions';

let client: Client;
beforeEach(async () => {
  recorded.length = 0;
  client = createClient({ url: ':memory:' });
  await client.execute('CREATE TABLE probe (id INTEGER PRIMARY KEY)');
});
afterEach(() => {
  vi.useRealTimers();
  client.close();
});

const named = (name: string) => recorded.filter((entry) => entry.name === name);
const settle = () => new Promise((resolve) => setImmediate(resolve));

it('times a write transaction and reports its round trips when it commits', async () => {
  const tx = await beginWrite(client);
  await tx.execute('INSERT INTO probe (id) VALUES (1)');
  await tx.execute('INSERT INTO probe (id) VALUES (2)');
  await tx.execute('SELECT id FROM probe');
  const [open] = named('db.transaction');
  expect(open.attributes).toEqual({ write: true });
  expect(open.ended).toBe(false);
  await tx.commit();
  await settle();
  expect(named('db.transaction')).toHaveLength(1);
  expect(open.set).toEqual({ round_trips: 3 });
  expect(open.ended).toBe(true);
});

it('counts a batch as one round trip', async () => {
  const tx = await beginWrite(client);
  await tx.batch([
    'INSERT INTO probe (id) VALUES (1)',
    'INSERT INTO probe (id) VALUES (2)'
  ]);
  await tx.commit();
  await settle();
  expect(named('db.transaction')[0].set).toEqual({ round_trips: 1 });
});

it('marks a read transaction as not a write', async () => {
  const tx = await beginRead(client);
  await tx.execute('SELECT id FROM probe');
  await tx.commit();
  await settle();
  const [read] = named('db.transaction');
  expect(read.attributes).toEqual({ write: false });
  expect(read.set).toEqual({ round_trips: 1 });
});

it('ends the transaction span on rollback and on close without commit', async () => {
  const rolledBack = await beginWrite(client);
  await rolledBack.execute('INSERT INTO probe (id) VALUES (1)');
  await rolledBack.rollback();
  const closed = await beginWrite(client);
  closed.close();
  await settle();
  const [first, second] = named('db.transaction');
  expect(first.set).toEqual({ round_trips: 1 });
  expect(first.ended).toBe(true);
  expect(second.set).toEqual({ round_trips: 0 });
  expect(second.ended).toBe(true);
});

it('records no queue wait when the connection is free', async () => {
  const tx = await beginWrite(client);
  await tx.commit();
  await executeWrite(client, 'INSERT INTO probe (id) VALUES (1)');
  expect(named('db.queue-wait')).toEqual([]);
});

it('records a queue wait with the number of waiters already ahead', async () => {
  const holder = await beginWrite(client);
  const second = beginRead(client);
  const third = beginRead(client);
  await settle();
  const waits = named('db.queue-wait');
  expect(waits.map((entry) => entry.attributes)).toEqual([
    { waiters: 0 },
    { waiters: 1 }
  ]);
  expect(waits.map((entry) => entry.ended)).toEqual([false, false]);
  await holder.commit();
  const secondTx = await second;
  await secondTx.commit();
  const thirdTx = await third;
  await thirdTx.commit();
  await settle();
  expect(waits.map((entry) => entry.ended)).toEqual([true, true]);
  expect(named('db.transaction')).toHaveLength(3);
});

it('fails the queue-wait span with the busy error when the wait times out', async () => {
  vi.useFakeTimers();
  const holder = await beginWrite(client);
  const waiting = beginRead(client);
  const rejection = expect(waiting).rejects.toMatchObject({
    code: 'SQLITE_BUSY'
  });
  await vi.advanceTimersByTimeAsync(5000);
  await rejection;
  expect(named('db.queue-wait')).toHaveLength(1);
  expect(named('db.queue-wait')[0].ended).toBe(true);
  expect(named('db.transaction')).toHaveLength(1);
  await holder.rollback();
});
