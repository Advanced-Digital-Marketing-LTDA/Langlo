import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { resolveAuth } from '../../lib/server/auth-runtime';
import { authFormRequest } from '../../lib/server/auth-request';

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
    if (!token) {
      return fail(400, { token, message: invalid });
    }
    if (password !== confirm) {
      return fail(400, { token, message: 'Passwords do not match.' });
    }
    const auth = event.locals.config
      ? await resolveAuth(event.locals.config).catch(() => null)
      : null;
    if (!auth) {
      return fail(503, { token, message: 'Accounts are not ready yet.' });
    }
    const response = await auth
      .handler(
        authFormRequest(event, 'reset-password', {
          newPassword: password,
          token
        })
      )
      .catch(() => null);
    if (response === null) {
      return fail(503, {
        token,
        message: 'Password reset is temporarily unavailable. Try again.'
      });
    }
    if (response.status === 429) {
      return fail(429, {
        token,
        message: 'Too many attempts. Please try again later.'
      });
    }
    if (!response.ok) {
      // Uniform failure: no distinction between expired, replayed or malformed.
      return fail(400, { token, message: invalid });
    }
    redirect(303, '/login');
  }
};
