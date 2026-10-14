import { createAuth, type Auth } from './auth.ts';
import { openAppDatabase } from './db/app.ts';
import { createMailer } from './mail.ts';
import { ConfigError, type RuntimeConfig } from './config.ts';

let cached: { key: string; auth: Promise<Auth> } | undefined;

const keyOf = (config: RuntimeConfig) =>
  `${config.origin}|${config.databaseUrl}`;

/**
 * Per-process auth instance built from validated config only. Returns null
 * when data/auth is not configured so callers can deny safely. The key never
 * contains secrets; the database URL carries no credentials per config rules.
 * Concurrent resolves share one in-flight build so no client handle leaks.
 */
export async function resolveAuth(config: RuntimeConfig): Promise<Auth | null> {
  if (!config.dataEnabled || !config.auth) return null;
  const key = keyOf(config);
  if (cached?.key === key) return cached.auth;
  const authConfig = config.auth;
  const mailer = authConfig.mail
    ? createMailer(authConfig.mail)
    : {
        /** Reject delivery when recovery configuration is unavailable. */
        send() {
          return Promise.reject(
            authConfig.mailError ?? new ConfigError('MAIL_TRANSPORT')
          );
        }
      };
  const auth = openAppDatabase(config).then(({ db }) =>
    createAuth(config, { db, mailer })
  );
  cached = { key, auth };
  try {
    return await auth;
  } catch (error) {
    if (cached?.auth === auth) cached = undefined;
    throw error;
  }
}
