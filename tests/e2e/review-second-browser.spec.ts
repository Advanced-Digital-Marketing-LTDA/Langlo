import { expect, type BrowserContext, type Page } from '@playwright/test';
import { test } from './coverage-fixture';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createClient } from '@libsql/client/sqlite3';
import type { Client } from '@libsql/client';
import { approveNote, createNote } from '../../src/lib/server/flashcards';
import { createDeck } from '../fixtures/french-deck';
import {
  createFixtureDatabase,
  disposeFixtureDatabase,
  reservePort,
  runNode as run,
  waitForLive
} from './fixture-server';

// LANGLO-119: one learner signed in from two browsers. A rating from the
// first survives a reload, the second browser cannot apply a second rating
// from its stale page, and both browsers read the same stored state.

// Generated per run, so no credential value is written into the repository.
const password = randomBytes(16).toString('hex');
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

const reviewUrl = () => `${base}/app/review/flashcards?language=fr&due=overdue`;

async function signIn(context: BrowserContext) {
  await context.setExtraHTTPHeaders({ 'x-forwarded-proto': 'http' });
  const login = await context.request.post(`${base}/login`, {
    form: { email: 'rita@example.test', password },
    maxRedirects: 0,
    headers: { origin: base, accept: 'text/html' }
  });
  expect(login.status()).toBe(303);
}

/** One approved card that is due now. */
async function seedDueCard(client: Client, learner: { userId: string }) {
  await client.execute('PRAGMA foreign_keys = ON');
  await createDeck(client, learner, { id: 'deck-rita', name: 'Rita FR' });
  await createNote(client, learner, {
    id: 'note-shared',
    sourceId: `langlo:v1:${'7'.repeat(64)}`,
    deckId: 'deck-rita',
    kind: 'basic',
    content: { front: 'Front shared', back: 'Back shared' }
  });
  await approveNote(client, learner, 'note-shared');
  await client.execute({
    sql: 'UPDATE native_flashcards SET due_at = 0 WHERE note_id = ? AND owner_id = ?',
    args: ['note-shared', learner.userId]
  });
}

async function openDueCard(page: Page) {
  await page.goto(reviewUrl());
  await page.waitForLoadState('load');
  await expect(page.locator('p > strong').first()).toHaveText('Front shared');
  await expect(page.getByTestId('remaining-due')).toContainText('1 due');
  await expect(page.getByRole('button', { name: 'Show answer' })).toBeEnabled();
}

async function rate(page: Page, rating: string) {
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page
    .getByRole('button', { name: new RegExp(`^${rating} · .+$`) })
    .click();
}

async function expectOneStoredRating(
  client: Client,
  learner: { userId: string }
) {
  const events = await client.execute({
    sql: 'SELECT rating FROM native_flashcard_review_events WHERE owner_id = ?',
    args: [learner.userId]
  });
  expect(events.rows.map((row) => row.rating)).toEqual(['good']);
  const card = await client.execute({
    sql: 'SELECT revision FROM native_flashcards WHERE note_id = ? AND owner_id = ?',
    args: ['note-shared', learner.userId]
  });
  expect(card.rows[0].revision).toBe(1);
}

test('keeps one rating across a reload and a second browser', async ({
  browser,
  context,
  page
}) => {
  const second = await browser.newContext();
  const client = createClient({ url: `file://${dbFile}` });
  try {
    await signIn(context);
    await signIn(second);
    const session = await (
      await context.request.get(`${base}/api/auth/get-session`)
    ).json();
    const learner = { userId: String(session.user.id) };
    await seedDueCard(client, learner);

    const other = await second.newPage();
    await openDueCard(page);
    await openDueCard(other);

    await rate(page, 'good');
    await expect(page.getByText('Nothing is due right now.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Nothing is due right now.')).toBeVisible();

    // The second browser still shows the card it loaded before the rating.
    await rate(other, 'easy');
    await expect(other.getByRole('alert')).toContainText(
      'This card changed in another tab.'
    );
    await other.reload();
    await expect(other.getByText('Nothing is due right now.')).toBeVisible();

    await expectOneStoredRating(client, learner);
  } finally {
    client.close();
    await second.close();
  }
});
