import { expect, type APIRequestContext, request } from '@playwright/test';
import { test } from './coverage-fixture';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client/sqlite3';
import {
  approveNote,
  createDeck,
  createNote
} from '../../src/lib/server/flashcards';
import { importContent } from '../../src/lib/server/content-import';
import { privateState } from '../fixtures/owner-scope';
import { approvedPackage } from '../fixtures/content-package';
import {
  createFixtureDatabase,
  disposeFixtureDatabase,
  reservePort,
  runNode as run,
  waitForLive
} from './fixture-server';

// Real-session acceptance for LANGLO-32: two accounts sign in through the
// built server, and each guesses the other's IDs on every private route.

const password = 'owner-route-password-0';
let server: ChildProcess;
let base = '';
let fixtureRoot = '';
let dbFile = '';
let alice: APIRequestContext;
let bob: APIRequestContext;
let aliceId = '';
let bobId = '';

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

async function signIn(email: string) {
  const ctx = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { 'x-forwarded-proto': 'http' }
  });
  const login = await ctx.post('/login', {
    form: { email, password },
    maxRedirects: 0,
    headers: { origin: base, accept: 'text/html' }
  });
  expect(login.status()).toBe(303);
  const session = await (await ctx.get('/api/auth/get-session')).json();
  return { ctx, id: String(session.user.id) };
}

async function withDatabase<T>(work: (client: Client) => Promise<T>) {
  const client = createClient({ url: `file://${dbFile}` });
  try {
    await client.execute('PRAGMA foreign_keys = ON');
    return await work(client);
  } finally {
    client.close();
  }
}

test.beforeAll(async () => {
  const port = await reservePort();
  base = `http://127.0.0.1:${port}`;
  ({ fixtureRoot, dbFile } = createFixtureDatabase());
  for (const [email, name] of [
    ['alice@example.test', 'Alice'],
    ['bob@example.test', 'Bob']
  ])
    run(
      [
        'scripts/accounts-provision.ts',
        '--app',
        '--email',
        email,
        '--name',
        name
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
  ({ ctx: alice, id: aliceId } = await signIn('alice@example.test'));
  ({ ctx: bob, id: bobId } = await signIn('bob@example.test'));
  // Bob's private history, written for his real account ID.
  await withDatabase(async (client) => {
    await client.batch(
      [
        {
          sql: "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES ('enrollment-bob', ?, 'fr', 'A1', 'en')",
          args: [bobId]
        },
        {
          sql: "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode) VALUES ('study-bob', ?, 'enrollment-bob', 'fr', 'practice')",
          args: [bobId]
        },
        {
          sql: "INSERT INTO attempts (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer) VALUES ('attempt-bob', ?, 'study-bob', 'question-1', 'content-v1', 'fr-articles', 'fr', 'submit-bob', 'independent', 'un')",
          args: [bobId]
        }
      ],
      'write'
    );
    await importContent(client, approvedPackage());
    const learner = { userId: bobId };
    await createDeck(client, learner, { id: 'deck-bob', name: 'Bob FR' });
    await createNote(client, learner, {
      id: 'note-bob',
      sourceId: `langlo:v1:${'b'.repeat(64)}`,
      deckId: 'deck-bob',
      kind: 'basic',
      content: { front: 'Merci', back: 'Thanks' }
    });
    await approveNote(client, learner, 'note-bob');
  });
});

test.afterAll(async () => {
  await alice?.dispose();
  await bob?.dispose();
  server?.kill();
  await disposeFixtureDatabase(fixtureRoot, dbFile);
});

const json = (data: unknown) => ({
  data,
  headers: { origin: base },
  maxRedirects: 0
});

test('a signed-in learner reads only their own private rows', async () => {
  expect(aliceId).not.toBe(bobId);
  const own = await bob.get('/app/api/decks');
  expect(own.status()).toBe(200);
  expect(await own.json()).toMatchObject({ decks: [{ id: 'deck-bob' }] });
  const note = await bob.get('/app/api/notes/note-bob');
  expect(note.status()).toBe(200);
  expect(JSON.stringify(await note.json())).not.toContain(bobId);
  expect((await bob.get('/app/api/attempts/attempt-bob')).status()).toBe(200);

  const forgedQuery = await alice.get(
    `/app/api/decks?ownerId=${bobId}&userId=${bobId}&learnerId=${bobId}`
  );
  expect(await forgedQuery.json()).toEqual({ decks: [] });
  expect(await (await alice.get('/app/api/study-sessions')).json()).toEqual({
    studySessions: []
  });
});

test('guessed cross-owner IDs answer 404 and write nothing', async () => {
  const before = await withDatabase((client) => privateState(client));
  for (const path of [
    '/app/api/notes/note-bob',
    '/app/api/cards/card:note-bob/reviews',
    '/app/api/study-sessions/study-bob',
    '/app/api/attempts/attempt-bob'
  ]) {
    const response = await alice.get(path);
    expect(response.status(), path).toBe(404);
    expect(await response.text()).not.toContain(bobId);
  }
  const writes: Array<[string, unknown]> = [
    ['/app/api/notes/note-bob/approve', { ownerId: bobId }],
    [
      '/app/api/cards/card:note-bob/reviews',
      {
        submissionId: 'forged-review',
        expectedRevision: 0,
        rating: 'easy',
        ownerId: bobId
      }
    ],
    [
      '/app/api/attempts',
      {
        studySessionId: 'study-bob',
        questionId: 'question-1',
        submissionKey: 'forged-attempt',
        evidenceKind: 'independent',
        answer: 'x',
        userId: bobId
      }
    ]
  ];
  for (const [path, body] of writes) {
    const response = await alice.post(path, json(body));
    expect(response.status(), path).toBe(404);
  }
  expect(await withDatabase((client) => privateState(client))).toEqual(before);
});

test('the owner can review their card through the same route', async () => {
  const reviewed = await bob.post(
    '/app/api/cards/card:note-bob/reviews',
    json({ submissionId: 'bob-review-1', expectedRevision: 0, rating: 'good' })
  );
  expect(reviewed.status()).toBe(200);
  expect(await reviewed.json()).toMatchObject({
    revision: 1,
    duplicate: false
  });
  const history = await bob.get('/app/api/cards/card:note-bob/reviews');
  expect((await history.json()).events).toHaveLength(1);
});

test('anonymous and signed-out callers get no private data', async () => {
  const anon = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { 'x-forwarded-proto': 'http' }
  });
  try {
    const read = await anon.get('/app/api/decks', { maxRedirects: 0 });
    expect(read.status()).toBe(303);
    expect(read.headers()['location']).toBe('/login');
    const write = await anon.post('/app/api/notes/note-bob/approve', json({}));
    expect(write.status()).toBe(401);
  } finally {
    await anon.dispose();
  }
});

test('the owner can pause, resume, and continue their study session', async () => {
  const next = () =>
    bob.get('/app/api/study-sessions/study-bob/next?skill=fr-a1-001');
  const firstQuestion = await next();
  expect(firstQuestion.status()).toBe(200);
  const firstBody = await firstQuestion.json();
  expect(firstBody.question).toMatchObject({ id: 'fr-a1-001@1:q1' });
  expect(firstBody.question).not.toHaveProperty('answer');

  const paused = await bob.post(
    '/app/api/study-sessions/study-bob/pause',
    json({})
  );
  expect(paused.status()).toBe(200);
  expect(await paused.json()).toMatchObject({
    studySession: { state: 'paused', pausedAt: expect.any(Number) }
  });
  expect((await next()).status()).toBe(409);

  const resumed = await bob.post(
    '/app/api/study-sessions/study-bob/resume',
    json({})
  );
  expect(resumed.status()).toBe(200);
  expect(await resumed.json()).toMatchObject({
    studySession: { state: 'active', pausedAt: null }
  });

  const continued = await next();
  expect(continued.status()).toBe(200);
  const continuedBody = await continued.json();
  expect(continuedBody.question).toMatchObject({ id: 'fr-a1-001@1:q1' });
  expect(continuedBody.question).not.toHaveProperty('answer');
});
