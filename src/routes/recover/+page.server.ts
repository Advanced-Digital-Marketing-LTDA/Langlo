import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { safeDiagnostic } from '../../lib/server/diagnostics';
import { runAuthRequest } from '../../lib/server/auth-operation';

const confirmation =
  'If this email exists in our system, check your email for the reset link.';
const unavailable = () =>
  fail(503, {
    message: 'Password recovery is temporarily unavailable. Try again.'
  });

export const actions: Actions = {
  default: async (event) => {
    const data = await event.request.formData();
    const email = String(data.get('email') ?? '');
    const runtime = event.locals.config;
    if (!runtime?.auth) {
      return unavailable();
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
      return unavailable();
    }
    const response = await runAuthRequest(event, 'request-password-reset', {
      email,
      redirectTo: '/reset'
    });
    if (!response || response.status >= 500) {
      console.warn(
        JSON.stringify(
          safeDiagnostic('auth', undefined, event.locals.correlationId)
        )
      );
      return unavailable();
    }
    if (response.status === 429) {
      return fail(429, {
        message: 'Too many attempts. Please try again later.'
      });
    }
    return { message: confirmation };
  }
};
