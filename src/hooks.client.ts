import * as publicEnv from '$app/env/public';
import { getDefaultIntegrations } from '@sentry/browser';
import * as Sentry from '@sentry/sveltekit';
import {
  scrubTelemetryEvent,
  scrubTelemetrySpan
} from './lib/glitchtip/scrub-event';

Sentry.init({
  dsn: publicEnv.PUBLIC_GLITCHTIP_DSN,
  environment:
    publicEnv.PUBLIC_APP_ENV ??
    (import.meta.env.DEV ? 'development' : 'production'),
  release: publicEnv.PUBLIC_APP_BUILD_SHA,
  tracesSampleRate: 0.01,
  defaultIntegrations: getDefaultIntegrations({}).filter(
    (integration) => integration.name !== 'BrowserSession'
  ),
  beforeSend: scrubTelemetryEvent,
  beforeSendSpan: scrubTelemetrySpan
});

export const handleError = Sentry.handleErrorWithSentry();
