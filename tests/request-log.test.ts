import { beforeAll, expect, it } from 'vitest';
import * as Sentry from '@sentry/sveltekit';
import type { Handle } from '@sveltejs/kit/hooks';
import { requestLog } from '../src/lib/server/request-log';

type Captured = {
  level: unknown;
  message: unknown;
  attributes?: Record<string, unknown>;
};

beforeAll(() => {
  Sentry.init({ dsn: 'https://public@example.test/1' });
});

function run(path: string, status: number, correlationId = 'req-1') {
  const captured: Captured[] = [];
  const unsubscribe = Sentry.getClient()?.on('afterCaptureLog', (log) =>
    captured.push({
      level: log.level,
      message: log.message,
      attributes: log.attributes
    })
  );
  const event = {
    url: new URL(path, 'http://localhost:3000'),
    request: new Request(new URL(path, 'http://localhost:3000'), {
      method: 'POST'
    }),
    locals: { correlationId }
  };
  const result = (requestLog as Handle)({
    event,
    resolve: async () => new Response(null, { status })
  } as unknown as Parameters<Handle>[0]);
  return Promise.resolve(result).then((response) => {
    unsubscribe?.();
    return { captured, response };
  });
}

const value = (log: Captured | undefined, key: string) => {
  const attribute = log?.attributes?.[key];
  return attribute && typeof attribute === 'object' && 'value' in attribute
    ? attribute.value
    : attribute;
};

it('logs one line per request with method, raw path, status and request id', async () => {
  const { captured, response } = await run('/app/learn?x=1', 303);

  expect(response.status).toBe(303);
  expect(captured).toHaveLength(1);
  expect(captured[0].message).toBe('POST /app/learn 303');
  expect(value(captured[0], 'status')).toBe(303);
  expect(value(captured[0], 'path')).toBe('/app/learn');
  expect(value(captured[0], 'correlation_id')).toBe('req-1');
  expect(Number(value(captured[0], 'duration_ms'))).toBeGreaterThanOrEqual(0);
});

it('redacts the password-reset token from the logged message and path', async () => {
  const { captured } = await run('/api/auth/reset-password/abc123', 302);

  expect(captured).toHaveLength(1);
  expect(captured[0].message).toBe('POST /api/auth/reset-password/:token 302');
  expect(value(captured[0], 'path')).toBe('/api/auth/reset-password/:token');
  expect(JSON.stringify(captured)).not.toContain('abc123');
});

it('logs the root path unchanged', async () => {
  const { captured } = await run('/', 200);

  expect(captured[0].message).toBe('POST / 200');
});

it.each(['/health/live', '/health/live/'])(
  'does not log liveness probe %s',
  async (path) => {
    const { captured, response } = await run(path, 200);

    expect(response.status).toBe(200);
    expect(captured).toEqual([]);
  }
);

it('logs a failed request at error level with status 500, then rethrows', async () => {
  const captured: Captured[] = [];
  const unsubscribe = Sentry.getClient()?.on('afterCaptureLog', (log) =>
    captured.push({
      level: log.level,
      message: log.message,
      attributes: log.attributes
    })
  );
  const event = {
    url: new URL('/boom', 'http://localhost:3000'),
    request: new Request('http://localhost:3000/boom'),
    locals: { correlationId: 'req-9' }
  };

  await expect(
    (requestLog as Handle)({
      event,
      resolve: async () => {
        throw new Error('render failed');
      }
    } as unknown as Parameters<Handle>[0])
  ).rejects.toThrow('render failed');
  unsubscribe?.();

  expect(captured).toHaveLength(1);
  expect(captured[0].level).toBe('error');
  expect(captured[0].message).toBe('GET /boom 500');
  expect(value(captured[0], 'correlation_id')).toBe('req-9');
});
