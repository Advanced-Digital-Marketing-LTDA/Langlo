import { expect, type BrowserContext } from '@playwright/test';
import { test } from './coverage-fixture';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { createClient } from '@libsql/client/sqlite3';
import { createDeck } from '../../src/lib/server/flashcards';
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
let authCookies: Awaited<ReturnType<BrowserContext['cookies']>> = [];

const appEnv = () => ({
  ...process.env,
  APP_ENV: 'test',
  APP_ORIGIN: base,
  DATA_ENABLED: 'true',
  DATABASE_URL: `file://${dbFile}`,
  BETTER_AUTH_SECRET: 'e2e-only-auth-secret-0000000000000000',
  MAIL_TRANSPORT: 'capture',
  OPENAI_API_KEY: '',
  MAIL_CAPTURE_DIR: join(fixtureRoot, 'mail')
});

test.beforeAll(async () => {
  const port = await reservePort();
  base = `http://127.0.0.1:${port}`;
  ({ fixtureRoot, dbFile } = createFixtureDatabase());
  runNode(
    [
      'scripts/accounts-provision.ts',
      '--app',
      '--email',
      'library@example.test',
      '--name',
      'Library Learner'
    ],
    password,
    appEnv()
  );
  const client = createClient({ url: `file://${dbFile}` });
  try {
    const user = await client.execute(
      "SELECT id FROM users WHERE email = 'library@example.test'"
    );
    for (const language of ['fr', 'de', 'en', 'pt'] as const)
      await createDeck(
        client,
        { userId: String(user.rows[0].id) },
        {
          id: `library-deck-${language}`,
          name: `Library ${language}`,
          language
        }
      );
  } finally {
    client.close();
  }
  server = spawn(process.execPath, ['build'], {
    cwd: process.cwd(),
    env: {
      ...appEnv(),
      HOST: '127.0.0.1',
      PORT: String(port),
      ORIGIN: base,
      BODY_SIZE_LIMIT: String(11 * 1024 * 1024),
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

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ 'x-forwarded-proto': 'http' });
  if (authCookies.length) {
    await context.addCookies(authCookies);
    return;
  }
  const login = await context.request.post(`${base}/login`, {
    form: { email: 'library@example.test', password },
    maxRedirects: 0,
    headers: { origin: base, accept: 'text/html' }
  });
  expect(login.status()).toBe(303);
  authCookies = await context.cookies();
});

test('uploads, reads, resumes, renames and deletes a private document', async ({
  page
}) => {
  await page.goto(`${base}/app/library`);
  await page.getByLabel('Document language').selectOption('fr');
  await page.getByLabel('File', { exact: true }).setInputFiles({
    name: 'bonjour.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Bonjour, Marie.\nLa maison est grande.')
  });
  await page.getByRole('button', { name: 'Upload document' }).click();
  await expect(page).toHaveURL(/\/app\/library\/library-/u);
  await expect(page.getByText('Bonjour, Marie.')).toBeVisible();
  await page.getByRole('button', { name: 'Next sentence' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sentence 2 of 2' })
  ).toBeVisible();
  await expect(page.getByText('La maison est grande.')).toBeVisible();

  await page.getByRole('link', { name: 'Back to Library' }).click();
  await expect(
    page.getByText('Progress: 50% (1 of 2 sentences)')
  ).toBeVisible();
  await page.getByLabel('Rename').fill('Bonjour et la maison');
  await page.getByRole('button', { name: 'Save title' }).click();
  await expect(
    page.getByRole('link', { name: 'Bonjour et la maison' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete document' }).click();
  await expect(page.getByText('No documents yet.')).toBeVisible();
});

for (const sample of [
  {
    language: 'fr',
    text: 'La maison est grande. Voici une maison.',
    word: 'maison',
    definition: 'house'
  },
  {
    language: 'de',
    text: 'Das Haus ist groß. Hier steht ein Haus.',
    word: 'Haus',
    definition: 'house'
  },
  {
    language: 'en',
    text: 'The bank approved the loan. The bank is open.',
    word: 'bank',
    definition: 'financial institution'
  },
  {
    language: 'pt',
    text: 'A casa é grande. Aqui está a casa.',
    word: 'casa',
    definition: 'house'
  }
]) {
  test(`clicks words, translates, saves and resumes in ${sample.language}`, async ({
    page,
    context
  }) => {
    await page.route('**/app/api/library/*/study', async (route) => {
      const body = route.request().postDataJSON();
      await route.fulfill({
        json: {
          result:
            body.action === 'translate'
              ? 'Synthetic sentence translation.'
              : sample.definition
        }
      });
    });
    await page.goto(`${base}/app/library`);
    await page.getByLabel('Document language').selectOption(sample.language);
    await page.getByLabel('File', { exact: true }).setInputFiles({
      name: `${sample.language}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from(sample.text)
    });
    await page.getByRole('button', { name: 'Upload document' }).click();
    await page.getByRole('button', { name: /Show translation in/ }).click();
    await expect(
      page.getByText('Synthetic sentence translation.')
    ).toBeVisible();
    await page.getByRole('button', { name: 'Hide translation' }).click();
    await expect(
      page.getByText('Synthetic sentence translation.')
    ).not.toBeVisible();
    const lookup = page.waitForRequest((request) =>
      request.url().endsWith('/study')
    );
    await page
      .getByRole('button', { name: `Look up ${sample.word}`, exact: true })
      .click();
    expect((await lookup).postDataJSON()).toMatchObject({
      action: 'lookup',
      term: sample.word,
      sentenceIndex: 0
    });
    await expect(
      page.getByText(sample.definition, { exact: true })
    ).toBeVisible();
    const save = page.waitForResponse((response) =>
      response.url().endsWith('/vocabulary')
    );
    await page.getByRole('button', { name: 'Save word draft' }).click();
    const saved = await save;
    expect(saved.status()).toBe(200);
    const { note } = await saved.json();
    const stored = await context.request.get(
      `${base}/app/api/notes/${note.id}`
    );
    expect(await stored.json()).toMatchObject({
      note: {
        deckId: `library-deck-${sample.language}`,
        content: { front: sample.word, back: sample.definition }
      }
    });
    await expect(page.locator('mark')).toHaveText(sample.word);
    await page.getByRole('button', { name: 'Next sentence' }).click();
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Sentence 2 of 2' })
    ).toBeVisible();
    await expect(page.locator('mark')).toHaveText(sample.word);
  });
}

test('keeps the selected word stable during lookup and save', async ({
  page
}) => {
  await page.goto(`${base}/app/library`);
  await page.getByLabel('Document language').selectOption('en');
  await page.getByLabel('File', { exact: true }).setInputFiles({
    name: 'pending.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('The river bank is steep.')
  });
  await page.getByRole('button', { name: 'Upload document' }).click();
  let releaseLookup!: () => void;
  const lookupGate = new Promise<void>((resolve) => {
    releaseLookup = resolve;
  });
  await page.route('**/app/api/library/*/study', async (route) => {
    await lookupGate;
    await route.fulfill({ json: { result: 'edge of a river' } });
  });
  await page
    .getByLabel('Select a word or phrase from this sentence')
    .fill('bank');
  const lookup = page.waitForRequest((request) =>
    request.url().endsWith('/study')
  );
  await page
    .getByRole('button', { name: 'Look up in context', exact: true })
    .click();
  await lookup;
  await expect(
    page.getByLabel('Select a word or phrase from this sentence')
  ).toBeDisabled();
  releaseLookup();
  await expect(
    page.getByText('edge of a river', { exact: true })
  ).toBeVisible();

  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route('**/app/api/library/*/vocabulary', async (route) => {
    const response = await route.fetch();
    await saveGate;
    await route.fulfill({ response });
  });
  const save = page.waitForRequest((request) =>
    request.url().endsWith('/vocabulary')
  );
  await page.getByRole('button', { name: 'Save word draft' }).click();
  expect((await save).postDataJSON()).toMatchObject({
    term: 'bank',
    definition: 'edge of a river'
  });
  await expect(
    page.getByLabel('Select a word or phrase from this sentence')
  ).toBeDisabled();
  await expect(page.getByLabel('Save to deck')).toBeDisabled();
  releaseSave();
  await expect(page.locator('mark')).toHaveText('bank');
});

test('renders PDF, DOCX and EPUB uploads in the reader', async ({ page }) => {
  for (const name of ['text.pdf', 'document.docx', 'book.epub']) {
    await page.goto(`${base}/app/library`);
    await page.getByLabel('Document language').selectOption('fr');
    await page
      .getByLabel('File', { exact: true })
      .setInputFiles(`tests/fixtures/library/${name}`);
    await page.getByRole('button', { name: 'Upload document' }).click();
    await expect(page).toHaveURL(/\/app\/library\/library-/u);
    await expect(
      page.getByRole('button', { name: 'Look up Bonjour', exact: true })
    ).toBeVisible();
  }
});

test('shows clear errors for unsupported and scanned uploads', async ({
  page
}) => {
  await page.goto(`${base}/app/library`);
  await page.getByLabel('Document language').selectOption('fr');
  await page.getByLabel('File', { exact: true }).setInputFiles({
    name: 'book.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('unsupported')
  });
  await page.getByRole('button', { name: 'Upload document' }).click();
  await expect(page.getByRole('alert')).toContainText('Upload a TXT');
  await page
    .getByLabel('File', { exact: true })
    .setInputFiles('tests/fixtures/library/scanned.pdf');
  await page.getByRole('button', { name: 'Upload document' }).click();
  await expect(page.getByRole('alert')).toContainText('no readable text');
});

test('keeps phrase study results when progress saving fails and highlights in another document', async ({
  page
}) => {
  await page.route('**/app/api/library/*/study', async (route) => {
    await route.fulfill({
      json: {
        result:
          route.request().postDataJSON().action === 'translate'
            ? 'The little house is large.'
            : 'little house'
      }
    });
  });
  await page.goto(`${base}/app/library`);
  await page.getByLabel('Document language').selectOption('fr');
  await page.getByLabel('File', { exact: true }).setInputFiles({
    name: 'phrases.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('La petite maison est grande. Elle est belle.')
  });
  await page.getByRole('button', { name: 'Upload document' }).click();
  await page
    .getByLabel('Select a word or phrase from this sentence')
    .fill('petite maison');
  await page
    .getByRole('button', { name: 'Look up in context', exact: true })
    .click();
  await expect(page.getByText('little house', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save word draft' }).click();
  await expect(page.locator('mark')).toHaveText('petite maison');
  await page.getByRole('button', { name: /Show translation in/ }).click();
  await expect(
    page.getByText('The little house is large.', { exact: true })
  ).toBeVisible();
  await page.route('**/app/api/library/*', (route) =>
    route.fulfill({ status: 503, json: { message: 'Synthetic outage' } })
  );
  await page.getByRole('button', { name: 'Next sentence' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Progress could not be saved'
  );
  await expect(page.getByText('little house', { exact: true })).toBeVisible();
  await expect(
    page.getByText('The little house is large.', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByLabel('Select a word or phrase from this sentence')
  ).toHaveValue('petite maison');
  await page.unroute('**/app/api/library/*');
  await page.getByRole('button', { name: 'Next sentence' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sentence 2 of 2' })
  ).toBeVisible();
  await expect(
    page.getByText('little house', { exact: true })
  ).not.toBeVisible();
  await page.goto(`${base}/app/library`);
  await page.getByLabel('Document language').selectOption('fr');
  await page.getByLabel('File', { exact: true }).setInputFiles({
    name: 'another.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Voici une petite maison.')
  });
  await page.getByRole('button', { name: 'Upload document' }).click();
  await expect(page.locator('mark')).toHaveText('petite maison');
});

test('returns 413 for chunked JSON and form requests through the real server', async ({
  context
}) => {
  const cookie = (await context.cookies())
    .map(({ name, value }) => `${name}=${value}`)
    .join('; ');
  for (const [path, contentType] of [
    ['/signup', 'application/x-www-form-urlencoded'],
    ['/api/auth/sign-in/email', 'application/json'],
    ['/app/api/library/missing', 'application/json'],
    ['/app/library?/rename', 'application/x-www-form-urlencoded']
  ]) {
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        `${base}${path}`,
        {
          method: path === '/app/api/library/missing' ? 'PATCH' : 'POST',
          headers: {
            origin: base,
            cookie,
            'content-type': contentType,
            'x-forwarded-proto': 'http'
          }
        },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode ?? 0));
        }
      );
      request.on('error', reject);
      request.write('x'.repeat(600 * 1024));
      request.end();
    });
    expect(status, path).toBe(413);
  }
});
