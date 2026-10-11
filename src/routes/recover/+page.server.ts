import type { Actions } from './$types';
import { resolveAuth } from '../../lib/server/auth-runtime';
import { authFormRequest } from '../../lib/server/auth-request';

const confirmation =
  'If this email exists in our system, check your email for the reset link.';

export const actions: Actions = {
  default: async (event) => {
    const data = await event.request.formData();
    const email = String(data.get('email') ?? '');
    const auth = event.locals.config
      ? await resolveAuth(event.locals.config).catch(() => null)
      : null;
    if (auth) {
      // Outcome is never surfaced: the response is identical for known and
      // unknown addresses, and delivery runs off the response path.
      await auth
        .handler(
          authFormRequest(event, 'request-password-reset', {
            email,
            redirectTo: '/reset'
          })
        )
        .catch(() => null);
    }
    return { message: confirmation };
  }
};
