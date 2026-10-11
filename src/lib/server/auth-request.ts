import type { RequestEvent } from '@sveltejs/kit';

/**
 * Build a same-origin request for `auth.handler`, forwarding the client's
 * headers (the rate limiter keys on the forwarded IP). auth.api calls bypass
 * the router's onRequest hooks — including rate limits — so form actions must
 * go through the handler instead.
 */
export function authFormRequest(
  event: RequestEvent,
  path: string,
  body: unknown
): Request {
  const headers = new Headers(event.request.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  if (!headers.has('origin')) {
    headers.set('origin', event.locals.config?.origin ?? event.url.origin);
  }
  return new Request(new URL(path, `${event.url.origin}/api/auth/`), {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}
