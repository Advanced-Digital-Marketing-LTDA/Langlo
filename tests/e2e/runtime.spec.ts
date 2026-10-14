import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from '@playwright/test';

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
    const unavailable = await request.get(
      'http://127.0.0.1:4329/health/ready?answer=private-answer'
    );
    expect(unavailable.status()).toBe(503);
    const body = await unavailable.json();
    expect(body.message).toBe('Configuration unavailable. Please try again.');
    expect(body.correlationId).toBe(unavailable.headers()['x-correlation-id']);
    expect(JSON.stringify(body)).not.toMatch(
      /synthetic-secret|private-answer|stack|DATA_ENABLED/
    );
    await delay(30);
    expect(logs).toContain('configuration');
    expect(logs).not.toMatch(
      /synthetic-secret|private-answer|stack|DATA_ENABLED/
    );
  } finally {
    process.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (process.exitCode !== null || process.signalCode !== null) resolve();
      else process.once('exit', () => resolve());
    });
  }
});
