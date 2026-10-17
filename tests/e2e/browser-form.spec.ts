import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { type BrowserContext, expect } from '@playwright/test';
import { test } from './coverage-fixture';

async function reservePort(): Promise<number> {
  const probe = createServer();
  return new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() =>
        resolve(typeof address === 'object' && address ? address.port : 0)
      );
    });
  });
}

// A real browser derives the form POST Origin header from the page's
// Referrer-Policy; request-context tests set it by hand and cannot see this.
test('native signup form submission passes the same-origin check', async ({
  browser,
  request
}) => {
  const port = await reservePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['build'], {
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: String(port),
      APP_ENV: 'test',
      APP_ORIGIN: base,
      PROTOCOL_HEADER: 'x-forwarded-proto'
    },
    stdio: 'ignore'
  });
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-proto': 'http' }
    });
    const deadline = Date.now() + 4000;
    let started = false;
    while (!started && Date.now() < deadline) {
      try {
        started = (await request.get(`${base}/health/live`)).ok();
      } catch {
        /* Startup is bounded by the deadline. */
      }
      if (!started) await delay(30);
    }
    expect(started).toBe(true);
    const page = await context.newPage();
    await page.goto(`${base}/signup`);
    await page.getByLabel('Name').fill('Synthetic Learner');
    await page.getByLabel('Email').fill('synthetic@example.test');
    await page.getByLabel('Password').fill('synthetic-password-0000');
    const posted = page.waitForResponse(
      (response) => response.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Create account' }).click();
    const response = await posted;
    expect(response.request().headers()['origin']).toBe(base);
    expect(response.status()).not.toBe(403);
    await expect(page.locator('body')).not.toContainText('Cross-site');
  } finally {
    await context?.close();
    server.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (server.exitCode !== null || server.signalCode !== null) resolve();
      else server.once('exit', () => resolve());
    });
  }
});
