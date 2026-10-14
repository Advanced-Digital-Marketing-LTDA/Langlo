import type { RequestEvent } from '@sveltejs/kit';
import { resolveAuth } from './auth-runtime';
import { authFormRequest } from './auth-request';
import { safeDiagnostic } from './diagnostics';

/** Send form actions through auth rate limits and safely report dependency errors. */
export async function runAuthRequest(
  event: RequestEvent,
  path: string,
  body: unknown
): Promise<Response | null> {
  try {
    if (!event.locals.config) return null;
    const auth = await resolveAuth(event.locals.config);
    return auth ? await auth.handler(authFormRequest(event, path, body)) : null;
  } catch (error) {
    console.warn(
      JSON.stringify(safeDiagnostic('auth', error, event.locals.correlationId))
    );
    return null;
  }
}
