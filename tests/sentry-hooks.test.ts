import { expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({
  APP_ENV: 'production',
  APP_BUILD_SHA: 'test-sha'
}));
vi.mock('$app/env/public', () => ({
  PUBLIC_GLITCHTIP_DSN: 'https://public@example.test/1'
}));
import '../src/hooks.server';
import * as Sentry from '@sentry/sveltekit';

it('initializes server telemetry with sampled traces and event scrubbing', async () => {
  const options = Sentry.getClient()?.getOptions();

  expect(options?.tracesSampleRate).toBe(0.01);
  expect(options?.traceLifecycle).toBe('static');

  const event = {
    event_id: 'event-id',
    type: undefined,
    request: {
      url: 'https://langlo.example/app/api/attempts/91?token=secret',
      headers: { authorization: 'Bearer secret' },
      data: { answer: 'learner response' }
    }
  };
  const scrubbed = options?.beforeSend?.(event, {} as never);

  expect(scrubbed).toEqual({
    event_id: 'event-id',
    request: { url: 'https://langlo.example/app/api/attempts/:id' }
  });

  const span = options?.beforeSendSpan?.({
    trace_id: 'trace-id',
    span_id: 'span-id',
    name: 'POST /app/api/attempts/91?token=secret',
    start_timestamp: 1,
    status: 'ok',
    is_segment: true,
    attributes: {
      'http.request.method': 'POST',
      'url.full': 'https://langlo.example/app/api/attempts/91?token=secret'
    }
  } as never);

  expect(span?.name).toBe('POST /app/api/attempts/:id');
  expect(span?.attributes).toEqual({ 'http.request.method': 'POST' });
});
