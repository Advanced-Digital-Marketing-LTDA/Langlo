import { expect, it, vi } from 'vitest';

vi.mock('$app/env/public', () => ({
  PUBLIC_GLITCHTIP_DSN: 'https://public@example.test/1',
  PUBLIC_APP_ENV: 'test',
  PUBLIC_APP_BUILD_SHA: 'test-sha'
}));
vi.mock('@sentry/sveltekit', () => ({
  init: vi.fn(),
  handleErrorWithSentry: vi.fn(() => vi.fn())
}));
vi.mock('@sentry/browser', () => ({
  getDefaultIntegrations: () => [
    { name: 'BrowserSession' },
    { name: 'BrowserApiErrors' }
  ]
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
      defaultIntegrations: [{ name: 'BrowserApiErrors' }],
      beforeSend: expect.any(Function),
      beforeSendSpan: expect.any(Function)
    })
  );
});
