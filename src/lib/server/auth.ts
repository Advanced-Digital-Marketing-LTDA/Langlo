import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { RuntimeConfig } from './config.ts';
import type { Mailer } from './mail.ts';
import * as schema from './db/schema.ts';

export interface AuthDeps {
  db: LibSQLDatabase<typeof schema>;
  mailer: Mailer;
}

const resetMessage = (url: string) => ({
  subject: 'Reset your Langlo password',
  text: [
    'A password reset was requested for this account.',
    '',
    `Reset link (valid for 30 minutes): ${url}`,
    '',
    'If you did not request this, you can ignore this message.'
  ].join('\n')
});

/**
 * Contract implementation (docs/auth.md): email+password only, no sign-up
 * path, database sessions with immediate revocation, hashed verification
 * identifiers, database-backed rate limits, framework logging disabled —
 * diagnostics stay on the safe allowlist at our own boundary.
 */
export function createAuth(config: RuntimeConfig, deps: AuthDeps) {
  if (!config.auth) throw new Error('Authentication is not configured');
  return betterAuth({
    appName: 'Langlo',
    baseURL: config.origin,
    secret: config.auth.secret,
    trustedOrigins: [config.origin],
    telemetry: { enabled: false },
    logger: { disabled: true },
    advanced: {
      defaultCookieAttributes: {
        secure: config.origin.startsWith('https:')
      }
    },
    database: drizzleAdapter(deps.db, {
      provider: 'sqlite',
      schema
    }),
    user: { modelName: 'users' },
    session: {
      modelName: 'sessions',
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false }
    },
    account: { modelName: 'accounts' },
    verification: { modelName: 'verifications', storeIdentifier: 'hashed' },
    rateLimit: {
      modelName: 'rateLimits',
      enabled: true,
      storage: 'database',
      customRules: {
        '/sign-in/email': { window: 300, max: 5 },
        '/request-password-reset': { window: 600, max: 3 },
        '/reset-password': { window: 600, max: 5 }
      }
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 1800,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        // Deliberately not awaited: delivery time must not leak account
        // existence through the response path (docs/auth.md §4).
        void deps.mailer
          .send({ to: user.email, ...resetMessage(url) })
          .catch(() => {
            console.warn(
              JSON.stringify({
                operation: 'auth',
                kind: 'mail-delivery'
              })
            );
          });
      }
    }
  });
}

export type Auth = ReturnType<typeof createAuth>;
