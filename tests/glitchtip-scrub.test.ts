import { expect, it } from 'vitest';
import {
  scrubTelemetryEvent,
  scrubTelemetrySpan
} from '../src/lib/glitchtip/scrub-event';

it('removes learner data and secrets from captured errors', () => {
  const event = {
    event_id: 'event-id',
    environment: 'production',
    request: {
      url: 'https://langlo.example/app/api/study-sessions/123e4567-e89b-12d3-a456-426614174000?token=secret',
      method: 'POST',
      headers: { cookie: 'session=secret', authorization: 'Bearer secret' },
      data: { answer: 'learner response' },
      query_string: 'token=secret'
    },
    user: { id: 'learner-17', email: 'learner@example.test' },
    extra: { form: 'learner response' },
    message: 'answer=learner response',
    breadcrumbs: [
      {
        timestamp: 1,
        category: 'ui.click',
        message: 'clicked submit',
        data: { answer: 'learner response' }
      }
    ],
    exception: {
      values: [
        {
          type: 'Error',
          value: 'token=secret answer=learner response',
          stacktrace: {
            frames: [
              {
                filename: '/app/page.js',
                function: 'load',
                lineno: 42,
                vars: { answer: 'learner response' }
              }
            ]
          }
        }
      ]
    },
    contexts: { user: { username: 'learner-17' } },
    server_name: 'learner-laptop',
    transaction:
      '/app/api/study-sessions/123e4567-e89b-12d3-a456-426614174000?token=secret'
  };

  const scrubbed = scrubTelemetryEvent(event);

  expect(scrubbed).toEqual({
    event_id: 'event-id',
    environment: 'production',
    request: {
      url: 'https://langlo.example/app/api/study-sessions/:id',
      method: 'POST'
    },
    breadcrumbs: [{ timestamp: 1, category: 'ui.click' }],
    exception: {
      values: [
        {
          type: 'Error',
          stacktrace: {
            frames: [{ filename: '/app/page.js', function: 'load', lineno: 42 }]
          }
        }
      ]
    },
    transaction: '/app/api/study-sessions/:id'
  });
  expect(JSON.stringify(scrubbed)).not.toMatch(
    /learner|learner@example|learner response|secret|123e4567/iu
  );
  expect(
    scrubTelemetryEvent({
      transaction: '/app/api/notes/learner%40example.test/approve?token=secret'
    }).transaction
  ).toBe('/app/api/notes/:id/approve');
  expect(event.request.data).toEqual({ answer: 'learner response' });
});

it('drops malformed private fields and validates retained metadata', () => {
  expect(
    scrubTelemetryEvent({
      request: { method: 'POST /learner-answer' },
      breadcrumbs: [
        { category: 'ui.click', level: 'info', type: 'ui' },
        {
          category: 'learner@example.test',
          level: 'answer=secret',
          type: 'user'
        }
      ],
      exception: { values: [{ type: 'learner answer: secret' }] },
      transaction: 'learner@example.test answer=secret'
    })
  ).toEqual({
    request: {},
    breadcrumbs: [
      { category: 'ui.click', level: 'info', type: 'ui' },
      { type: 'user' }
    ],
    exception: { values: [{}] }
  });

  expect(
    scrubTelemetryEvent({
      exception: 'learner answer: secret',
      transaction: 'learner answer: secret'
    })
  ).toEqual({});
  expect(
    scrubTelemetryEvent({
      request: 'token=secret',
      breadcrumbs: 'answer=private'
    })
  ).toEqual({});
});

it('sanitizes method-prefixed transaction names and drops unsafe ones', () => {
  expect(
    scrubTelemetryEvent({
      transaction: 'GET /app/assessment/session/123?token=secret'
    }).transaction
  ).toBe('GET /app/assessment/session/:id');

  expect(
    scrubTelemetryEvent({
      transaction: 'GET /app/assessment/session/learner%40example.test'
    })
  ).toEqual({
    transaction: 'GET /app/assessment/session/:id'
  });
});

it.each([
  ['/app/map', '/app/map'],
  [
    'https://langlo.example/app/learn/en/lesson/greetings',
    'https://langlo.example/app/learn/:language/lesson/:skill'
  ],
  [
    '/app/api/attempts/private-answer?token=secret#answer',
    '/app/api/attempts/:id'
  ],
  ['/app/api/unknown/private-answer', undefined],
  [
    '/app/api/attempts/abcdefghijklmnopqrstuvwxyz0123456789',
    '/app/api/attempts/:id'
  ],
  ['javascript:alert(1)', undefined]
])('keeps only safe transaction locations: %s', (input, expected) => {
  const result = scrubTelemetryEvent({ transaction: input });
  if (expected === undefined) expect(result).toEqual({});
  else expect(result.transaction).toBe(expected);
});

it('redacts named dynamic route parameters in requests and spans', () => {
  expect(
    scrubTelemetryEvent({
      request: { url: '/app/api/attempts/private-answer' }
    }).request
  ).toEqual({ url: '/app/api/attempts/:id' });

  expect(
    scrubTelemetrySpan({
      trace_id: 'trace-id',
      span_id: 'span-id',
      name: 'POST /app/api/attempts/private-answer',
      start_timestamp: 1,
      status: 'error',
      is_segment: true,
      attributes: { 'http.route': '/app/api/attempts/private-answer' }
    })
  ).toMatchObject({
    name: 'POST /app/api/attempts/:id',
    attributes: { 'http.route': '/app/api/attempts/:id' }
  });
});

it('removes span details while retaining trace timing and operation names', () => {
  const scrubbed = scrubTelemetrySpan({
    trace_id: 'trace-id',
    span_id: 'span-id',
    name: 'POST /app/api/attempts/91?email=learner%40example.test',
    start_timestamp: 1,
    end_timestamp: 2,
    status: 'ok',
    is_segment: true,
    attributes: {
      'sentry.op': 'http.server',
      'http.request.method': 'POST',
      'http.route': '/app/api/attempts/91',
      'url.full': 'https://langlo.example/app/api/attempts/91?token=secret',
      'db.query.text': 'select * from answers where answer = secret'
    }
  });

  expect(scrubbed).toEqual({
    trace_id: 'trace-id',
    span_id: 'span-id',
    name: 'POST /app/api/attempts/:id',
    start_timestamp: 1,
    end_timestamp: 2,
    status: 'ok',
    is_segment: true,
    attributes: {
      'sentry.op': 'http.server',
      'http.request.method': 'POST',
      'http.route': '/app/api/attempts/:id'
    }
  });
  expect(JSON.stringify(scrubbed)).not.toMatch(/learner|secret|answers/iu);

  expect(
    scrubTelemetrySpan({
      trace_id: 'trace-id',
      span_id: 'span-id',
      name: '/app/map',
      start_timestamp: 1,
      status: 'ok',
      is_segment: true,
      attributes: { 'sentry.op': 'navigation' }
    })
  ).toMatchObject({
    name: '/app/map',
    attributes: { 'sentry.op': 'navigation' }
  });
  expect(
    scrubTelemetrySpan({
      trace_id: 'trace-id',
      span_id: 'span-id',
      name: 'learner-answer',
      start_timestamp: 1,
      status: 'learner answer secret',
      is_segment: true,
      attributes: { 'sentry.op': 'learner-answer' }
    })
  ).toMatchObject({ name: 'operation', attributes: {} });
  for (const operation of [
    'pageload',
    'navigation',
    'router',
    'handler',
    'middleware'
  ]) {
    expect(
      scrubTelemetrySpan({
        trace_id: 'trace-id',
        span_id: 'span-id',
        name: operation,
        start_timestamp: 1,
        status: 'ok',
        is_segment: false,
        attributes: { 'sentry.op': operation }
      })
    ).toMatchObject({
      name: operation,
      attributes: { 'sentry.op': operation }
    });
  }
  expect(
    scrubTelemetrySpan({
      trace_id: 'trace-id',
      span_id: 'span-id',
      name: 'learner-answer',
      start_timestamp: 1,
      status: 'learner answer secret',
      is_segment: true,
      attributes: {}
    }).status
  ).toBeUndefined();
  expect(
    scrubTelemetrySpan({
      trace_id: 'trace-id',
      span_id: 'span-id',
      name: 'http.server',
      start_timestamp: 1,
      status: 'error',
      is_segment: true,
      attributes: {}
    }).status
  ).toBe('error');
});
