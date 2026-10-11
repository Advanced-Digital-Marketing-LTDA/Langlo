import { createAuth, type Auth } from './auth.ts';
import { openAppDatabase } from './db/app.ts';
import { createMailer } from './mail.ts';
import type { RuntimeConfig } from './config.ts';

let cached: { key: string; auth: Auth } | undefined;

const keyOf = (config: RuntimeConfig) =>
  `${config.origin}|${config.databaseUrl}`;

/**
 * Per-process auth instance built from validated config only. Returns null
 * when data/auth is not configured so callers can deny safely. The key never
 * contains secrets; the database URL carries no credentials per config rules.
 */
export async function resolveAuth(config: RuntimeConfig): Promise<Auth | null> {
  if (!config.dataEnabled || !config.auth) return null;
  const key = keyOf(config);
  if (cached?.key === key) return cached.auth;
  const { db } = await openAppDatabase(config);
  const mailer = createMailer(config.auth.mail);
  const auth = createAuth(config, { db, mailer });
  cached = { key, auth };
  return auth;
}
