import { createClient } from '@libsql/client';
import type { RuntimeConfig } from '../config.ts';

/**
 * Application database seam. Unlike the fixture-only seam in connection.ts,
 * this follows RuntimeConfig: local file URLs in development/test and the
 * configured remote libSQL URL in production. Reads no ambient environment.
 */
export async function openAppDatabase(config: RuntimeConfig) {
  if (!config.dataEnabled || !config.databaseUrl)
    throw new Error('Data is not enabled');
  const client = createClient({
    url: config.databaseUrl,
    authToken: config.databaseToken
  });
  try {
    await client.execute('PRAGMA foreign_keys = ON');
    await client.execute('PRAGMA busy_timeout = 5000');
    const [{ drizzle }, schema] = await Promise.all([
      import('drizzle-orm/libsql'),
      import('./schema.ts')
    ]);
    return {
      client,
      db: drizzle(client, { schema }),
      close: () => client.close()
    };
  } catch (error) {
    client.close();
    throw error;
  }
}
