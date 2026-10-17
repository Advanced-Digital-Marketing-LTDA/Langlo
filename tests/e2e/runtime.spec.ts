import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { expect } from '@playwright/test';
import { test } from './coverage-fixture';

test('invalid runtime config fails safely while liveness remains independent', async ({
  request
}) => {
  const sentinel = 'synthetic-secret-invalid-flag';
  const process = spawn('node', ['build'], {
    env: {
      PATH: globalThis.process.env.PATH,
      HOST: '127.0.0.1',
      PORT: '4329',
      APP_ENV: 'test',
      APP_ORIGIN: 'http://127.0.0.1:4329',
      DATA_ENABLED: sentinel
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  process.stdout.on('data', (chunk) => {
    logs += String(chunk);
  });
  process.stderr.on('data', (chunk) => {
    logs += String(chunk);
  });
  try {
    const deadline = Date.now() + 4000;
    let started = false;
    while (Date.now() < deadline) {
      try {
        const live = await request.get('http://127.0.0.1:4329/health/live', {
          timeout: 500
        });
        if (live.status() === 200) {
          started = true;
          break;
        }
      } catch {
        /* Startup is bounded by the deadline. */
      }
      await delay(30);
    }
    expect(started).toBe(true);
    expect((await request.get('http://127.0.0.1:4329/')).status()).toBe(200);
    expect(
      (await request.get('http://127.0.0.1:4329/prototype')).status()
    ).toBe(200);
    expect((await request.get('http://127.0.0.1:4329/signup')).status()).toBe(
      200
    );
    const unavailable = await request.get(
      'http://127.0.0.1:4329/health/ready?answer=private-answer'
    );
    expect(unavailable.status()).toBe(503);
    const body = await unavailable.json();
    expect(body.status).toBe('not-ready');
    expect(logs).toContain('"variable":"DATA_ENABLED"');
    expect(JSON.stringify(body)).not.toMatch(
      /synthetic-secret|private-answer|stack/u
    );
    await delay(30);
    expect(logs).toContain('configuration');
    const authUnavailable = await request.get(
      'http://127.0.0.1:4329/api/auth/get-session'
    );
    expect(authUnavailable.status()).toBe(503);
    const authBody = await authUnavailable.json();
    expect(authBody.correlationId).toBe(
      authUnavailable.headers()['x-correlation-id']
    );
    await expect
      .poll(() => logs)
      .toContain(`"correlationId":"${authBody.correlationId}"`);
    expect(JSON.stringify(authBody)).not.toMatch(
      /synthetic-secret|private-answer|DATA_ENABLED/u
    );
    expect((await request.get('http://127.0.0.1:4329/app')).status()).toBe(503);
    expect(logs).not.toMatch(
      /synthetic-secret|private-answer|stack|synthetic-secret-invalid-flag/u
    );
  } finally {
    process.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (process.exitCode !== null || process.signalCode !== null) resolve();
      else process.once('exit', () => resolve());
    });
  }
});
