import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { applyAuthCookies } from '../../lib/server/auth-cookies';
import { resolveAuth } from '../../lib/server/auth-runtime';
import { safeDiagnostic } from '../../lib/server/diagnostics';
import { authFormRequest } from '../../lib/server/auth-request';

export const load: PageServerLoad = ({ locals }) => {
  if (locals.user) redirect(303, '/app');
  return {};
};

export const actions: Actions = {
  default: async (event) => {
    if (event.locals.user) redirect(303, '/app');
    const data = await event.request.formData();
    const name = String(data.get('name') ?? '');
    const email = String(data.get('email') ?? '');
    const password = String(data.get('password') ?? '');
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
      return fail(503, { email, message: 'Accounts are not ready yet.' });
    }
    const response = await auth
      .handler(
        authFormRequest(event, 'sign-up/email', { name, email, password })
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
      return fail(503, {
        email,
        message: 'Sign-up is temporarily unavailable. Try again.'
      });
    }
    if (response.status === 429) {
      return fail(429, {
        email,
        message: 'Too many attempts. Please try again later.'
      });
    }
    if (!response.ok) {
      return fail(400, {
        email,
        message: 'Check the sign-up details and try again.'
      });
    }
    applyAuthCookies(event, response);
    redirect(303, '/app');
  }
};
