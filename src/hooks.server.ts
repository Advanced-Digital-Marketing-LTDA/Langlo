import { randomUUID } from 'node:crypto';
import * as env from '$app/env/private';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { parseRuntimeConfig } from './lib/server/config';
import { safeDiagnostic, safeError } from './lib/server/diagnostics';
import { resolveAuth } from './lib/server/auth-runtime';

export const handle: Handle = async ({ event, resolve }) => {
  const correlationId = randomUUID();
  event.locals.correlationId = correlationId;
  const path = event.url.pathname.replace(/\/+$/, '') || '/';
  const privateRoute =
    path === '/app' ||
    path.startsWith('/app/') ||
    ['/login', '/recover', '/reset'].includes(path);
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
      return Response.json(
        {
          message: 'Configuration unavailable. Please try again.',
          correlationId
        },
        { status: 503, headers }
      );
    }
  }
  const authPath = path === '/api/auth' || path.startsWith('/api/auth/');
  const appPath = path === '/app' || path.startsWith('/app/');
  const authNeeded = authPath || appPath || path === '/login';
  let auth: Awaited<ReturnType<typeof resolveAuth>> = null;
  let authFailed = false;
  if (authNeeded && event.locals.config) {
    try {
      auth = await resolveAuth(event.locals.config);
    } catch (error) {
      authFailed = true;
      console.warn(
        JSON.stringify(safeDiagnostic('auth', error, correlationId))
      );
    }
  }
  if (authPath) {
    if (!auth) {
      return Response.json(
        { message: 'Accounts are not ready yet.', correlationId },
        { status: 503, headers }
      );
    }
    const authResponse = await auth.handler(event.request);
    const output = new Response(authResponse.body, authResponse);
    for (const [key, value] of Object.entries(headers))
      output.headers.set(key, value);
    return output;
  }
  if (auth && (appPath || path === '/login')) {
    const session = await auth.api
      .getSession({ headers: event.request.headers })
      .catch(() => null);
    if (session) {
      event.locals.user = session.user as App.Locals['user'];
      event.locals.session = session.session as App.Locals['session'];
    }
  }
  if (appPath) {
    if (!event.locals.user) {
      if (event.request.method === 'GET' || event.request.method === 'HEAD') {
        return new Response(null, {
          status: 303,
          headers: { ...headers, location: '/login' }
        });
      }
      const message = authFailed
        ? 'Service unavailable. Please try again.'
        : auth
          ? 'Sign in required.'
          : 'Accounts are not ready yet.';
      return Response.json(
        { message, correlationId },
        { status: auth ? 401 : 503, headers }
      );
    }
  }
  const response = await resolve(event);
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
