import { expect } from '@playwright/test';
import { test } from './coverage-fixture';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createClient } from '@libsql/client/sqlite3';
import {
  approveNote,
  createDeck,
  createNote
} from '../../src/lib/server/flashcards';
import {
  createFixtureDatabase,
  disposeFixtureDatabase,
  reservePort,
  runNode as run,
  waitForLive
} from './fixture-server';

// A signed-in learner reveals each due card's answer in a real browser and
// applies every rating; the stored review events carry the chosen ratings.

// Generated per run, so no credential value is written into the repository.
const password = randomBytes(16).toString('hex');
const ratings = ['again', 'hard', 'good', 'easy'] as const;
let server: ChildProcess;
let base = '';
let fixtureRoot = '';
let dbFile = '';

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

test.beforeAll(async () => {
  const port = await reservePort();
  base = `http://127.0.0.1:${port}`;
  ({ fixtureRoot, dbFile } = createFixtureDatabase());
  run(
    [
      'scripts/accounts-provision.ts',
      '--app',
      '--email',
      'rita@example.test',
      '--name',
      'Rita'
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

test('reveals each answer and stores every rating', async ({
  context,
  page
}) => {
  await context.setExtraHTTPHeaders({ 'x-forwarded-proto': 'http' });
  const login = await context.request.post(`${base}/login`, {
    form: { email: 'rita@example.test', password },
    maxRedirects: 0,
    headers: { origin: base, accept: 'text/html' }
  });
  expect(login.status()).toBe(303);
  const session = await (
    await context.request.get(`${base}/api/auth/get-session`)
  ).json();
  const learner = { userId: String(session.user.id) };

  const client = createClient({ url: `file://${dbFile}` });
  try {
    await client.execute('PRAGMA foreign_keys = ON');
    await createDeck(client, learner, { id: 'deck-rita', name: 'Rita FR' });
    for (const [index, rating] of ratings.entries()) {
      await createNote(client, learner, {
        id: `note-${rating}`,
        sourceId: `langlo:v1:${String(index).repeat(64)}`,
        deckId: 'deck-rita',
        kind: 'basic',
        content: { front: `Front ${rating}`, back: `Back ${rating}` },
        explanation: `Explanation ${rating}`
      });
      await approveNote(client, learner, `note-${rating}`);
      await client.execute({
        sql: 'UPDATE native_flashcards SET due_at = ? WHERE note_id = ? AND owner_id = ?',
        args: [index, `note-${rating}`, learner.userId]
      });
    }

    await page.goto(`${base}/app/review`);
    const shown = page.locator('p > strong').first();
    let previous = '';
    for (const rating of ratings) {
      // The next card replaces the rated one once the form update lands.
      await expect(shown).not.toHaveText(previous);
      const front = (await shown.innerText()).trim();
      expect(front).toBe(`Front ${rating}`);
      const back = front.replace('Front', 'Back');
      await expect(page.getByTestId('remaining-due')).toContainText(
        `${ratings.length - ratings.indexOf(rating)} due`
      );
      await expect(page.getByText(back)).toHaveCount(0);
      await page.getByRole('button', { name: 'Show answer' }).click();
      await expect(page.getByText(back)).toBeVisible();
      await expect(page.getByText(`Explanation ${rating}`)).toBeVisible();
      for (const name of ratings)
        await expect(
          page.getByRole('button', { name: new RegExp(`^${name} · .+$`) })
        ).toBeVisible();
      await page
        .getByRole('button', { name: new RegExp(`^${rating} · .+$`) })
        .click();
      previous = front;
    }
    await expect(page.getByText('Nothing is due right now.')).toBeVisible();

    const stored = await client.execute(
      'SELECT rating FROM native_flashcard_review_events ORDER BY rating'
    );
    expect(stored.rows.map((row) => row.rating)).toEqual([...ratings].sort());
  } finally {
    client.close();
  }
});
