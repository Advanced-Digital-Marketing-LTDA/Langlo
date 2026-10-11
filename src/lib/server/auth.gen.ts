import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { createAuth } from './auth.ts';
import * as schema from './db/schema.ts';

// Generation-only shim for `npx @better-auth/cli generate --config ...`.
// It is never imported by application code; the in-memory client is enough
// for the CLI to derive the auth table schema from the real options.
const client = createClient({ url: ':memory:' });
const db = drizzle(client, { schema });

export const auth = createAuth(
  {
    environment: 'development',
    origin: 'http://localhost:3000',
    dataEnabled: true,
    databaseUrl: ':memory:',
    revision: 'unknown',
    auth: {
      secret: 'generation-only-placeholder-secret',
      mail: { transport: 'capture', smtpHost: 'localhost', smtpPort: 587 }
    }
  },
  { db, mailer: { send: async () => {} } }
);
