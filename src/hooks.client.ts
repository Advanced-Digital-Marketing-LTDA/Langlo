import * as publicEnv from '$app/env/public';
import * as Sentry from '@sentry/sveltekit';

Sentry.init({
  dsn: publicEnv.PUBLIC_GLITCHTIP_DSN,
  environment:
    publicEnv.PUBLIC_APP_ENV ??
    (import.meta.env.DEV ? 'development' : 'production'),
  release: publicEnv.PUBLIC_APP_BUILD_SHA,
  tracesSampleRate: 1,
  traceLifecycle: 'static',
  integrations: (integrations) => [
    ...integrations.filter(
      (integration) => integration.name !== 'BrowserSession'
    ),
    Sentry.consoleLoggingIntegration()
  ]
});

export const handleError = Sentry.handleErrorWithSentry();
