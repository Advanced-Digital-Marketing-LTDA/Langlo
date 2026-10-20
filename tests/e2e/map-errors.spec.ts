import { expect, request, type APIRequestContext } from '@playwright/test';
import { test } from './coverage-fixture';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createClient } from '@libsql/client/sqlite3';
import { importContent } from '../../src/lib/server/content-import';
import { approvedPackage } from '../fixtures/content-package';
import {
  createFixtureDatabase,
  disposeFixtureDatabase,
  reservePort,
  runNode as run,
  waitForLive
} from './fixture-server';

// The skill map streams each track's catalog and progress. Server rendering
// only draws the loading state, so the per-track error alerts are checked in
// a real browser against a built server whose tables are broken on purpose.

const learnerSecret = randomBytes(16).toString('hex');
let server: ChildProcess;
let serverLog = '';
let base = '';
let fixtureRoot = '';
let dbFile = '';
let userId = '';
let learner: APIRequestContext;

const appEnv = () => ({
  ...process.env,
  APP_ENV: 'test',
  APP_ORIGIN: base,
  DATA_ENABLED: 'true',
  DATABASE_URL: `file://${dbFile}`,
  BETTER_AUTH_SECRET: 'e2e-only-auth-secret-0000000000000000',
  MAIL_TRANSPORT: 'capture',
  MAIL_CAPTURE_DIR: join(fixtureRoot, 'mail')
});

async function withDatabase(
  work: (client: ReturnType<typeof createClient>) => Promise<void>
) {
  const client = createClient({ url: `file://${dbFile}` });
  try {
    await work(client);
  } finally {
    client.close();
  }
}

test.beforeEach(async () => {
  const port = await reservePort();
  base = `http://127.0.0.1:${port}`;
  ({ fixtureRoot, dbFile } = createFixtureDatabase());
  run(
    [
      'scripts/accounts-provision.ts',
      '--app',
      '--email',
      'mapper@example.test',
      '--name',
      'Mapper'
    ],
    learnerSecret,
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
    stdio: ['ignore', 'ignore', 'pipe']
  });
  serverLog = '';
  server.stderr?.on('data', (chunk) => {
    serverLog = (serverLog + chunk).slice(-2000);
  });
  await Promise.race([
    waitForLive(base),
    new Promise<never>((_, reject) =>
      server.once('exit', (code) =>
        reject(
          new Error(
            `Map test server exited (${code}) at startup:\n${serverLog}`
          )
        )
      )
    )
  ]);
  learner = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { 'x-forwarded-proto': 'http' }
  });
  const login = await learner.post('/login', {
    form: { email: 'mapper@example.test', password: learnerSecret },
    maxRedirects: 0,
    headers: { origin: base, accept: 'text/html' }
  });
  expect(login.status()).toBe(303);
  userId = String(
    (await (await learner.get('/api/auth/get-session')).json()).user.id
  );
  await withDatabase(async (client) => {
    await importContent(client, approvedPackage());
    await client.execute({
      sql: "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES ('enrollment-mapper', ?, 'fr', 'A1', 'en')",
      args: [userId]
    });
  });
});

const hasExited = (child: ChildProcess) =>
  child.exitCode !== null || child.signalCode !== null;

async function stopServer(child: ChildProcess | undefined) {
  if (!child || hasExited(child)) return;
  const exited = new Promise<void>((resolve) =>
    child.once('exit', () => resolve())
  );
  child.kill();
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timer);
}

test.afterEach(async () => {
  await learner?.dispose();
  await stopServer(server);
  await disposeFixtureDatabase(fixtureRoot, dbFile);
});

async function openMap(page: import('@playwright/test').Page) {
  await page.context().addCookies((await learner.storageState()).cookies);
  await page.goto(`${base}/app/map`);
}

test('a track whose progress cannot load shows a progress alert', async ({
  page
}) => {
  await withDatabase(async (client) => {
    await client.execute('PRAGMA foreign_keys = OFF');
    await client.execute('DROP TABLE attempts');
  });
  await openMap(page);
  const alert = page.getByText(/FR progress could not be loaded/);
  await expect(alert).toContainText('FR progress could not be loaded');
  await expect(alert).not.toContainText('topics could not be loaded');
});

test('a track whose catalog cannot load shows a topics alert', async ({
  page
}) => {
  await withDatabase(async (client) => {
    await client.execute('PRAGMA foreign_keys = OFF');
    await client.execute('DROP TABLE lessons');
  });
  await openMap(page);
  await expect(page.getByText(/FR topics could not be loaded/)).toContainText(
    'FR topics could not be loaded'
  );
});

test('keeps lessons without an openable version selectable but out of progress totals', async ({
  page
}) => {
  await openMap(page);
  await expect(
    page.getByText('No skills available to measure yet').first()
  ).toBeVisible();
  const nodes = page.locator('button.node');
  expect(await nodes.count()).toBeGreaterThan(1);
  const first = nodes.first();
  const title = await first.locator('strong').innerText();
  await first.focus();
  await page.keyboard.press('ArrowRight');
  const selected = page.locator('button[data-skill-id="fr-a1-002"]');
  await expect(selected).toBeFocused();
  await selected.click();
  const details = page.getByRole('complementary', {
    name: `${await selected.locator('strong').innerText()} details`
  });
  await expect(details).toBeVisible();
  await expect(details).not.toContainText('Unavailable');
  await expect(details.getByRole('link', { name: 'Open lesson' })).toHaveCount(
    0
  );
  await expect(
    details.getByRole('button', { name: 'Practise this topic' })
  ).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search topics' }).fill(title);
  await expect(page.locator('button.node.matching')).toHaveCount(1);
  await expect(page.locator('button.node.dimmed')).toBeVisible();
});

test('switches enrolled languages while keeping the overall progress view', async ({
  page
}) => {
  await withDatabase((client) =>
    client
      .execute({
        sql: "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES ('enrollment-map-en', ?, 'en', 'A1', 'en')",
        args: [userId]
      })
      .then(() => undefined)
  );
  await openMap(page);
  await expect(
    page.getByRole('heading', { name: 'Overall skill progress' })
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Enrolled languages' })
    .getByRole('button', { name: 'English' })
    .click();
  await expect(page).toHaveURL(/\/app\/map\?language=en/);
  await expect(
    page.getByRole('heading', { name: 'EN · starting level A1' })
  ).toBeVisible();
  await expect(
    page.getByText('No published skills are available in this track yet.')
  ).toBeVisible();
  const overall = page.getByRole('region', { name: 'Overall skill progress' });
  await expect(
    overall.getByText('No skills available to measure yet')
  ).toBeVisible();
});
