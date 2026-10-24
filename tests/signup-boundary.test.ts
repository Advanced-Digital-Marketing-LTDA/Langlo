import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  handler: vi.fn(),
  resolveAuth: vi.fn()
}));
vi.mock('$app/env/private', () => ({
  APP_ENV: undefined,
  APP_BUILD_SHA: undefined
}));
vi.mock('$app/env/public', () => ({
  PUBLIC_GLITCHTIP_DSN: undefined,
  PUBLIC_APP_ENV: undefined,
  PUBLIC_APP_BUILD_SHA: undefined
}));
vi.mock('@sveltejs/kit/hooks', async (importOriginal) => {
  const original = await importOriginal<typeof import('@sveltejs/kit/hooks')>();
  return {
    ...original,
    sequence: (...handlers: Parameters<typeof original.sequence>) =>
      handlers.at(-1)!
  };
});
vi.mock('../src/lib/server/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/server/config')>()),
  parseRuntimeConfig: () => ({
    environment: 'test',
    origin: 'http://localhost:3000',
    dataEnabled: true,
    revision: 'unknown'
  })
}));
vi.mock('../src/lib/server/auth-runtime', () => ({
  resolveAuth: mocks.resolveAuth
}));
import { handle } from '../src/hooks.server';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolveAuth.mockResolvedValue({
    api: { getSession: mocks.getSession },
    handler: mocks.handler
  });
  mocks.getSession.mockResolvedValue(null);
  mocks.handler.mockResolvedValue(Response.json({ ok: true }));
});

async function request(
  path: string,
  method = 'POST',
  headers?: Record<string, string>,
  body = ''
) {
  const resolve = vi.fn(async (boundedEvent?: { request: Request }) => {
    // Framework handlers turn body errors into responses before resolve returns.
    try {
      if (boundedEvent) await boundedEvent.request.text();
    } catch {
      return new Response('Framework error', { status: 500 });
    }
    return new Response('public');
  });
  const event = {
    url: new URL(path, 'http://localhost:3000'),
    request: new Request(new URL(path, 'http://localhost:3000'), {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body
    }),
    locals: {},
    getClientAddress: () => '192.0.2.10'
  };
  const response = await handle({ event, resolve } as unknown as Parameters<
    typeof handle
  >[0]);
  return { response, resolve };
}

it.each(['GET', 'POST'])(
  'fails closed on signup session lookup failure (%s)',
  async (method) => {
    mocks.getSession.mockRejectedValue(new Error('synthetic database outage'));
    const { response, resolve } = await request('/signup', method);
    expect(response.status).toBe(503);
    expect(resolve).not.toHaveBeenCalled();
    expect(mocks.handler).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
  }
);

it('preserves public pages during session service failure', async () => {
  mocks.getSession.mockRejectedValue(new Error('synthetic database outage'));
  const { response, resolve } = await request('/', 'GET');
  expect(response.status).toBe(200);
  expect(resolve).toHaveBeenCalledOnce();
  expect(mocks.getSession).not.toHaveBeenCalled();
});

it('denies API registration with an existing session before the auth handler', async () => {
  mocks.getSession.mockResolvedValue({
    user: { id: 'learner-a' },
    session: { id: 'session-a' }
  });
  const { response } = await request('/api/auth/sign-up/email');
  expect(response.status).toBe(409);
  expect(mocks.handler).not.toHaveBeenCalled();
  expect(response.headers.get('set-cookie')).toBeNull();
});

it('denies API registration when session identity cannot be checked', async () => {
  mocks.getSession.mockRejectedValue(new Error('synthetic database outage'));
  const { response } = await request('/api/auth/sign-up/email');
  expect(response.status).toBe(503);
  expect(mocks.handler).not.toHaveBeenCalled();
});

it('allows anonymous API registration to reach auth', async () => {
  const { response } = await request('/api/auth/sign-up/email');
  expect(response.status).toBe(200);
  expect(mocks.handler).toHaveBeenCalledOnce();
});

it('rejects oversized public form bodies before auth handling', async () => {
  const { response, resolve } = await request('/signup', 'POST', {
    'content-length': String(512 * 1024 + 1)
  });
  expect(response.status).toBe(413);
  expect(resolve).not.toHaveBeenCalled();
  expect(mocks.handler).not.toHaveBeenCalled();
});

it('keeps the larger body allowance scoped to the upload action', async () => {
  const { response, resolve } = await request('/app/library?/upload', 'POST', {
    'content-length': String(10 * 1024 * 1024)
  });
  expect(response.status).toBe(401);
  expect(resolve).not.toHaveBeenCalled();
});

it('bounds chunked auth API requests when Content-Length is absent', async () => {
  mocks.handler.mockImplementation(async (boundedRequest: Request) => {
    try {
      await boundedRequest.text();
    } catch {
      return new Response(null, { status: 500 });
    }
    return Response.json({ ok: true });
  });
  const { response } = await request(
    '/api/auth/sign-up/email',
    'POST',
    { 'content-type': 'application/json' },
    'x'.repeat(512 * 1024 + 1)
  );
  expect(response.status).toBe(413);
});

it('bounds chunked public form bodies without Content-Length', async () => {
  const { response, resolve } = await request(
    '/signup',
    'POST',
    { 'content-type': 'application/x-www-form-urlencoded' },
    `value=${'x'.repeat(512 * 1024)}`
  );
  expect(response.status).toBe(413);
  expect(resolve).not.toHaveBeenCalled();
});
