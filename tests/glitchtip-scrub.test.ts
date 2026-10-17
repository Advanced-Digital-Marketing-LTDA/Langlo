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
                module: 'learner-secret',
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
            frames: [{ lineno: 42 }]
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

it('preserves only generated application asset paths in exception frames', () => {
  expect(
    scrubTelemetryEvent({
      exception: {
        values: [
          {
            type: 'Error',
            stacktrace: {
              frames: [
                { filename: '/_app/immutable/nodes/18.CbCqnVdk.js' },
                { filename: '/workspace/learner/project/src/routes/+page.ts' },
                { filename: '/_app/immutable/nodes/../../secret.js' },
                { filename: '/_app/immutable/nodes/18.chunk.js?token=secret' }
              ]
            }
          }
        ]
      }
    }).exception
  ).toEqual({
    values: [
      {
        type: 'Error',
        stacktrace: {
          frames: [
            { filename: '/_app/immutable/nodes/18.CbCqnVdk.js' },
            {},
            {},
            {}
          ]
        }
      }
    ]
  });
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
      exception: {
        values: [
          {
            type: 'Error',
            stacktrace: {
              frames: [
                {
                  filename:
                    'https://langlo.example/app/api/attempts/private-answer?password=secret',
                  function: 'private-answer',
                  module: 'learner-secret',
                  lineno: 42,
                  colno: 'secret',
                  in_app: 'secret'
                }
              ]
            }
          }
        ]
      }
    })
  ).toEqual({
    exception: {
      values: [
        {
          type: 'Error',
          stacktrace: {
            frames: [
              {
                filename: 'https://langlo.example/app/api/attempts/:id',
                lineno: 42
              }
            ]
          }
        }
      ]
    }
  });
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
    'middleware',
    'browser.cache',
    'browser.dns',
    'browser.connect',
    'browser.tls_ssl',
    'browser.redirect',
    'browser.request',
    'browser.response',
    'browser.unload_event',
    'browser.dom_content_loaded_event',
    'browser.load_event',
    'resource.script',
    'resource.css',
    'resource.img',
    'resource.other'
  ]) {
    const phaseNames: Record<string, string> = {
      'browser.cache': 'Cache lookup',
      'browser.dns': 'DNS lookup',
      'browser.connect': 'Connect',
      'browser.tls_ssl': 'TLS handshake',
      'browser.redirect': 'Redirect',
      'browser.request': 'Request',
      'browser.response': 'Response',
      'browser.unload_event': 'Unload event',
      'browser.dom_content_loaded_event': 'DOMContentLoaded event',
      'browser.load_event': 'Load event'
    };
    const spanName = phaseNames[operation] ?? operation;
    expect(
      scrubTelemetrySpan({
        trace_id: 'trace-id',
        span_id: 'span-id',
        name: spanName,
        start_timestamp: 1,
        status: 'ok',
        is_segment: false,
        attributes: { 'sentry.op': operation }
      })
    ).toMatchObject({
      name: spanName,
      attributes: { 'sentry.op': operation }
    });
  }
  expect(
    scrubTelemetrySpan({
      trace_id: 'trace-id',
      span_id: 'span-id',
      name: 'DNS lookup',
      start_timestamp: 1,
      status: 'ok',
      is_segment: false,
      attributes: { 'sentry.op': 'browser.dns' }
    })
  ).toMatchObject({
    name: 'DNS lookup',
    attributes: { 'sentry.op': 'browser.dns' }
  });
  expect(
    scrubTelemetrySpan({
      trace_id: 'trace-id',
      span_id: 'span-id',
      name: 'learner.example.test',
      start_timestamp: 1,
      status: 'ok',
      is_segment: false,
      attributes: {
        'sentry.op': 'resource.script',
        'url.full': 'https://learner.example.test/private-answer?token=secret'
      }
    })
  ).toMatchObject({
    name: 'resource.script',
    attributes: { 'sentry.op': 'resource.script' }
  });
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

it('scrubs static transaction spans using the static span shape', () => {
  expect(
    scrubTelemetrySpan({
      trace_id: 'trace-id',
      span_id: 'span-id',
      description: 'GET /app/api/attempts/private-answer?token=secret',
      op: 'http.server',
      start_timestamp: 1,
      timestamp: 2,
      status: 'ok',
      is_segment: true,
      data: {
        'http.request.method': 'POST',
        'url.full':
          'https://langlo.example/app/api/attempts/private-answer?token=secret',
        answer: 'private answer'
      }
    })
  ).toEqual({
    trace_id: 'trace-id',
    span_id: 'span-id',
    description: 'GET /app/api/attempts/:id',
    op: 'http.server',
    start_timestamp: 1,
    timestamp: 2,
    status: 'ok',
    is_segment: true,
    data: { 'http.request.method': 'POST' }
  });
});

it('keeps only scrubbed transaction envelope fields in static mode', () => {
  expect(
    scrubTelemetryEvent({
      type: 'transaction',
      transaction: 'GET /app/api/attempts/private-answer?token=secret',
      start_timestamp: 1,
      timestamp: 2,
      request: {
        url: 'https://langlo.example/app/api/attempts/private-answer?token=secret',
        method: 'GET'
      },
      contexts: {
        trace: {
          trace_id: 'a'.repeat(32),
          span_id: 'b'.repeat(16),
          op: 'http.server',
          data: { answer: 'private' }
        },
        user: { email: 'learner@example.test' }
      },
      spans: [
        {
          trace_id: 'a'.repeat(32),
          span_id: 'c'.repeat(16),
          description: 'db.sql.query',
          op: 'db.sql.query',
          start_timestamp: 1,
          timestamp: 1.5,
          status: 'ok',
          data: { 'http.response.status_code': 200, sql: 'SELECT secret' }
        }
      ],
      extra: { answer: 'private' }
    })
  ).toEqual({
    type: 'transaction',
    transaction: 'GET /app/api/attempts/:id',
    start_timestamp: 1,
    timestamp: 2,
    request: {
      url: 'https://langlo.example/app/api/attempts/:id',
      method: 'GET'
    },
    contexts: {
      trace: {
        trace_id: 'a'.repeat(32),
        span_id: 'b'.repeat(16),
        op: 'http.server'
      }
    },
    spans: [
      {
        trace_id: 'a'.repeat(32),
        span_id: 'c'.repeat(16),
        description: 'db.sql.query',
        op: 'db.sql.query',
        start_timestamp: 1,
        timestamp: 1.5,
        status: 'ok',
        data: { 'http.response.status_code': 200 }
      }
    ]
  });
});
