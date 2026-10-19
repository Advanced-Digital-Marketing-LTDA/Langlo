import { expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({
  APP_ENV: 'production',
  APP_BUILD_SHA: 'test-sha'
}));
vi.mock('$app/env/public', () => ({
  PUBLIC_GLITCHTIP_DSN: 'https://public@example.test/1'
}));
vi.mock('@sveltejs/kit/hooks', () => ({
  sequence: (...handlers: unknown[]) => handlers
}));
import { handle } from '../src/hooks.server';
import { requestLog } from '../src/lib/server/request-log';

it('runs the request log ahead of the app handle', () => {
  const handlers = handle as unknown as unknown[];

  expect(handlers).toHaveLength(3);
  expect(handlers[1]).toBe(requestLog);
});
