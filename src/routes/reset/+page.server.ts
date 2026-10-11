import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { resolveAuth } from '../../lib/server/auth-runtime';

const invalid = 'This reset link is invalid or has expired. Request a new one.';

export const load: PageServerLoad = ({ url }) => ({
  token: url.searchParams.get('token') ?? ''
});

export const actions: Actions = {
  default: async (event) => {
    const data = await event.request.formData();
    const token = String(data.get('token') ?? '');
    const password = String(data.get('password') ?? '');
    const confirm = String(data.get('confirm') ?? '');
    if (!token || password !== confirm) {
      return fail(400, { token, message: invalid });
    }
    const auth = event.locals.config
      ? await resolveAuth(event.locals.config).catch(() => null)
      : null;
    if (!auth) {
      return fail(503, { token, message: 'Accounts are not ready yet.' });
    }
    const response = await auth.api
      .resetPassword({
        body: { newPassword: password, token },
        headers: event.request.headers,
        asResponse: true
      })
      .catch(() => null);
    if (!response?.ok) {
      // Uniform failure: no distinction between expired, replayed or malformed.
      return fail(400, { token, message: invalid });
    }
    redirect(303, '/login');
  }
};
