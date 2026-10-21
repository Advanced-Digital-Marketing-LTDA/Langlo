import { spawnSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client';

const created = vi.hoisted<Array<{ url: string; client: unknown }>>(() => []);

vi.mock('@libsql/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@libsql/client')>();
  return {
    ...actual,
    // Remote URLs would open a network connection; hand back a stub instead.
    createClient: (options: { url: string }) => {
      if (!/^(libsql|https?|wss?):/.test(options.url))
        return actual.createClient(options as never);
      const client = stubClient();
      created.push({ url: options.url, client });
      return client;
    }
  };
});

import { openAppDatabase } from '../src/lib/server/db/app';
import { beginRead, beginWrite } from '../src/lib/server/db-transactions';
import type { RuntimeConfig } from '../src/lib/server/config';

function stubClient() {
  return {
    execute: vi.fn(async () => ({ rows: [], rowsAffected: 0 })),
    close: vi.fn(),
    transaction: vi.fn(async () => ({
      closed: false,
      execute: vi.fn(),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
      close: vi.fn()
    }))
  } as unknown as Client & { transaction: ReturnType<typeof vi.fn> };
}

const config = (databaseUrl: string): RuntimeConfig => ({
  environment: 'test',
  origin: 'http://localhost',
  dataEnabled: true,
  databaseUrl,
  databaseToken: databaseUrl,
  revision: 'test'
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Resolves true if the promise settles within a macrotask, false if still pending. */
async function settles(promise: Promise<unknown>) {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true)
  );
  await settle();
  return done;
}

afterEach(() => {
  created.length = 0;
});

it('opens a read transaction beside an open write transaction on a remote database', async () => {
  const { client } = await openAppDatabase(
    config('libsql://remote-reads.test')
  );
  const writer = await beginWrite(client);
  const reading = beginRead(client);
  expect(await settles(reading)).toBe(true);
  const reader = await reading;
  expect(client.transaction).toHaveBeenNthCalledWith(1, 'write');
  expect(client.transaction).toHaveBeenNthCalledWith(2, 'read');
  await reader.commit();
  await writer.commit();
});

it('still queues a second write behind an open write on a remote database', async () => {
  const { client } = await openAppDatabase(
    config('https://remote-writes.test')
  );
  const first = await beginWrite(client);
  const second = beginWrite(client);
  expect(await settles(second)).toBe(false);
  expect(client.transaction).toHaveBeenCalledTimes(1);
  await first.commit();
  const secondTx = await second;
  expect(client.transaction).toHaveBeenCalledTimes(2);
  await secondTx.commit();
});

it('does not make a write wait for an open read on a remote database', async () => {
  const { client } = await openAppDatabase(
    config('wss://read-then-write.test')
  );
  const reader = await beginRead(client);
  const writing = beginWrite(client);
  expect(await settles(writing)).toBe(true);
  await (await writing).commit();
  await reader.commit();
});

it('keeps a read waiting behind a write on a local database', async () => {
  const { client } = await openAppDatabase(config(':memory:'));
  const writer = await beginWrite(client);
  const reading = beginRead(client);
  expect(await settles(reading)).toBe(false);
  await writer.commit();
  await (await reading).commit();
});

it('does not treat a client it did not mark as remote', async () => {
  const { client: remote } = await openAppDatabase(
    config('libsql://marked-only.test')
  );
  const unmarked = stubClient();
  const writer = await beginWrite(unmarked);
  const reading = beginRead(unmarked);
  expect(await settles(reading)).toBe(false);
  await writer.commit();
  await (await reading).commit();
  expect(remote).not.toBe(unmarked);
});

it('keeps the app database module loadable by plain Node scripts', () => {
  // Scripts such as accounts-provision run under Node, not Vite, so this module
  // must not pull in extensionless or SvelteKit-only imports.
  const result = spawnSync(
    process.execPath,
    ['-e', "import('./src/lib/server/db/app.ts')"],
    { encoding: 'utf8' }
  );
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});
