import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { resolveAuth } from '../../lib/server/auth-runtime';
import { applyAuthCookies } from '../../lib/server/auth-cookies';
import { requireLearnerPage } from '../../lib/server/learner-session';
import { studyPage } from '../../lib/server/learner-api';
import { loadProgress } from '../../lib/server/progress';
import { unfinishedPractice } from '../../lib/server/practice';
import { safeDiagnostic } from '../../lib/server/diagnostics';

const signOutFailure = 'Sign out is temporarily unavailable. Try again.';

export const load: PageServerLoad = async (event) => {
  // Learner data must be loaded with the session this returns, never with a
  // learner ID taken from params, query or form data.
  requireLearnerPage(event);
  const user = event.locals.user;
  const progress =
    event.locals.config?.dataEnabled && event.locals.config.databaseUrl
      ? await studyPage(event, async (client, learner) => {
          const loaded = await loadProgress(client, learner);
          // Each track's check is independent, so they run at once.
          const found = await Promise.all(
            loaded.tracks.map((track) =>
              unfinishedPractice(client, learner, track.language)
            )
          );
          const unfinished: Record<string, { id: string; answered: number }> =
            {};
          loaded.tracks.forEach((track, index) => {
            const practice = found[index];
            if (practice) unfinished[track.language] = practice;
          });
          return { ...loaded, unfinished };
        })
      : {
          tracks: [],
          unfinished: {} as Record<string, { id: string; answered: number }>
        };
  return {
    user: { name: user?.name ?? '', email: user?.email ?? '' },
    ...progress
  };
};

export const actions: Actions = {
  signOut: async (event) => {
    let response: Response;
    try {
      const auth = event.locals.config
        ? await resolveAuth(event.locals.config)
        : null;
      if (!auth) {
        return fail(503, { message: 'Accounts are not ready yet.' });
      }
      response = await auth.api.signOut({
        headers: event.request.headers,
        asResponse: true
      });
    } catch (error) {
      console.warn(
        JSON.stringify(
          safeDiagnostic('auth', error, event.locals.correlationId)
        )
      );
      return fail(503, { message: signOutFailure });
    }
    if (!response.ok) {
      // Report the outage honestly instead of redirecting as if the
      // credential was revoked; the cookie is kept so sign-out can retry.
      return fail(503, { message: signOutFailure });
    }
    applyAuthCookies(event, response);
    redirect(303, '/login');
  }
};
