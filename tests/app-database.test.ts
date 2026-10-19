import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeConfig } from '../src/lib/server/config';

const state = vi.hoisted(() => ({
  executed: [] as { url: string; sql: string }[],
  clients: [] as { url: string }[],
  closed: 0,
  failNext: false
}));

vi.mock('@libsql/client', () => ({
  createClient: ({ url }: { url: string }) => {
    state.clients.push({ url });
    return {
      execute: async (sql: string) => {
        state.executed.push({ url, sql });
        if (state.failNext) {
          state.failNext = false;
          throw new Error('synthetic connection setup failure');
        }
        return { rows: [] };
      },
      close: () => {
        state.closed += 1;
      }
    };
  }
}));

const { openAppDatabase } = await import('../src/lib/server/db/app');

const remote: RuntimeConfig = {
  environment: 'production',
  origin: 'https://langlo.example.org',
  dataEnabled: true,
  databaseUrl: 'libsql://shared-test.turso.io',
  databaseToken: 'synthetic-token',
  revision: 'unknown'
};

describe('openAppDatabase', () => {
  beforeEach(() => {
    state.executed.length = 0;
    state.clients.length = 0;
    state.closed = 0;
    state.failNext = false;
  });

  it('reuses one client and setup across requests without closing the shared client', async () => {
    const config = { ...remote, databaseUrl: `${remote.databaseUrl}/reuse` };
    const [first, second] = await Promise.all([
      openAppDatabase(config),
      openAppDatabase(config)
    ]);

    expect(second.client).toBe(first.client);
    expect(state.clients).toHaveLength(1);
    expect(state.executed).toEqual([
      { url: config.databaseUrl, sql: 'PRAGMA foreign_keys = ON' }
    ]);
    first.close();
    expect(state.closed).toBe(0);
  });

  it('keeps busy_timeout setup for local file databases', async () => {
    const config: RuntimeConfig = {
      ...remote,
      environment: 'test',
      databaseUrl: 'file:./.fixtures/app.db'
    };
    await openAppDatabase(config);
    await openAppDatabase(config);
    expect(state.executed.map(({ sql }) => sql)).toEqual([
      'PRAGMA foreign_keys = ON',
      'PRAGMA busy_timeout = 5000'
    ]);
  });

  it('closes and forgets a client whose initialization failed', async () => {
    const config = { ...remote, databaseUrl: `${remote.databaseUrl}/retry` };
    state.failNext = true;
    await expect(openAppDatabase(config)).rejects.toThrow(
      'synthetic connection setup failure'
    );

    await expect(openAppDatabase(config)).resolves.toMatchObject({
      client: expect.anything()
    });
    expect(state.clients).toHaveLength(2);
    expect(state.closed).toBe(1);
  });
});
