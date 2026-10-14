import { randomUUID } from 'node:crypto';
import * as env from '$app/env/private';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { parseRuntimeConfig } from './lib/server/config';
import { safeDiagnostic, safeError } from './lib/server/diagnostics';
import { resolveAuth } from './lib/server/auth-runtime';
import { withCorrelationId } from './lib/server/request-context';

export const handle: Handle = async ({ event, resolve }) => {
  const correlationId = randomUUID();
  event.locals.correlationId = correlationId;
  const path = event.url.pathname.replace(/\/+$/, '') || '/';
  const privateRoute =
    path === '/app' ||
    path.startsWith('/app/') ||
    ['/login', '/signup', '/recover', '/reset'].includes(path);
  const headers: Record<string, string> = {
    'x-correlation-id': correlationId,
    'cache-control': privateRoute ? 'private, no-store' : 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  };
  const prototypeRoute =
    path === '/prototype' || path.startsWith('/prototype/');
  if (
    privateRoute ||
    prototypeRoute ||
    path.startsWith('/health/') ||
    path === '/build.json'
  ) {
    headers['x-robots-tag'] = 'noindex, nofollow';
  }
  // Liveness never depends on application config, schema, auth or a provider.
  if (path !== '/health/live') {
    try {
      event.locals.config = parseRuntimeConfig(env);
    } catch (error) {
      console.warn(
        JSON.stringify(safeDiagnostic('configuration', error, correlationId))
      );
      // Public and synthetic routes do not require data/auth configuration.
      // Feature routes below return their own safe unavailable response.
      event.locals.config = undefined;
    }
  }
  const authPath = path === '/api/auth' || path.startsWith('/api/auth/');
  if (
    path === '/api/auth/request-password-reset' &&
    event.locals.config?.auth?.mailError
  ) {
    const error = event.locals.config.auth.mailError;
    console.warn(JSON.stringify(safeDiagnostic('auth', error, correlationId)));
    return Response.json(
      {
        message: 'Password recovery is temporarily unavailable.',
        correlationId
      },
      { status: 503, headers }
    );
  }
  const appPath = path === '/app' || path.startsWith('/app/');
  const accountPage = path === '/login' || path === '/signup';
  const authNeeded = authPath || appPath || accountPage;
  let auth: Awaited<ReturnType<typeof resolveAuth>> = null;
  if (authNeeded && event.locals.config) {
    try {
      auth = await resolveAuth(event.locals.config);
    } catch (error) {
      console.warn(
        JSON.stringify(safeDiagnostic('auth', error, correlationId))
      );
    }
  }
  let sessionLookupFailed = false;
  if (authPath) {
    if (!auth) {
      return Response.json(
        { message: 'Accounts are not ready yet.', correlationId },
        { status: 503, headers }
      );
    }
    const authResponse = await withCorrelationId(correlationId, () =>
      auth.handler(event.request)
    );
    const output = new Response(authResponse.body, authResponse);
    if (
      path.startsWith('/api/auth/reset-password/') &&
      output.status >= 300 &&
      output.status < 400
    ) {
      // The email link must carry the token once, but it must not persist in
      // the /reset page URL (browser history, referers, re-navigation). Hand
      // it to the page through a short-lived HttpOnly cookie instead.
      try {
        const target = new URL(
          output.headers.get('location') ?? '',
          event.url.origin
        );
        const token = target.searchParams.get('token');
        if (token) {
          // Force /reset for every permitted callback target so a caller-
          // supplied redirectTo cannot park the token in another URL.
          output.headers.set('location', '/reset');
          const secure = event.locals.config?.origin.startsWith('https:')
            ? '; Secure'
            : '';
          output.headers.append(
            'set-cookie',
            `langlo_reset_token=${token}; HttpOnly; SameSite=Lax; Path=/reset; Max-Age=1800${secure}`
          );
        }
      } catch {
        /* leave the framework redirect untouched */
      }
    }
    for (const [key, value] of Object.entries(headers))
      output.headers.set(key, value);
    return output;
  }
  if (auth && (appPath || accountPage)) {
    let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
    try {
      session = await auth.api.getSession({
        headers: event.request.headers
      });
    } catch {
      // A backend outage is not a missing session; reporting it as one
      // would convert 503 service failures into misleading 401s/redirects.
      sessionLookupFailed = true;
    }
    if (session) {
      event.locals.user = session.user as App.Locals['user'];
      event.locals.session = session.session as App.Locals['session'];
    }
  }
  if (appPath) {
    if (!auth) {
      return Response.json(
        { message: 'Accounts are not ready yet.', correlationId },
        { status: 503, headers }
      );
    }
    if (!event.locals.user) {
      if (sessionLookupFailed) {
        return Response.json(
          { message: 'Service unavailable. Please try again.', correlationId },
          { status: 503, headers }
        );
      }
      if (event.request.method === 'GET' || event.request.method === 'HEAD') {
        return new Response(null, {
          status: 303,
          headers: { ...headers, location: '/login' }
        });
      }
      return Response.json(
        { message: 'Sign in required.', correlationId },
        { status: 401, headers }
      );
    }
  }
  const response = await withCorrelationId(correlationId, () => resolve(event));
  const output = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers))
    output.headers.set(key, value);
  return output;
};

export const handleError: HandleServerError = ({ error, event }) => {
  console.warn(
    JSON.stringify(safeDiagnostic('request', error, event.locals.correlationId))
  );
  return safeError(event.locals.correlationId);
};
