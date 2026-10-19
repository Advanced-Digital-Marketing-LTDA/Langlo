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

  expect(options?.tracesSampleRate).toBe(0.25);
  expect(options?.traceLifecycle).toBe('static');
  expect(options).not.toHaveProperty('beforeSend');
  expect(options).not.toHaveProperty('beforeSendTransaction');
  expect(options).not.toHaveProperty('beforeSendSpan');
});

it('registers console log capture and turns console calls into logs', () => {
  const client = Sentry.getClient();
  expect(client?.getIntegrationByName('ConsoleLogs')).toBeDefined();

  const captured: { level: string; message: unknown }[] = [];
  const unsubscribe = client?.on('afterCaptureLog', (log) =>
    captured.push({ level: log.level, message: log.message })
  );
  console.warn('glitchtip-log-delivery-probe');
  unsubscribe?.();

  expect(captured).toContainEqual({
    level: 'warn',
    message: 'glitchtip-log-delivery-probe'
  });
});
