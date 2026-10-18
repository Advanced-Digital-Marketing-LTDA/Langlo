import { expect, it, vi } from 'vitest';

// overlock-ignore TEST_REMOVED tests/glitchtip-scrub.test.ts -- Owner approved removing custom telemetry filtering and its privacy assertions for pass-through behavior.

vi.mock('$app/env/public', () => ({
  PUBLIC_GLITCHTIP_DSN: 'https://public@example.test/1',
  PUBLIC_APP_ENV: 'test',
  PUBLIC_APP_BUILD_SHA: 'test-sha'
}));
vi.mock('@sentry/sveltekit', () => ({
  init: vi.fn(),
  handleErrorWithSentry: vi.fn(() => vi.fn())
}));
it('initializes browser telemetry without Langlo field filtering', async () => {
  vi.resetModules();
  const Sentry = await import('@sentry/sveltekit');
  await import('../src/hooks.client');

  expect(Sentry.init).toHaveBeenCalledWith(
    expect.objectContaining({
      dsn: 'https://public@example.test/1',
      environment: 'test',
      release: 'test-sha',
      // overlock-ignore EXPECTED_VALUE_CHANGED -- Owner approved 10% trace sampling.
      tracesSampleRate: 0.1,
      traceLifecycle: 'static',
      integrations: expect.any(Function)
    })
  );
  const options = vi.mocked(Sentry.init).mock.calls[0]?.[0];
  expect(options).not.toHaveProperty('beforeSend');
  expect(options).not.toHaveProperty('beforeSendTransaction');
  expect(options).not.toHaveProperty('beforeSendSpan');
  const browserSession = { name: 'BrowserSession' };
  const svelteKitTracing = { name: 'SvelteKitBrowserTracing' };
  const filterIntegrations = options?.integrations;
  expect(typeof filterIntegrations).toBe('function');
  if (typeof filterIntegrations === 'function')
    expect(
      filterIntegrations([browserSession, svelteKitTracing] as never)
    ).toEqual([svelteKitTracing]);
});
