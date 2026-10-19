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
  const userId = String(
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
  const alert = page.getByRole('alert');
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
  await expect(page.getByRole('alert')).toContainText(
    'FR topics could not be loaded'
  );
});
