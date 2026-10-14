import { timingSafeEqual } from 'node:crypto';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { runAuthRequest } from '../../lib/server/auth-operation';

const invalid = 'This reset link is invalid or has expired. Request a new one.';
const utf8 = new TextEncoder();
const sameValue = (left: string, right: string): boolean => {
  const a = utf8.encode(left);
  const b = utf8.encode(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const load: PageServerLoad = ({ cookies }) => ({
  token: cookies.get('langlo_reset_token') ?? ''
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
    if (password.length < 12 || password.length > 128) {
      return fail(400, {
        token,
        message: 'Password must be 12–128 characters long.'
      });
    }
    if (!sameValue(password, confirm)) {
      return fail(400, { token, message: 'Passwords do not match.' });
    }
    const response = await runAuthRequest(event, 'reset-password', {
      newPassword: password,
      token
    });
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
