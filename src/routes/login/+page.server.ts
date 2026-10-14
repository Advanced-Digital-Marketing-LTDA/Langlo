import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { runAuthRequest } from '../../lib/server/auth-operation';
import { applyAuthCookies } from '../../lib/server/auth-cookies';

export const load: PageServerLoad = ({ locals }) => {
  if (locals.user) redirect(303, '/app');
  return {};
};

export const actions: Actions = {
  default: async (event) => {
    const data = await event.request.formData();
    const email = String(data.get('email') ?? '');
    const password = String(data.get('password') ?? '');
    const response = await runAuthRequest(event, 'sign-in/email', {
      email,
      password
    });
    if (!response) {
      return fail(503, { email, message: 'Accounts are not ready yet.' });
    }
    if (!response.ok) {
      // Uniform credential failure: no distinction between unknown email and
      // wrong password (docs/auth.md §4).
      if (response.status === 429) {
        return fail(429, {
          email,
          message: 'Too many attempts. Please try again later.'
        });
      }
      return fail(401, { email, message: 'Invalid email or password.' });
    }
    applyAuthCookies(event, response);
    redirect(303, '/app');
  }
};
