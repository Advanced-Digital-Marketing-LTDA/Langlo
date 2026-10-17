import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { test } from './coverage-fixture';

test('unexpected server errors keep responses and diagnostics private', () => {
  const probe = spawnSync(
    process.execPath,
    [
      'tests/fixtures/unexpected-error-probe.mjs',
      process.env.LANGLO_TEST_SERVER_BUILD ?? resolve('build/server')
    ],
    { encoding: 'utf8', timeout: 10000, env: { PATH: process.env.PATH } }
  );
  expect(probe.error).toBeUndefined();
  expect(probe.status).toBe(0);
  expect(probe.stderr).toBe('');
  const result = JSON.parse(probe.stdout);
  const correlationId = result.headers['x-correlation-id'];

  expect(result.endpointCalls).toBe(1);
  expect(result.status).toBe(500);
  expect(correlationId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
  expect(result.body).toEqual({
    message: 'Something went wrong. Please try again.',
    correlationId,
    status: 500
  });
  expect(result.warnings).toEqual([
    [
      JSON.stringify({
        operation: 'request',
        kind: 'unexpected',
        correlationId
      })
    ]
  ]);
  const visible = JSON.stringify({
    headers: result.headers,
    body: result.body,
    warnings: result.warnings
  });
  for (const marker of Object.values(result.markers)) {
    expect(visible).not.toContain(String(marker));
  }
  expect(visible).not.toMatch(/"(?:stack|answer|token)"/);
});
