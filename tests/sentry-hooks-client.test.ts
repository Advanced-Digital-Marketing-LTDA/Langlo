import { expect, it, vi } from 'vitest';

vi.mock('$app/env/public', () => ({
  PUBLIC_GLITCHTIP_DSN: 'https://public@example.test/1',
  PUBLIC_APP_ENV: 'test',
  PUBLIC_APP_BUILD_SHA: 'test-sha'
}));
vi.mock('@sentry/sveltekit', () => ({
  init: vi.fn(),
  withStaticSpan: vi.fn((callback) => callback),
  handleErrorWithSentry: vi.fn(() => vi.fn())
}));
it('initializes browser telemetry with labels, sampling, and scrubbers', async () => {
  vi.resetModules();
  const Sentry = await import('@sentry/sveltekit');
  await import('../src/hooks.client');

  expect(Sentry.init).toHaveBeenCalledWith(
    expect.objectContaining({
      dsn: 'https://public@example.test/1',
      environment: 'test',
      release: 'test-sha',
      tracesSampleRate: 0.01,
      traceLifecycle: 'static',
      integrations: expect.any(Function),
      beforeSend: expect.any(Function),
      beforeSendTransaction: expect.any(Function),
      beforeSendSpan: expect.any(Function)
    })
  );
  const options = vi.mocked(Sentry.init).mock.calls[0]?.[0];
  const browserSession = { name: 'BrowserSession' };
  const svelteKitTracing = { name: 'SvelteKitBrowserTracing' };
  const filterIntegrations = options?.integrations;
  expect(typeof filterIntegrations).toBe('function');
  if (typeof filterIntegrations === 'function')
    expect(
      filterIntegrations([browserSession, svelteKitTracing] as never)
    ).toEqual([svelteKitTracing]);
});
