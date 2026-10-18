import { expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({
  APP_ENV: 'production',
  APP_BUILD_SHA: 'test-sha'
}));
vi.mock('$app/env/public', () => ({
  PUBLIC_GLITCHTIP_DSN: 'https://public@example.test/1'
}));
import '../src/hooks.server';
import * as Sentry from '@sentry/sveltekit';

it('initializes server telemetry without Langlo field filtering', async () => {
  const options = Sentry.getClient()?.getOptions();

  expect(options?.tracesSampleRate).toBe(0.1);
  expect(options?.traceLifecycle).toBe('static');
  expect(options).not.toHaveProperty('beforeSend');
  expect(options).not.toHaveProperty('beforeSendTransaction');
  expect(options).not.toHaveProperty('beforeSendSpan');
});
