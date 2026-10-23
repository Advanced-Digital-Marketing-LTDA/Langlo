import { expect } from '@playwright/test';
import { test } from './coverage-fixture';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createClient } from '@libsql/client/sqlite3';
import {
  approveNote,
  createDeck,
  createNote,
  getNote,
  listReviewEvents,
  rejectNote,
  submitReview
} from '../../src/lib/server/flashcards';
import { countDueCards } from '../../src/lib/server/flashcard-views';
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
  runNode(
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

test('shows actual review analytics, saves FSRS settings, searches notes, moves notes and suspends cards', async ({
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
    await createDeck(client, learner, { id: 'deck-first', name: 'First deck' });
    await createDeck(client, learner, {
      id: 'deck-second',
      name: 'Second deck'
    });
    await createNote(client, learner, {
      id: 'note-moved',
      sourceId: `langlo:v1:${'1'.repeat(64)}`,
      deckId: 'deck-second',
      kind: 'basic',
      content: { front: 'shared moved', back: 'Moved definition' },
      explanation: 'A review explanation.',
      tags: ['shared', 'old']
    });
    await approveNote(client, learner, 'note-moved');
    await submitReview(client, learner, {
      cardId: 'card:note-moved',
      submissionId: '10000000-0000-4000-8000-000000000001',
      expectedRevision: 0,
      rating: 'good'
    });
    for (const [id, status, seed] of [
      ['note-draft', 'draft', '2'],
      ['note-rejected', 'rejected', '3'],
      ['note-suspend', 'approved', '4']
    ] as const) {
      await createNote(client, learner, {
        id,
        sourceId: `langlo:v1:${seed.repeat(64)}`,
        deckId: 'deck-first',
        kind: 'basic',
        content: {
          front: status === 'approved' ? 'suspend target' : `shared ${status}`,
          back: 'Definition'
        },
        tags: ['shared']
      });
      if (status === 'approved') await approveNote(client, learner, id);
      if (status === 'rejected') await rejectNote(client, learner, id);
    }

    await page.goto(`${base}/app`);
    await expect(
      page
        .getByRole('navigation', { name: 'Study navigation' })
        .getByRole('link', { name: 'Analytics' })
    ).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'Review history and scheduled reviews' })
    ).toHaveCount(0);

    await page.goto(`${base}/app/settings`);
    const retention = page.locator('input[name="desiredRetention"]');
    await retention.press('End');
    await retention.press('ArrowLeft');
    await expect(retention).toHaveValue('96');
    await page.locator('select[name="newCardPreset"]').selectOption('30m');
    await page.locator('select[name="relearningPreset"]').selectOption('1h');
    await expect(page.getByRole('button', { name: 'Preview' })).toHaveCount(0);
    expect(
      (
        await client.execute(
          'SELECT count(*) AS total FROM native_flashcard_preferences'
        )
      ).rows[0].total
    ).toBe(0);
    await page.getByRole('button', { name: 'Save study schedule' }).click();
    await expect(page.getByText('Study schedule saved.')).toBeVisible();
    expect(
      (
        await client.execute(
          'SELECT desired_retention, new_card_preset, relearning_preset FROM native_flashcard_preferences WHERE owner_id = ?',
          [learner.userId]
        )
      ).rows[0]
    ).toMatchObject({
      desired_retention: 96,
      new_card_preset: '30m',
      relearning_preset: '1h'
    });

    await page.goto(`${base}/app/analytics`);
    await expect(
      page.getByRole('heading', { name: 'Review analytics' })
    ).toBeVisible();
    await expect(
      page.getByRole('img', {
        name: 'Actual completed reviews and currently scheduled reviews by study day'
      })
    ).toBeVisible();
    const completedAt = await client.execute(
      'SELECT reviewed_at FROM native_flashcard_review_events WHERE owner_id = ? AND card_id = ? ORDER BY reviewed_at DESC LIMIT 1',
      [learner.userId, 'card:note-moved']
    );
    const reviewDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(Number(completedAt.rows[0].reviewed_at)));
    const reviewRow = page.getByRole('row', { name: new RegExp(reviewDate) });
    await expect(reviewRow.locator('td').nth(0)).toHaveText('1');

    const movedBefore = await getNote(client, learner, 'note-moved');
    const historyBefore = await listReviewEvents(
      client,
      learner,
      'card:note-moved'
    );
    await page.goto(`${base}/app/decks?q=shared`);
    await expect(page.getByText(/First deck · draft/u)).toBeVisible();
    await expect(page.getByText(/First deck · rejected/u)).toBeVisible();
    await expect(page.getByText(/Second deck · approved/u)).toBeVisible();
    await page.getByRole('link', { name: /shared moved/u }).click();
    await expect(page).toHaveURL(
      /\/app\/decks\/deck-second\?note=note-moved#note-note-moved/u
    );
    await page.getByText('Edit note').click();
    await page
      .locator('form[action="?/edit"]')
      .getByLabel('Tags (comma-separated)')
      .fill('shared, updated, updated');
    await page
      .locator('form[action="?/edit"] select[name="deckId"]')
      .selectOption('deck-first');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved.');
    const movedAfter = await getNote(client, learner, 'note-moved');
    expect(movedAfter).toMatchObject({
      deckId: 'deck-first',
      tags: ['shared', 'updated'],
      card: movedBefore.card
    });
    expect(await listReviewEvents(client, learner, 'card:note-moved')).toEqual(
      historyBefore
    );

    expect(await countDueCards(client, learner)).toBe(1);
    await page.goto(`${base}/app/decks/deck-first`);
    const suspendNote = page.locator('#note-note-suspend');
    await suspendNote.getByRole('button', { name: 'Suspend' }).click();
    await expect(
      suspendNote.getByRole('button', { name: 'Resume' })
    ).toBeVisible();
    expect(await countDueCards(client, learner)).toBe(0);
    await suspendNote.getByRole('button', { name: 'Resume' }).click();
    await expect(
      suspendNote.getByRole('button', { name: 'Suspend' })
    ).toBeVisible();
    expect(await countDueCards(client, learner)).toBe(1);
  } finally {
    client.close();
  }
});
