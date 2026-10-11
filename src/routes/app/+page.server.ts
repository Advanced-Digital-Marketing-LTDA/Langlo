import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { resolveAuth } from '../../lib/server/auth-runtime';
import { applyAuthCookies } from '../../lib/server/auth-cookies';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) redirect(303, '/login');
  return { user: { name: locals.user.name, email: locals.user.email } };
};

export const actions: Actions = {
  signOut: async (event) => {
    const auth = event.locals.config
      ? await resolveAuth(event.locals.config).catch(() => null)
      : null;
    if (!auth) {
      return fail(503, { message: 'Accounts are not ready yet.' });
    }
    const response = await auth.api
      .signOut({ headers: event.request.headers, asResponse: true })
      .catch(() => null);
    if (!response?.ok) {
      // Report the outage honestly instead of redirecting as if the
      // credential was revoked; the cookie is kept so sign-out can retry.
      return fail(503, {
        message: 'Sign out is temporarily unavailable. Try again.'
      });
    }
    applyAuthCookies(event, response);
    redirect(303, '/login');
  }
};
