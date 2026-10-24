import {
  expect,
  type BrowserContext,
  type Frame,
  type Page
} from '@playwright/test';
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

const panelName = 'Look up the selection';
const lookupResult = {
  translation: 'Synthetic translation',
  explanation: 'Synthetic explanation of the word.'
};

async function uploadText(page: Page, language: string, text: string) {
  await page.goto(`${base}/app/library`);
  await page.getByLabel('Document language').selectOption(language);
  await page.getByLabel('File', { exact: true }).setInputFiles({
    name: `${language}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from(text)
  });
  await page.getByRole('button', { name: 'Upload document' }).click();
  await expect(page).toHaveURL(/\/app\/library\/library-/u);
  await expect(page.locator('.text-page p').first()).toBeVisible();
}

async function uploadFixture(page: Page, language: string, name: string) {
  await page.goto(`${base}/app/library`);
  await page.getByLabel('Document language').selectOption(language);
  await page
    .getByLabel('File', { exact: true })
    .setInputFiles(`tests/fixtures/library/${name}`);
  await page.getByRole('button', { name: 'Upload document' }).click();
  await expect(page).toHaveURL(/\/app\/library\/library-/u);
}

/** Runs in the page: the viewport rectangle of `text` in the visible text. */
function visiblePhraseRect(text: string) {
  const walker = document.createTreeWalker(document.body, 4);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  let seen = 0;
  const spans = nodes
    .filter((node) => node.parentElement?.checkVisibility())
    .map((node) => {
      const span = { node, from: seen };
      seen += node.data.length;
      return span;
    });
  const from = spans
    .map(({ node }) => node.data)
    .join('')
    .indexOf(text);
  if (from === -1) return null;
  const locate = (offset: number) => {
    const span = spans.find(
      (item) => offset <= item.from + item.node.data.length
    );
    if (!span) throw new Error('offset beyond text');
    return { node: span.node, offset: offset - span.from };
  };
  const start = locate(from);
  const end = locate(from + text.length);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const { left, right, top, bottom } = range.getBoundingClientRect();
  return { left, right, top, bottom };
}

/** The viewport rectangle of `phrase`, which may span highlighted words. */
async function phraseBox(scope: Page | Frame, phrase: string) {
  const box = await scope.evaluate(visiblePhraseRect, phrase);
  if (!box) throw new Error(`"${phrase}" is not on the page`);
  if (!('frameElement' in scope)) return box;
  const offset = await (await scope.frameElement()).boundingBox();
  return {
    left: box.left + (offset?.x ?? 0),
    right: box.right + (offset?.x ?? 0),
    top: box.top + (offset?.y ?? 0),
    bottom: box.bottom + (offset?.y ?? 0)
  };
}

async function clickWord(page: Page, word: string, scope: Page | Frame = page) {
  const box = await phraseBox(scope, word);
  await page.mouse.click(
    (box.left + box.right) / 2,
    (box.top + box.bottom) / 2
  );
}

async function dragPhrase(
  page: Page,
  phrase: string,
  scope: Page | Frame = page
) {
  const box = await phraseBox(scope, phrase);
  const y = (box.top + box.bottom) / 2;
  await page.mouse.move(box.left + 1, y);
  await page.mouse.down();
  await page.mouse.move(box.right - 1, y, { steps: 6 });
  await page.mouse.up();
}

const panel = (page: Page) =>
  page.getByRole('complementary', { name: panelName });

function mockStudy(page: Page) {
  const requests: Record<string, unknown>[] = [];
  return page
    .route('**/app/api/library/*/study', async (route) => {
      const body = route.request().postDataJSON();
      requests.push(body);
      await route.fulfill({
        json:
          body.action === 'translate'
            ? { result: 'Synthetic sentence translation.' }
            : lookupResult
      });
    })
    .then(() => requests);
}

test('uploads, flips pages, resumes, renames and deletes a private document', async ({
  page
}) => {
  const paragraph = 'La maison est grande et la famille est heureuse ici.';
  await uploadText(
    page,
    'fr',
    Array.from({ length: 120 }, () => paragraph).join('\n')
  );
  const pages = page.getByText(/^Page \d+ of \d+$/u);
  await expect(pages).toHaveText('Page 1 of 4');
  await expect(
    page.getByRole('button', { name: 'Previous page' })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pages).toHaveText('Page 2 of 4');
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && response.status() === 200
  );
  await page.keyboard.press('ArrowRight');
  await expect(pages).toHaveText('Page 3 of 4');
  await saved;
  await page.reload();
  await expect(pages).toHaveText('Page 3 of 4');
  await page.keyboard.press('ArrowLeft');
  await expect(pages).toHaveText('Page 2 of 4');

  // Leaving straight after a page turn still saves it.
  const left = page.waitForResponse(
    (response) => response.request().method() === 'PATCH'
  );
  await page.getByRole('link', { name: 'Back to Library' }).click();
  expect((await left).status()).toBe(200);
  await page.reload();
  await expect(page.getByText('Progress: 50%')).toBeVisible();
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
    sentence: 'La maison est grande.',
    next: 'Voici une maison.'
  },
  {
    language: 'de',
    text: 'Das Haus ist groß. Hier steht ein Haus.',
    word: 'Haus',
    sentence: 'Das Haus ist groß.',
    next: 'Hier steht ein Haus.'
  },
  {
    language: 'en',
    text: 'The bank approved the loan. The bank is open.',
    word: 'bank',
    sentence: 'The bank approved the loan.',
    next: 'The bank is open.'
  },
  {
    language: 'pt',
    text: 'A casa é grande. Aqui está a casa.',
    word: 'casa',
    sentence: 'A casa é grande.',
    next: 'Aqui está a casa.'
  }
]) {
  test(`clicks a word, translates, saves and highlights it in ${sample.language}`, async ({
    page,
    context
  }) => {
    const requests = await mockStudy(page);
    await uploadText(page, sample.language, sample.text);
    await clickWord(page, sample.word);
    await expect(panel(page).locator('.term')).toHaveText(sample.word);
    await panel(page)
      .getByRole('button', { name: 'Translate and explain' })
      .click();
    await expect(panel(page).getByText(lookupResult.translation)).toBeVisible();
    await expect(panel(page).getByText(lookupResult.explanation)).toBeVisible();
    expect(requests[0]).toEqual({
      action: 'lookup',
      term: sample.word,
      sentence: sample.sentence,
      previousSentence: '',
      nextSentence: sample.next
    });
    await panel(page)
      .getByRole('button', { name: 'Translate sentence' })
      .click();
    await expect(
      panel(page).getByText('Synthetic sentence translation.')
    ).toBeVisible();
    expect(requests[1]).toEqual({
      action: 'translate',
      sentence: sample.sentence,
      previousSentence: '',
      nextSentence: sample.next
    });

    const save = page.waitForResponse((response) =>
      response.url().endsWith('/vocabulary')
    );
    await panel(page).getByRole('button', { name: 'Save to deck' }).click();
    const saved = await save;
    expect(saved.status()).toBe(200);
    const { note } = await saved.json();
    const stored = await context.request.get(
      `${base}/app/api/notes/${note.id}`
    );
    expect(await stored.json()).toMatchObject({
      note: {
        deckId: `library-deck-${sample.language}`,
        content: {
          front: sample.word,
          back: `${lookupResult.translation} — ${lookupResult.explanation}`
        }
      }
    });
    await expect(page.locator('.text-page mark').first()).toHaveText(
      sample.word
    );
    await page.reload();
    await expect(page.locator('.text-page mark').first()).toHaveText(
      sample.word
    );
  });
}

test('selects a phrase by dragging and keeps buttons disabled while a request runs', async ({
  page
}) => {
  await uploadText(page, 'en', 'The river bank is steep. The path is long.');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/app/api/library/*/study', async (route) => {
    await gate;
    await route.fulfill({ json: lookupResult });
  });
  await dragPhrase(page, 'river bank');
  await expect(panel(page).locator('.term')).toHaveText('river bank');
  const request = page.waitForRequest((r) => r.url().endsWith('/study'));
  await panel(page)
    .getByRole('button', { name: 'Translate and explain' })
    .click();
  expect((await request).postDataJSON()).toMatchObject({
    term: 'river bank',
    sentence: 'The river bank is steep.',
    nextSentence: 'The path is long.'
  });
  await expect(
    panel(page).getByRole('button', { name: 'Translate and explain' })
  ).toBeDisabled();
  await expect(
    panel(page).getByRole('button', { name: 'Save to deck' })
  ).toBeDisabled();
  release();
  await expect(panel(page).getByText(lookupResult.translation)).toBeVisible();
  await expect(
    panel(page).getByRole('button', { name: 'Save to deck' })
  ).toBeEnabled();

  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route('**/app/api/library/*/vocabulary', async (route) => {
    const response = await route.fetch();
    await saveGate;
    await route.fulfill({ response });
  });
  await panel(page).getByRole('button', { name: 'Save to deck' }).click();
  await expect(
    panel(page).getByRole('button', { name: 'Save to deck' })
  ).toBeDisabled();
  releaseSave();
  await expect(page.locator('.text-page mark')).toHaveText('river bank');
});

test('a touch selection opens the lookup bar at the bottom of the screen', async ({
  page
}) => {
  await uploadText(page, 'fr', 'Le chat dort ici.');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.evaluate(() => {
    document.dispatchEvent(
      new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true })
    );
    const text = document.querySelector('.text-page p')!.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 3);
    range.setEnd(text, 7);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await expect(panel(page).locator('.term')).toHaveText('chat');
  const box = (await panel(page).boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.width).toBe(390);
  expect(Math.round(box.y + box.height)).toBe(800);
});

test('renders a PDF as pages, flips them and looks up a word', async ({
  page
}) => {
  await mockStudy(page);
  await uploadFixture(page, 'fr', 'three-pages.pdf');
  const label = page.getByText(/^Page \d+ of \d+$/u);
  await expect(label).toHaveText('Page 1 of 3');
  await expect(page.locator('.pdf-page canvas')).toBeVisible();
  await expect(page.locator('.textLayer')).toContainText('Bonjour le monde');
  await clickWord(page, 'Bonjour');
  await expect(panel(page).locator('.term')).toHaveText('Bonjour');
  await panel(page)
    .getByRole('button', { name: 'Translate and explain' })
    .click();
  await expect(panel(page).getByText(lookupResult.translation)).toBeVisible();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && response.status() === 200
  );
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(label).toHaveText('Page 2 of 3');
  await expect(page.locator('.textLayer')).toContainText(
    'la maison est grande'
  );
  await expect(panel(page)).toHaveCount(0);
  await saved;
  await page.reload();
  await expect(label).toHaveText('Page 2 of 3');
  await expect(page.locator('.textLayer')).toContainText(
    'la maison est grande'
  );
});

test('renders a Word document as pages and looks up a word', async ({
  page
}) => {
  const requests = await mockStudy(page);
  await uploadFixture(page, 'fr', 'document.docx');
  await expect(page.locator('section.docx').first()).toContainText('Bonjour');
  await expect(page.getByText(/^Page 1 of \d+$/u)).toBeVisible();
  await clickWord(page, 'Bonjour');
  await panel(page)
    .getByRole('button', { name: 'Translate and explain' })
    .click();
  await expect(panel(page).getByText(lookupResult.translation)).toBeVisible();
  expect(requests[0]).toMatchObject({ action: 'lookup', term: 'Bonjour' });
});

test('renders an EPUB in its own sandboxed frame and looks up a word', async ({
  page
}) => {
  const requests = await mockStudy(page);
  await uploadFixture(page, 'fr', 'book.epub');
  const frameElement = page.locator('.epub-holder iframe');
  await expect(frameElement).toBeVisible();
  expect(await frameElement.getAttribute('sandbox')).not.toContain(
    'allow-scripts'
  );
  const frame = page.frame({ url: /blob:|about:srcdoc|epub/u }) ?? undefined;
  const content =
    frame ?? (await (await frameElement.elementHandle())!.contentFrame())!;
  await expect(content.locator('body')).toContainText('Bonjour');
  await expect(page.getByText(/% read$/u)).toBeVisible();
  await clickWord(page, 'Bonjour', content);
  await panel(page)
    .getByRole('button', { name: 'Translate and explain' })
    .click();
  await expect(panel(page).getByText(lookupResult.translation)).toBeVisible();
  expect(requests[0]).toMatchObject({ action: 'lookup', term: 'Bonjour' });
});

test('shows the size error on the Library page when a file is too large', async ({
  page
}) => {
  await page.goto(`${base}/app/library`);
  await page.getByLabel('Document language').selectOption('fr');
  await page.getByLabel('File', { exact: true }).setInputFiles({
    name: 'huge.txt',
    mimeType: 'text/plain',
    buffer: Buffer.alloc(12 * 1024 * 1024, 'a')
  });
  await page.getByRole('button', { name: 'Upload document' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Choose a file of 10 MB or smaller.'
  );
  await expect(page).toHaveURL(`${base}/app/library`);
});

test('clears the size error when a new file is chosen', async ({ page }) => {
  await page.goto(`${base}/app/library`);
  await page.getByLabel('Document language').selectOption('fr');
  await page.getByLabel('File', { exact: true }).setInputFiles({
    name: 'huge.txt',
    mimeType: 'text/plain',
    buffer: Buffer.alloc(12 * 1024 * 1024, 'a')
  });
  await page.getByRole('button', { name: 'Upload document' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Choose a file of 10 MB or smaller.'
  );
  await page.getByLabel('File', { exact: true }).setInputFiles({
    name: 'petit.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Bonjour.')
  });
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('shows a rename error after an oversized upload', async ({ page }) => {
  await page.goto(`${base}/app/library`);
  await page.getByLabel('Document language').selectOption('fr');
  await page.getByLabel('File', { exact: true }).setInputFiles({
    name: 'petit.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Bonjour.')
  });
  await page.getByRole('button', { name: 'Upload document' }).click();
  await expect(page).toHaveURL(/\/app\/library\/library-/u);
  await page.goto(`${base}/app/library`);
  await page.getByLabel('Document language').selectOption('fr');
  await page.getByLabel('File', { exact: true }).setInputFiles({
    name: 'huge.txt',
    mimeType: 'text/plain',
    buffer: Buffer.alloc(12 * 1024 * 1024, 'a')
  });
  await page.getByRole('button', { name: 'Upload document' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Choose a file of 10 MB or smaller.'
  );
  await page.getByLabel('Rename').first().fill('   ');
  await page.getByRole('button', { name: 'Save title' }).first().click();
  await expect(page.getByRole('alert')).toHaveText(
    'Use a title of up to 160 characters.'
  );
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

test('keeps reading and shows an error when the place cannot be saved, and highlights saved phrases in another document', async ({
  page
}) => {
  await mockStudy(page);
  const paragraph = 'La petite maison est grande et belle ici et partout.';
  await uploadText(
    page,
    'fr',
    Array.from({ length: 80 }, () => paragraph).join('\n')
  );
  await dragPhrase(page, 'petite maison');
  await panel(page)
    .getByRole('button', { name: 'Translate and explain' })
    .click();
  await panel(page).getByRole('button', { name: 'Save to deck' }).click();
  await expect(page.locator('.text-page mark').first()).toHaveText(
    'petite maison'
  );
  await page.route('**/app/api/library/*', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 503, json: { message: 'Synthetic outage' } })
      : route.continue()
  );
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Your place could not be saved'
  );
  await expect(page.getByText('Page 2 of 3')).toBeVisible();
  await page.unroute('**/app/api/library/*');
  await uploadText(page, 'fr', 'Voici une petite maison.');
  await expect(page.locator('.text-page mark')).toHaveText('petite maison');
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
