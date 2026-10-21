import { createClient } from '@libsql/client';
import type { RuntimeConfig } from '../config.ts';
import { markRemoteClient } from '../remote-clients.ts';

const remoteUrl = /^(libsql|https?|wss?):/i;

const databases = new Map<string, ReturnType<typeof initializeDatabase>>();

async function initializeDatabase(databaseUrl: string, databaseToken?: string) {
  const client = createClient({
    url: databaseUrl,
    authToken: databaseToken,
    // A PRAGMA configures only the borrowed connection; this covers the pool.
    ...(databaseUrl.startsWith('file:') ? { timeout: 5000 } : {})
  });
  if (remoteUrl.test(databaseUrl)) markRemoteClient(client);
  try {
    await client.execute('PRAGMA foreign_keys = ON');
    const [{ drizzle }, schema] = await Promise.all([
      import('drizzle-orm/libsql'),
      import('./schema.ts')
    ]);
    return { client, db: drizzle(client, { schema }) };
  } catch (error) {
    client.close();
    throw error;
  }
}

/**
 * Application database seam. Unlike the fixture-only seam in connection.ts,
 * this follows RuntimeConfig: local file URLs in development/test and the
 * configured remote libSQL URL in production. Reads no ambient environment.
 */
export async function openAppDatabase(config: RuntimeConfig) {
  if (!config.dataEnabled || !config.databaseUrl)
    throw new Error('Data is not enabled');
  const key = JSON.stringify([config.databaseUrl, config.databaseToken]);
  let opening = databases.get(key);
  if (!opening) {
    opening = initializeDatabase(config.databaseUrl, config.databaseToken);
    databases.set(key, opening);
    void opening.catch(() => {
      if (databases.get(key) === opening) databases.delete(key);
    });
  }
  const database = await opening;
  // Request cleanup must not close the process-wide connection.
  return { ...database, close: () => undefined };
}
