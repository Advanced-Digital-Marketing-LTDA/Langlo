import { expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  httpIntegration: vi.fn((options: { sessions: boolean }) => ({
    name: 'Http',
    options
  })),
  sentryHandle: vi.fn(() => vi.fn()),
  handleErrorWithSentry: vi.fn(() => vi.fn())
}));

vi.mock('$app/env/private', () => ({
  APP_ENV: 'production',
  APP_BUILD_SHA: 'test'
}));
vi.mock('$app/env/public', () => ({
  PUBLIC_GLITCHTIP_DSN: 'https://public@example.test/1'
}));
vi.mock('@sentry/sveltekit', () => sentry);

it('disables server release-health sessions and preserves SvelteKit integrations', async () => {
  vi.resetModules();
  const Sentry = await import('@sentry/sveltekit');
  await import('../src/hooks.server');

  const options = vi.mocked(Sentry.init).mock.calls[0]?.[0];
  const integrations = options?.integrations;
  expect(typeof integrations).toBe('function');
  if (typeof integrations !== 'function') return;

  const result = integrations([
    { name: 'Http' },
    { name: 'ProcessSession' },
    { name: 'SvelteKitSpans' }
  ] as never);

  expect(sentry.httpIntegration).toHaveBeenCalledWith({ sessions: false });
  expect(result).toEqual([
    { name: 'Http', options: { sessions: false } },
    { name: 'SvelteKitSpans' }
  ]);
});
