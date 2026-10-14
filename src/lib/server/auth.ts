import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { RuntimeConfig } from './config.ts';
import { safeDiagnostic } from './diagnostics.ts';
import type { Mailer } from './mail.ts';
import { currentCorrelationId } from './request-context.ts';
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
 * Contract implementation (docs/auth.md): email+password with public
 * registration, database sessions with immediate revocation, hashed verification
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
      ipAddress: { ipAddressHeaders: ['x-langlo-client-address'] },
      defaultCookieAttributes: {
        secure: config.origin.startsWith('https:')
      }
    },
    database: drizzleAdapter(deps.db, {
      provider: 'sqlite',
      schema
    }),
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === '/sign-up/email' &&
          (typeof ctx.body?.name !== 'string' || !ctx.body.name.trim())
        ) {
          throw new APIError('BAD_REQUEST', { message: 'A name is required.' });
        }
      })
    },
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
        '/sign-up/email': { window: 3600, max: 5 },
        '/request-password-reset': { window: 600, max: 3 },
        '/reset-password': { window: 600, max: 5 }
      }
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      requireEmailVerification: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 1800,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) => {
        const correlationId = currentCorrelationId();
        // SMTP latency must not reveal whether the submitted account exists.
        void Promise.resolve()
          .then(() =>
            deps.mailer.send({ to: user.email, ...resetMessage(url) })
          )
          .catch((error: unknown) => {
            console.warn(
              JSON.stringify(safeDiagnostic('auth', error, correlationId))
            );
          });
        return Promise.resolve();
      }
    }
  });
}

export type Auth = ReturnType<typeof createAuth>;
