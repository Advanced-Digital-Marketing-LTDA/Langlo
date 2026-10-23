import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import type { RuntimeConfig } from '../src/lib/server/config';
import type { FixtureTarget } from '../src/lib/server/db/fixture-target';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { disposeFlashcardFixtures, fixture } from './fixtures/flashcards';
import * as studyTime from '../src/routes/app/api/study-time/+server';

// The study-time route called the way SvelteKit calls it; the hook-verified
// locals are the only identity.

type Handler = (event: never) => Promise<Response>;

let target: FixtureTarget;
let client: Client;
let close: (() => void) | undefined;

beforeEach(async () => {
  target = await fixture();
  ({ client, close } = await openFixtureDatabase(target));
});

afterEach(async () => {
  close?.();
  close = undefined;
  await disposeFlashcardFixtures();
});

function event(userId: string | null, body: unknown) {
  const url = new URL('http://127.0.0.1/app/api/study-time');
  return {
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    }),
    url,
    params: {},
    locals: {
      correlationId: 'test',
      config: {
        dataEnabled: true,
        databaseUrl: target.databaseUrl
      } as RuntimeConfig,
      user: userId ? { id: userId, email: `${userId}@x`, name: userId } : null,
      session: userId
        ? { id: `s-${userId}`, userId, expiresAt: new Date(Date.now() + 1e6) }
        : null
    }
  } as never;
}

async function call(e: never) {
  try {
    const response = await (studyTime.POST as Handler)(e);
    return { status: response.status, body: await response.json() };
  } catch (thrown) {
    const failure = thrown as { status?: number; body?: unknown };
    if (typeof failure.status !== 'number') throw thrown;
    return { status: failure.status, body: failure.body };
  }
}

async function rows() {
  return (
    await client.execute(
      'SELECT id, owner_id, category FROM study_time_segments ORDER BY id'
    )
  ).rows.map((row) => ({ ...row }));
}

function segment(id: string, extra: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id,
    category: 'grammar',
    startedAt: now - 60_000,
    endedAt: now - 1_000,
    ...extra
  };
}

it('rejects an unauthenticated caller and stores nothing', async () => {
  expect((await call(event(null, segment('a')))).status).toBe(401);
  expect(await rows()).toEqual([]);
});

it('saves the segment for the signed-in learner, ignoring owner ids in the body', async () => {
  const response = await call(
    event(
      'learner-a',
      segment('a', { ownerId: 'learner-b', userId: 'learner-b' })
    )
  );

  expect(response).toEqual({ status: 201, body: { saved: true } });
  expect(await rows()).toEqual([
    { id: 'a', owner_id: 'learner-a', category: 'grammar' }
  ]);
});

it('rejects malformed bodies with 400 and no writes', async () => {
  for (const body of [
    'not json',
    '[]',
    'null',
    segment('a', { category: 'reading' })
  ]) {
    expect(await call(event('learner-a', body))).toMatchObject({
      status: 400,
      body: { message: 'Invalid request.' }
    });
  }
  expect(await rows()).toEqual([]);
});
