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

function captureLogs(emit: () => void) {
  const captured: { level: string; message: unknown }[] = [];
  const unsubscribe = Sentry.getClient()?.on('afterCaptureLog', (log) =>
    captured.push({ level: log.level, message: log.message })
  );
  emit();
  unsubscribe?.();
  return captured;
}

it.each([
  ['debug', 'debug'],
  ['info', 'info'],
  ['log', 'info'],
  ['warn', 'warn'],
  ['error', 'error']
] as const)(
  'captures console.%s as a %s-level log',
  (method, expectedLevel) => {
    const captured = captureLogs(() =>
      console[method](`glitchtip-level-probe-${method}`)
    );

    expect(captured).toEqual([
      { level: expectedLevel, message: `glitchtip-level-probe-${method}` }
    ]);
  }
);

// Node's console.trace and console.assert call console.error / console.warn
// internally, so the SDK also records that call; both levels are asserted.
it('captures console.trace as a trace-level log', () => {
  const captured = captureLogs(() =>
    console.trace('glitchtip-level-probe-trace')
  );

  expect(captured).toContainEqual({
    level: 'trace',
    message: 'glitchtip-level-probe-trace'
  });
});

it('captures a failed console.assert as an error-level log, and a passing one not at all', () => {
  const captured = captureLogs(() => {
    console.assert(false, 'glitchtip-level-probe-assert');
    console.assert(true, 'glitchtip-level-probe-assert-passing');
  });

  expect(captured).toContainEqual({
    level: 'error',
    message: 'Assertion failed: glitchtip-level-probe-assert'
  });
  expect(JSON.stringify(captured)).not.toContain('assert-passing');
});
