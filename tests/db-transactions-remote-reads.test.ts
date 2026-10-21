import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client';

const spans = vi.hoisted<string[]>(() => []);
const created = vi.hoisted<Array<{ url: string; client: unknown }>>(() => []);

vi.mock('@sentry/sveltekit', () => ({
  startSpan: (
    options: { name: string },
    run: (active: { setAttribute(): void }) => unknown
  ) => {
    spans.push(options.name);
    return run({ setAttribute: () => undefined });
  }
}));

vi.mock('@libsql/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@libsql/client')>();
  const { isRemoteDatabaseUrl } =
    await import('../src/lib/server/remote-clients.ts');
  return {
    ...actual,
    // Remote URLs would open a network connection; hand back a stub instead.
    createClient: (options: { url: string }) => {
      if (!isRemoteDatabaseUrl(options.url))
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
  spans.length = 0;
});

const remoteUrls = [
  'libsql://remote-reads.test',
  'http://remote-reads.test',
  'https://remote-reads.test',
  'ws://remote-reads.test',
  'wss://remote-reads.test'
];

it.each(remoteUrls)(
  'opens a read transaction beside an open write transaction on %s',
  async (url) => {
    const { client } = await openAppDatabase(config(url));
    const writer = await beginWrite(client);
    const reading = beginRead(client);
    expect(await settles(reading)).toBe(true);
    const reader = await reading;
    expect(client.transaction).toHaveBeenNthCalledWith(1, 'write');
    expect(client.transaction).toHaveBeenNthCalledWith(2, 'read');
    await reader.commit();
    await writer.commit();
  }
);

it('times a remote read as a transaction without recording a queue wait', async () => {
  const { client } = await openAppDatabase(config('libsql://spans.test'));
  const writer = await beginWrite(client);
  await (await beginRead(client)).commit();
  await writer.commit();
  expect(spans).toEqual(['db.transaction', 'db.transaction']);
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

const localUrl = async (kind: string) => {
  if (kind === 'memory') return { url: ':memory:' };
  const dir = await mkdtemp(join(tmpdir(), 'langlo-local-queue-'));
  return { url: `file:${join(dir, 'probe.db')}`, dir };
};

it.each(['memory', 'file'])(
  'keeps a read waiting behind a write on a local %s database',
  async (kind) => {
    const { url, dir } = await localUrl(kind);
    try {
      const { client } = await openAppDatabase(config(url));
      const writer = await beginWrite(client);
      const reading = beginRead(client);
      expect(await settles(reading)).toBe(false);
      expect(spans).toContain('db.queue-wait');
      await writer.commit();
      await (await reading).commit();
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  }
);

it('does not treat a client it did not mark as remote', async () => {
  const unmarked = stubClient();
  const writer = await beginWrite(unmarked);
  const reading = beginRead(unmarked);
  expect(await settles(reading)).toBe(false);
  await writer.commit();
  await (await reading).commit();
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
