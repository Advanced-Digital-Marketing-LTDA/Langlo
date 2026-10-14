import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { type BrowserContext, expect, test } from '@playwright/test';

// A real browser derives the form POST Origin header from the page's
// Referrer-Policy; request-context tests set it by hand and cannot see this.
test('native signup form submission passes the same-origin check', async ({
  browser,
  request
}) => {
  const base = 'http://127.0.0.1:4331';
  const server = spawn('node', ['build'], {
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: '4331',
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
    while (Date.now() < deadline) {
      try {
        if ((await request.get(`${base}/health/live`)).ok()) break;
      } catch {
        /* Startup is bounded by the deadline. */
      }
      await delay(30);
    }
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
    server.kill();
  }
});
