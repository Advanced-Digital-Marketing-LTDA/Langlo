import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { resolveAuth } from '../../lib/server/auth-runtime';
import { safeDiagnostic } from '../../lib/server/diagnostics';
import { authFormRequest } from '../../lib/server/auth-request';

const confirmation =
  'If this email exists in our system, check your email for the reset link.';

export const actions: Actions = {
  default: async (event) => {
    const data = await event.request.formData();
    const email = String(data.get('email') ?? '');
    const runtime = event.locals.config;
    if (!runtime?.auth) {
      return fail(503, {
        message: 'Password recovery is temporarily unavailable. Try again.'
      });
    }
    if (runtime.auth.mailError) {
      console.warn(
        JSON.stringify(
          safeDiagnostic(
            'auth',
            runtime.auth.mailError,
            event.locals.correlationId
          )
        )
      );
      return fail(503, {
        message: 'Password recovery is temporarily unavailable. Try again.'
      });
    }
    const auth = event.locals.config
      ? await resolveAuth(event.locals.config).catch((error: unknown) => {
          console.warn(
            JSON.stringify(
              safeDiagnostic('auth', error, event.locals.correlationId)
            )
          );
          return null;
        })
      : null;
    if (!auth) {
      return fail(503, {
        message: 'Password recovery is temporarily unavailable. Try again.'
      });
    }
    const response = await auth
      .handler(
        authFormRequest(event, 'request-password-reset', {
          email,
          redirectTo: '/reset'
        })
      )
      .catch((error: unknown) => {
        console.warn(
          JSON.stringify(
            safeDiagnostic('auth', error, event.locals.correlationId)
          )
        );
        return null;
      });
    if (!response || response.status >= 500) {
      console.warn(
        JSON.stringify({
          operation: 'auth',
          kind: 'recovery-unavailable',
          correlationId: event.locals.correlationId
        })
      );
      return fail(503, {
        message: 'Password recovery is temporarily unavailable. Try again.'
      });
    }
    if (response.status === 429) {
      return fail(429, {
        message: 'Too many attempts. Please try again later.'
      });
    }
    return { message: confirmation };
  }
};
