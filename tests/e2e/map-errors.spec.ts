import {
  expect,
  request,
  type APIRequestContext,
  type Page
} from '@playwright/test';
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

// Hold only synthetic progress settlements while exercising the built map.
async function controlProgress(page: Page) {
  await page.route(`${base}/app/map*`, async (route) => {
    const response = await route.fetch();
    let controlled = 0;
    const body = (await response.text()).replace(
      /<script>(__sveltekit_\w+)\.resolve\((\d+), \(\) => (.*?)\)<\/script>/g,
      (original, kit: string, id: string, value: string) => {
        if (!value.includes('recommendation:')) return original;
        const language = /language:"([a-z]+)"/.exec(value)?.[1];
        if (!language) throw new Error('Missing synthetic progress language');
        controlled += 1;
        return `<script>window.mapProgress ??= {}; window.mapProgress[${JSON.stringify(language)}] = (fail = false) => ${kit}.resolve(${id}, () => fail ? [void 0, {message:"Synthetic progress failure"}] : ${value})</script>`;
      }
    );
    expect(controlled).toBeGreaterThan(0);
    await route.fulfill({ response, body });
  });
}

async function releaseProgress(page: Page, language: string, fail = false) {
  await page.evaluate(
    ({ language, fail }) => {
      const progress = Reflect.get(window, 'mapProgress') as Record<
        string,
        (fail: boolean) => void
      >;
      progress[language](fail);
    },
    { language, fail }
  );
}

async function enrollEnglish() {
  await withDatabase(async (client) => {
    await client.execute({
      sql: "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES ('enrollment-map-en', ?, 'en', 'A1', 'en')",
      args: [userId]
    });
  });
}

for (const initialLanguage of ['fr', 'en']) {
  test(`keeps the selected language when another progress response arrives late from ${initialLanguage}`, async ({
    page
  }) => {
    await enrollEnglish();
    await withDatabase(async (client) => {
      await client.execute({
        sql: "INSERT INTO lessons (content_version_id, skill_id, language, title, explanation, examples, refs, fingerprint) VALUES ('fr-a1-001@1', 'fr-a1-001', 'fr', 'Synthetic French lesson', 'Synthetic lesson.', '[]', '[]', ?)",
        args: ['0'.repeat(64)]
      });
    });
    await controlProgress(page);
    await page.context().addCookies((await learner.storageState()).cookies);
    await page.goto(`${base}/app/map?language=${initialLanguage}`);
    if (initialLanguage === 'en')
      await page.getByRole('button', { name: 'French', exact: true }).click();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await releaseProgress(page, 'en');
    await expect(
      page.getByText('No published skills are available in this track yet.')
    ).toBeVisible();
    await releaseProgress(page, 'fr');
    await expect(
      page.getByRole('heading', { name: 'Overall skill progress' })
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get('language')).toBe('en');
    expect(new URL(page.url()).searchParams.get('skill')).toBeNull();
  });
}

test('keeps a successful language map usable when another language progress fails', async ({
  page
}) => {
  await enrollEnglish();
  await controlProgress(page);
  await page.context().addCookies((await learner.storageState()).cookies);
  await page.goto(`${base}/app/map?language=fr`);
  await releaseProgress(page, 'fr');
  await releaseProgress(page, 'en', true);
  await expect(page.getByRole('alert')).toContainText(
    'Overall skill progress could not be loaded'
  );
  await expect(
    page.getByRole('region', { name: 'Overall skill progress', exact: true })
  ).toHaveCount(0);
  const topic = page.locator('button.node').first();
  await topic.click();
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.locator('.list button').first()).toBeVisible();
});

test('pans the map with a touch gesture and remembers its position', async ({
  browser
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true
  });
  const page = await context.newPage();
  try {
    await openMap(page);
    const viewport = page.getByRole('region', { name: /FR topic map/u });
    await expect(page.locator('button.node').first()).toBeVisible();
    await viewport.scrollIntoViewIfNeeded();
    const bounds = (await viewport.boundingBox())!;
    const input = await context.newCDPSession(page);
    const x = bounds.x + bounds.width - 40;
    const y = bounds.y + 240;
    await input.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }]
    });
    for (let step = 1; step <= 6; step += 1) {
      await input.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x - step * 30, y }]
      });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await input.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: []
    });
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    await expect
      .poll(() => Number(new URL(page.url()).searchParams.get('x')))
      .toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

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
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.locator('.list button.matching')).toHaveCount(1);
  const contextTopic = page.locator('.list button.dimmed').first();
  await expect(contextTopic).toBeVisible();
  await contextTopic.focus();
  await contextTopic.press('Enter');
  await page.getByRole('button', { name: 'Close topic details' }).click();
  await expect(
    page.getByRole('searchbox', { name: 'Search topics' })
  ).toBeFocused();
  const matchingTopic = page.locator('.list button.matching');
  await matchingTopic.focus();
  await matchingTopic.press('Enter');
  await page.getByRole('button', { name: 'Close topic details' }).click();
  await expect(matchingTopic).toBeFocused();
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
