import * as Sentry from '@sentry/sveltekit';
import type { Handle } from '@sveltejs/kit/hooks';

const RESET_TOKEN_PATH = /^(\/api\/auth\/reset-password\/)[^/]+/;

/** The raw path, except that the password-reset token segment is replaced. */
function loggedPath(pathname: string): string {
  return pathname.replace(RESET_TOKEN_PATH, '$1:token');
}

/** Send one structured log per request; liveness probes are skipped. */
export const requestLog: Handle = async ({ event, resolve }) => {
  const started = performance.now();
  const path = loggedPath(event.url.pathname);
  const method = event.request.method;
  const skipped =
    (event.url.pathname.replace(/\/+$/, '') || '/') === '/health/live';
  const emit = (log: typeof Sentry.logger.info, status: number) => {
    if (skipped) return;
    log(`${method} ${path} ${status}`, {
      method,
      path,
      status,
      duration_ms: Math.round(performance.now() - started),
      correlation_id: event.locals.correlationId
    });
  };
  let response: Response;
  try {
    response = await resolve(event);
  } catch (error) {
    emit(Sentry.logger.error, 500);
    throw error;
  }
  emit(Sentry.logger.info, response.status);
  return response;
};
