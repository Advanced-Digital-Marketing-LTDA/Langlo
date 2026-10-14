import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  handler: vi.fn(),
  resolveAuth: vi.fn()
}));
vi.mock('$app/env/private', () => ({}));
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

async function request(path: string, method = 'POST') {
  const resolve = vi.fn().mockResolvedValue(new Response('public'));
  const event = {
    url: new URL(path, 'http://localhost:3000'),
    request: new Request(new URL(path, 'http://localhost:3000'), { method }),
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
