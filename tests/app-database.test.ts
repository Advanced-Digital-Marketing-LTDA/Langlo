import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeConfig } from '../src/lib/server/config';

const executed: string[] = [];

vi.mock('@libsql/client', () => ({
  createClient: ({ url }: { url: string }) => ({
    // Turso's remote endpoint rejects connection-local pragmas such as busy_timeout.
    execute: (sql: string) => {
      executed.push(sql);
      if (url.startsWith('libsql:') && sql.startsWith('PRAGMA busy_timeout'))
        return Promise.reject(new Error('SQL not allowed statement'));
      return Promise.resolve({ rows: [] });
    },
    close: () => undefined
  })
}));

const { openAppDatabase } = await import('../src/lib/server/db/app');

const remote: RuntimeConfig = {
  environment: 'production',
  origin: 'https://langlo.example.org',
  dataEnabled: true,
  databaseUrl: 'libsql://langlo.example.turso.io',
  databaseToken: 'synthetic-token',
  revision: 'unknown'
};

describe('openAppDatabase', () => {
  beforeEach(() => {
    executed.length = 0;
  });

  it('opens a remote libSQL database without a local-only busy_timeout pragma', async () => {
    const { close } = await openAppDatabase(remote);
    close();
    expect(executed).toEqual(['PRAGMA foreign_keys = ON']);
  });

  it('keeps the busy_timeout pragma for local file databases', async () => {
    const { close } = await openAppDatabase({
      ...remote,
      environment: 'test',
      databaseUrl: 'file:./.fixtures/app.db'
    });
    close();
    expect(executed).toEqual([
      'PRAGMA foreign_keys = ON',
      'PRAGMA busy_timeout = 5000'
    ]);
  });
});
