import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { resolveAuth } from '../../lib/server/auth-runtime';
import { applyAuthCookies } from '../../lib/server/auth-cookies';
import { requireLearnerPage } from '../../lib/server/learner-session';
import { studyPage } from '../../lib/server/learner-api';
import { loadProgress } from '../../lib/server/progress';

export const load: PageServerLoad = async (event) => {
  // Learner data must be loaded with the session this returns, never with a
  // learner ID taken from params, query or form data.
  requireLearnerPage(event);
  const user = event.locals.user;
  const progress =
    event.locals.config?.dataEnabled && event.locals.config.databaseUrl
      ? await studyPage(event, (client, learner) =>
          loadProgress(client, learner)
        )
      : { tracks: [] };
  return {
    user: { name: user?.name ?? '', email: user?.email ?? '' },
    ...progress
  };
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
