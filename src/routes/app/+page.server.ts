import { redirect } from '@sveltejs/kit';
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
    if (auth) {
      const response = await auth.api
        .signOut({ headers: event.request.headers, asResponse: true })
        .catch(() => null);
      if (response) applyAuthCookies(event, response);
    }
    redirect(303, '/login');
  }
};
