import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { applyAuthCookies } from '../../lib/server/auth-cookies';
import { runAuthRequest } from '../../lib/server/auth-operation';

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
    const response = await runAuthRequest(event, 'sign-up/email', {
      name,
      email,
      password
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
