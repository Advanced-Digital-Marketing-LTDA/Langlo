import { beforeEach, expect, it, vi } from 'vitest';

const NAME = '__Secure-better-auth.session_token';
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
    origin: 'https://localhost:3000',
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
  // Like Better Auth, read only the first session cookie; "good" is live.
  mocks.getSession.mockImplementation(
    async ({ headers }: { headers: Headers }) => {
      const first = (headers.get('cookie') ?? '')
        .split('; ')
        .find((part) => part.startsWith(`${NAME}=`));
      return first === `${NAME}=good`
        ? { user: { id: 'learner-good' }, session: { id: 'session-good' } }
        : null;
    }
  );
});

async function visit(path: string, cookie: string) {
  const resolve = vi.fn().mockResolvedValue(new Response('app'));
  const url = new URL(path, 'https://localhost:3000');
  const event = {
    url,
    request: new Request(url, { headers: { cookie } }),
    locals: {} as Record<string, unknown>,
    getClientAddress: () => '192.0.2.10'
  };
  const response = await handle({ event, resolve } as unknown as Parameters<
    typeof handle
  >[0]);
  return { response, resolve, locals: event.locals };
}

it('signs in a protected route from the valid cookie behind a stale duplicate', async () => {
  const { response, resolve, locals } = await visit(
    '/app',
    `${NAME}=stale; ${NAME}=good`
  );
  expect(response.status).toBe(200);
  expect(resolve).toHaveBeenCalledOnce();
  expect((locals.user as { id: string }).id).toBe('learner-good');
  expect((locals.session as { id: string }).id).toBe('session-good');
});

it('still redirects a protected route to /login when every cookie is stale', async () => {
  const { response, resolve } = await visit(
    '/app',
    `${NAME}=stale; ${NAME}=old`
  );
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('/login');
  expect(resolve).not.toHaveBeenCalled();
});
