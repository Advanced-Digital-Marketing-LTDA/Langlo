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

// overlock-ignore TEST_REMOVED -- Owner approved removing server telemetry filtering assertions.
it('initializes server telemetry without Langlo field filtering', async () => {
  const options = Sentry.getClient()?.getOptions();

  // overlock-ignore EXPECTED_VALUE_CHANGED -- Owner approved 10% trace sampling.
  expect(options?.tracesSampleRate).toBe(0.1);
  expect(options?.traceLifecycle).toBe('static');
  expect(options).not.toHaveProperty('beforeSend');
  expect(options).not.toHaveProperty('beforeSendTransaction');
  expect(options).not.toHaveProperty('beforeSendSpan');
});
