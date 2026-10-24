import { randomUUID } from 'node:crypto';
import * as env from '$app/env/private';
import * as publicEnv from '$app/env/public';
import {
  sequence,
  type Handle,
  type HandleServerError
} from '@sveltejs/kit/hooks';
import * as Sentry from '@sentry/sveltekit';
import { parseRuntimeConfig } from './lib/server/config';
import { safeDiagnostic, safeError } from './lib/server/diagnostics';
import { resolveAuth } from './lib/server/auth-runtime';
import { withCorrelationId } from './lib/server/request-context';
import { authRequestHeaders } from './lib/server/auth-request';
import { requestLog } from './lib/server/request-log';
import { requestBodyLimit, limitRequestBody } from './lib/server/request-body';
import { StudyError } from './lib/server/study-error';

Sentry.init({
  dsn: publicEnv.PUBLIC_GLITCHTIP_DSN,
  environment: env.APP_ENV ?? 'development',
  release:
    env.APP_BUILD_SHA && env.APP_BUILD_SHA !== 'unknown'
      ? env.APP_BUILD_SHA
      : undefined,
  tracesSampleRate: 1,
  traceLifecycle: 'static',
  integrations: (integrations) => [
    ...integrations.flatMap((integration) => {
      if (integration.name === 'ProcessSession') return [];
      return integration.name === 'Http'
        ? [Sentry.httpIntegration({ sessions: false })]
        : [integration];
    }),
    Sentry.consoleLoggingIntegration()
  ]
});

const declaresOversizedBody = (
  contentLength: string | null,
  maxBytes: number
): boolean => {
  if (!contentLength) return false;
  return /^\d+$/u.test(contentLength) && Number(contentLength) > maxBytes;
};

type HookEvent = Parameters<Handle>[0]['event'];
type HookResolve = Parameters<Handle>[0]['resolve'];
type RequestAuth = {
  auth: Awaited<ReturnType<typeof resolveAuth>>;
  sessionLookupFailed: boolean;
};

function withinPath(path: string, root: string) {
  return path === root || path.startsWith(root + '/');
}

function requestPath(url: URL) {
  return url.pathname.replace(/\/+$/, '') || '/';
}

function routePolicy(path: string) {
  const appPath = withinPath(path, '/app');
  const authPath = withinPath(path, '/api/auth');
  const accountPage = ['/login', '/signup'].includes(path);
  const privateRoute =
    appPath || ['/login', '/signup', '/recover', '/reset'].includes(path);
  return {
    appPath,
    authPath,
    accountPage,
    signupApi: path === '/api/auth/sign-up/email',
    privateRoute,
    authNeeded: authPath || appPath || accountPage,
    noIndex:
      privateRoute ||
      withinPath(path, '/prototype') ||
      path.startsWith('/health/') ||
      path === '/build.json'
  };
}

function requestHeaders(privateRoute: boolean, correlationId: string) {
  return {
    'x-correlation-id': correlationId,
    'cache-control': privateRoute ? 'private, no-store' : 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin'
  };
}

function failureResponse(
  event: HookEvent,
  headers: Record<string, string>,
  status: number,
  message: string
) {
  return Response.json(
    { message, correlationId: event.locals.correlationId },
    { status, headers }
  );
}

function addResponseHeaders(
  response: Response,
  headers: Record<string, string>
) {
  for (const [key, value] of Object.entries(headers))
    response.headers.set(key, value);
  return response;
}

function configureRequest(event: HookEvent, path: string) {
  // Liveness never depends on application config, schema, auth or a provider.
  if (path === '/health/live') return;
  try {
    event.locals.config = parseRuntimeConfig(env);
  } catch (error) {
    console.warn(
      JSON.stringify(
        safeDiagnostic('configuration', error, event.locals.correlationId)
      )
    );
    // Public and synthetic routes do not require data/auth configuration.
    event.locals.config = undefined;
  }
}

function recoveryFailure(
  event: HookEvent,
  path: string,
  headers: Record<string, string>
) {
  if (
    path !== '/api/auth/request-password-reset' ||
    !event.locals.config?.auth?.mailError
  )
    return;
  console.warn(
    JSON.stringify(
      safeDiagnostic(
        'auth',
        event.locals.config.auth.mailError,
        event.locals.correlationId
      )
    )
  );
  return failureResponse(
    event,
    headers,
    503,
    'Password recovery is temporarily unavailable.'
  );
}

async function configuredAuth(
  event: HookEvent,
  needed: boolean
): Promise<RequestAuth['auth']> {
  if (!needed || !event.locals.config) return null;
  try {
    return await resolveAuth(event.locals.config);
  } catch (error) {
    console.warn(
      JSON.stringify(safeDiagnostic('auth', error, event.locals.correlationId))
    );
    return null;
  }
}

async function lookupSession(
  event: HookEvent,
  auth: RequestAuth['auth'],
  route: ReturnType<typeof routePolicy>
) {
  if (!auth || !(route.appPath || route.accountPage || route.signupApi))
    return false;
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null;
  try {
    session = await auth.api.getSession({ headers: event.request.headers });
  } catch {
    // A backend outage must not become a missing-session redirect or 401.
    return true;
  }
  if (session) {
    event.locals.user = session.user as App.Locals['user'];
    event.locals.session = session.session as App.Locals['session'];
  }
  return false;
}

async function authenticateRequest(
  event: HookEvent,
  route: ReturnType<typeof routePolicy>
): Promise<RequestAuth> {
  const auth = await configuredAuth(event, route.authNeeded);
  return { auth, sessionLookupFailed: await lookupSession(event, auth, route) };
}

function signupFailure(
  event: HookEvent,
  path: string,
  sessionLookupFailed: boolean,
  headers: Record<string, string>
) {
  const signupApi = path === '/api/auth/sign-up/email';
  if (sessionLookupFailed && (path === '/signup' || signupApi))
    return failureResponse(
      event,
      headers,
      503,
      'Service unavailable. Please try again.'
    );
  if (signupApi && event.locals.user)
    return failureResponse(
      event,
      headers,
      409,
      'Sign out before registering another account.'
    );
}

function appAccessFailure(
  event: HookEvent,
  appPath: boolean,
  authentication: RequestAuth,
  headers: Record<string, string>
) {
  if (!appPath) return;
  if (!authentication.auth)
    return failureResponse(event, headers, 503, 'Accounts are not ready yet.');
  if (event.locals.user) return;
  if (authentication.sessionLookupFailed)
    return failureResponse(
      event,
      headers,
      503,
      'Service unavailable. Please try again.'
    );
  if (['GET', 'HEAD'].includes(event.request.method))
    return new Response(null, {
      status: 303,
      headers: { ...headers, location: '/login' }
    });
  return failureResponse(event, headers, 401, 'Sign in required.');
}

function resetTokenCookie(token: string, secure: boolean) {
  return (
    'langlo_reset_token=' +
    token +
    '; HttpOnly; SameSite=Lax; Path=/reset; Max-Age=1800' +
    (secure ? '; Secure' : '')
  );
}

function handoffResetToken(event: HookEvent, path: string, response: Response) {
  if (
    !path.startsWith('/api/auth/reset-password/') ||
    response.status < 300 ||
    response.status >= 400
  )
    return;
  try {
    const target = new URL(
      response.headers.get('location') ?? '',
      event.url.origin
    );
    const token = target.searchParams.get('token');
    if (token) {
      // Keep the token out of browser history and caller-supplied redirect targets.
      response.headers.set('location', '/reset');
      response.headers.append(
        'set-cookie',
        resetTokenCookie(
          token,
          Boolean(event.locals.config?.origin.startsWith('https:'))
        )
      );
    }
  } catch {
    /* leave the framework redirect untouched */
  }
}

async function bodyLimitedResponse(
  run: () => Promise<Response>,
  event: HookEvent,
  headers: Record<string, string>
) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof StudyError && error.code === 'REQUEST_BODY_TOO_LARGE')
      return failureResponse(event, headers, 413, 'This request is too large.');
    throw error;
  }
}

async function forwardAuth(
  event: HookEvent,
  auth: RequestAuth['auth'],
  headers: Record<string, string>
) {
  if (!auth)
    return failureResponse(event, headers, 503, 'Accounts are not ready yet.');
  let authHeaders: Headers;
  try {
    authHeaders = authRequestHeaders(event);
  } catch (error) {
    console.warn(
      JSON.stringify(safeDiagnostic('auth', error, event.locals.correlationId))
    );
    return failureResponse(event, headers, 503, 'Accounts are not ready yet.');
  }
  return bodyLimitedResponse(
    async () => {
      const request = await limitRequestBody(
        new Request(event.request, { headers: authHeaders })
      );
      const response = await withCorrelationId(event.locals.correlationId, () =>
        auth.handler(request)
      );
      const output = new Response(response.body, response);
      handoffResetToken(event, requestPath(event.url), output);
      return addResponseHeaders(output, headers);
    },
    event,
    headers
  );
}

async function resolvePage(
  event: HookEvent,
  resolve: HookResolve,
  maxBodyBytes: number,
  headers: Record<string, string>
) {
  return bodyLimitedResponse(
    async () => {
      const request = await limitRequestBody(event.request, maxBodyBytes);
      const boundedEvent = new Proxy(event, {
        get(target, property) {
          return property === 'request'
            ? request
            : Reflect.get(target, property, target);
        }
      });
      const response = await withCorrelationId(event.locals.correlationId, () =>
        resolve(boundedEvent)
      );
      return addResponseHeaders(new Response(response.body, response), headers);
    },
    event,
    headers
  );
}

const appHandle: Handle = async ({ event, resolve }) => {
  event.locals.correlationId = randomUUID();
  const path = requestPath(event.url);
  const route = routePolicy(path);
  const headers: Record<string, string> = requestHeaders(
    route.privateRoute,
    event.locals.correlationId
  );
  const maxBodyBytes = requestBodyLimit(event.request, event.url);
  if (
    declaresOversizedBody(
      event.request.headers.get('content-length'),
      maxBodyBytes
    )
  )
    return failureResponse(event, headers, 413, 'This request is too large.');
  if (route.noIndex) headers['x-robots-tag'] = 'noindex, nofollow';
  configureRequest(event, path);
  const recovery = recoveryFailure(event, path, headers);
  if (recovery) return recovery;
  const authentication = await authenticateRequest(event, route);
  const signup = signupFailure(
    event,
    path,
    authentication.sessionLookupFailed,
    headers
  );
  if (signup) return signup;
  if (route.authPath) return forwardAuth(event, authentication.auth, headers);
  const access = appAccessFailure(
    event,
    route.appPath,
    authentication,
    headers
  );
  if (access) return access;
  return resolvePage(event, resolve, maxBodyBytes, headers);
};
export const handle = sequence(Sentry.sentryHandle(), requestLog, appHandle);

export const handleError: HandleServerError = Sentry.handleErrorWithSentry(
  ({ error, event }) => {
    console.warn(
      JSON.stringify(
        safeDiagnostic('request', error, event.locals.correlationId)
      )
    );
    return safeError(event.locals.correlationId);
  }
);
