import {
  expect,
  type Page,
  type Request,
  type Response
} from '@playwright/test';
import { test } from './coverage-fixture';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createFixtureDatabase,
  disposeFixtureDatabase,
  reservePort,
  runNode,
  waitForLive
} from './fixture-server';

const password = randomBytes(16).toString('hex');
let server: ChildProcess;
let base = '';
let fixtureRoot = '';
let dbFile = '';
let mailDir = '';

const appEnv = () => ({
  ...process.env,
  APP_ENV: 'test',
  APP_ORIGIN: base,
  DATA_ENABLED: 'true',
  DATABASE_URL: `file://${dbFile}`,
  BETTER_AUTH_SECRET: 'e2e-only-auth-secret-0000000000000000',
  MAIL_TRANSPORT: 'capture',
  MAIL_CAPTURE_DIR: mailDir
});

function isRecoveryNavigation(request: Request): boolean {
  if (!request.isNavigationRequest()) return false;
  if (request.resourceType() !== 'document') return false;
  return new URL(request.url()).pathname === '/recover';
}

function isRecoveryPost(request: Request): boolean {
  if (request.method() !== 'POST') return false;
  return isRecoveryNavigation(request);
}

function isRecoveryGet(response: Response): boolean {
  const request = response.request();
  if (request.method() !== 'GET') return false;
  return isRecoveryNavigation(request);
}

function trackRecoveryNavigations(page: Page) {
  const methods: string[] = [];
  let posts = 0;
  page.on('request', (request) => {
    if (!isRecoveryNavigation(request)) return;
    const method = request.method();
    methods.push(method);
    if (method === 'POST') posts += 1;
  });
  return { methods, postCount: () => posts };
}

async function capturedMailCount(): Promise<number> {
  return (await readdir(mailDir)).filter((name) => name.endsWith('.json'))
    .length;
}

test.beforeAll(async () => {
  const port = await reservePort();
  base = `http://127.0.0.1:${port}`;
  ({ fixtureRoot, dbFile } = createFixtureDatabase());
  mailDir = join(fixtureRoot, 'mail');
  await mkdir(mailDir, { recursive: true });
  runNode(
    [
      'scripts/accounts-provision.ts',
      '--app',
      '--email',
      'e2e@example.test',
      '--name',
      'E2E Learner'
    ],
    password,
    appEnv()
  );
  server = spawn(process.execPath, ['build'], {
    cwd: process.cwd(),
    env: {
      ...appEnv(),
      HOST: '127.0.0.1',
      PORT: String(port),
      ORIGIN: base,
      PROTOCOL_HEADER: 'x-forwarded-proto'
    },
    stdio: 'ignore'
  });
  await waitForLive(base);
});

test.afterAll(async () => {
  server?.kill();
  await disposeFixtureDatabase(fixtureRoot, dbFile);
});

test('version refresh after recovery uses GET without resending the reset email', async ({
  context,
  page
}) => {
  const versionResponse = await context.request.get(
    `${base}/_app/version.json`
  );
  const currentVersion = (await versionResponse.json()) as { version: string };
  await page.goto('about:blank');
  await page.clock.install();
  let reportUpdate = false;
  let updateWasServed = false;
  await page.route('**/version.json', (route) => {
    if (reportUpdate) updateWasServed = true;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: reportUpdate
          ? 'next-synthetic-version'
          : currentVersion.version
      })
    });
  });

  const recovery = trackRecoveryNavigations(page);
  const baselineMailCount = await capturedMailCount();
  await context.setExtraHTTPHeaders({ 'x-forwarded-proto': 'http' });
  await page.goto(`${base}/recover`);
  await page.getByLabel('Email').fill('e2e@example.test');
  await Promise.all([
    page.waitForRequest(isRecoveryPost),
    page.getByRole('button', { name: 'Send reset link' }).click()
  ]);
  await expect(page.getByRole('status')).toBeVisible();
  expect(recovery.postCount()).toBe(1);
  expect(await capturedMailCount()).toBe(baselineMailCount + 1);

  reportUpdate = true;
  const versionUpdate = page.waitForResponse(
    (response) => new URL(response.url()).pathname.endsWith('/version.json'),
    { timeout: 5000 }
  );
  const refreshedDocument = page.waitForResponse(isRecoveryGet, {
    timeout: 5000
  });
  await page.clock.fastForward(300_000);
  await versionUpdate;
  expect((await refreshedDocument).status()).toBe(200);
  expect(updateWasServed).toBe(true);
  await expect(
    page.getByRole('button', { name: 'Send reset link' })
  ).toBeVisible();
  expect(recovery.postCount()).toBe(1);
  expect(recovery.methods).toEqual(['GET', 'POST', 'GET']);
  expect(await capturedMailCount()).toBe(baselineMailCount + 1);
});
