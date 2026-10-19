import * as Sentry from '@sentry/sveltekit';
import type { Handle } from '@sveltejs/kit/hooks';

/** Send one structured log per request, with the raw path; liveness probes are skipped. */
export const requestLog: Handle = async ({ event, resolve }) => {
  const started = performance.now();
  const response = await resolve(event);
  const path = event.url.pathname;
  if ((path.replace(/\/+$/, '') || '/') !== '/health/live') {
    const method = event.request.method;
    Sentry.logger.info(`${method} ${path} ${response.status}`, {
      method,
      path,
      status: response.status,
      duration_ms: Math.round(performance.now() - started),
      correlation_id: event.locals.correlationId
    });
  }
  return response;
};
