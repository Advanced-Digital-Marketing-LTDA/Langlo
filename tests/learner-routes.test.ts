import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import type { RuntimeConfig } from '../src/lib/server/config';
import type { FixtureTarget } from '../src/lib/server/db/fixture-target';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import {
  approveNote,
  createDeck,
  createNote,
  submitReview
} from '../src/lib/server/flashcards';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession,
  testSourceId
} from './fixtures/flashcards';
import { privateState } from './fixtures/owner-scope';
import * as decks from '../src/routes/app/api/decks/+server';
import * as note from '../src/routes/app/api/notes/[id]/+server';
import * as approve from '../src/routes/app/api/notes/[id]/approve/+server';
import * as reviews from '../src/routes/app/api/cards/[id]/reviews/+server';
import * as studySessions from '../src/routes/app/api/study-sessions/+server';
import * as studySession from '../src/routes/app/api/study-sessions/[id]/+server';
import * as attempts from '../src/routes/app/api/attempts/+server';
import * as attempt from '../src/routes/app/api/attempts/[id]/+server';

// Route handlers called the way SvelteKit calls them. The principals are the
// synthetic fixture users; the hook-verified locals are the only identity.
// Real signed-in sessions are covered by tests/e2e/owner-routes.spec.ts.

type Handler = (event: never) => Promise<Response>;

let target: FixtureTarget;
let client: Client;
let close: () => void;

beforeEach(async () => {
  target = await fixture();
  ({ client, close } = await openFixtureDatabase(target));
  const ownerB = testSession('learner-b');
  await createDeck(client, ownerB, { id: 'deck-b', name: 'Deutsch' });
  await createNote(client, ownerB, {
    id: 'note-b',
    sourceId: testSourceId('b'),
    deckId: 'deck-b',
    kind: 'basic',
    content: { front: 'Danke', back: 'Thanks' }
  });
  await approveNote(client, ownerB, 'note-b');
  await submitReview(client, ownerB, {
    cardId: 'card:note-b',
    submissionId: 'review-b',
    expectedRevision: 0,
    rating: 'good'
  });
});

afterEach(async () => {
  close();
  await disposeFlashcardFixtures();
});

function event(
  userId: string | null,
  options: {
    params?: Record<string, string>;
    body?: unknown;
    query?: string;
    config?: RuntimeConfig | undefined;
  } = {}
) {
  const config =
    'config' in options
      ? options.config
      : ({
          dataEnabled: true,
          databaseUrl: target.databaseUrl
        } as RuntimeConfig);
  const url = new URL(`http://127.0.0.1/app/api${options.query ?? ''}`);
  const request = new Request(url, {
    method: options.body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body:
      options.body === undefined
        ? undefined
        : typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body)
  });
  return {
    request,
    url,
    params: options.params ?? {},
    locals: {
      correlationId: 'test',
      config,
      user: userId ? { id: userId, email: `${userId}@x`, name: userId } : null,
      session: userId
        ? { id: `s-${userId}`, userId, expiresAt: new Date(Date.now() + 1e6) }
        : null
    }
  } as never;
}

async function call(handler: Handler, e: never) {
  try {
    const response = await handler(e);
    return { status: response.status, body: await response.json() };
  } catch (thrown) {
    const failure = thrown as { status?: number; body?: unknown };
    if (typeof failure.status !== 'number') throw thrown;
    return { status: failure.status, body: failure.body };
  }
}

describe('private learner routes', () => {
  it('reject an unauthenticated caller before touching data', async () => {
    const before = await privateState(client);
    for (const [handler, params] of [
      [decks.GET, {}],
      [note.GET, { id: 'note-b' }],
      [reviews.GET, { id: 'card:note-b' }],
      [studySessions.GET, {}],
      [attempt.GET, { id: 'attempt-a' }]
    ] as const) {
      expect(
        (await call(handler as Handler, event(null, { params }))).status
      ).toBe(401);
    }
    expect(
      (
        await call(
          approve.POST as Handler,
          event(null, { params: { id: 'note-b' }, body: {} })
        )
      ).status
    ).toBe(401);
    expect(await privateState(client)).toEqual(before);
  });

  it('answer 503 when study data is not configured', async () => {
    const response = await call(
      decks.GET as Handler,
      event('learner-a', { config: undefined })
    );
    expect(response.status).toBe(503);
  });

  it('list and read only the signed-in learner’s own rows', async () => {
    expect(
      (await call(decks.GET as Handler, event('learner-b'))).body
    ).toMatchObject({ decks: [{ id: 'deck-b', name: 'Deutsch' }] });
    expect((await call(decks.GET as Handler, event('learner-a'))).body).toEqual(
      { decks: [] }
    );

    const own = await call(
      note.GET as Handler,
      event('learner-b', { params: { id: 'note-b' } })
    );
    expect(own.status).toBe(200);
    expect(own.body.note).toMatchObject({ id: 'note-b', status: 'approved' });
    expect(own.body.note).not.toHaveProperty('ownerId');

    const history = await call(
      reviews.GET as Handler,
      event('learner-b', { params: { id: 'card:note-b' } })
    );
    expect(history.body.events.map((row: { id: string }) => row.id)).toEqual([
      'review-b'
    ]);

    expect(
      (await call(studySessions.GET as Handler, event('learner-a'))).body
    ).toMatchObject({ studySessions: [{ id: 'study-a' }] });
    const study = await call(
      studySession.GET as Handler,
      event('learner-a', { params: { id: 'study-a' } })
    );
    expect(study.body.studySession.id).toBe('study-a');
    expect(Array.isArray(study.body.attempts)).toBe(true);
  });

  it('turn every forged cross-owner ID into 404 with zero writes', async () => {
    const before = await privateState(client);
    const reads: Array<[Handler, string]> = [
      [note.GET as Handler, 'note-b'],
      [reviews.GET as Handler, 'card:note-b'],
      [studySession.GET as Handler, 'study-b']
    ];
    for (const [handler, id] of reads) {
      const response = await call(
        handler,
        event('learner-a', { params: { id } })
      );
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain('learner-b');
    }
    // Owner B guessing owner A's attempt is the same denial.
    const guessedAttempt = await call(
      attempt.GET as Handler,
      event('learner-b', { params: { id: 'attempt-a' } })
    );
    expect(guessedAttempt.status).toBe(404);
    expect(JSON.stringify(guessedAttempt.body)).not.toContain('learner-a');
    const writes: Array<[Handler, string, unknown]> = [
      [approve.POST as Handler, 'note-b', {}],
      [
        reviews.POST as Handler,
        'card:note-b',
        { submissionId: 'forged', expectedRevision: 1, rating: 'easy' }
      ],
      [
        reviews.POST as Handler,
        'card:note-b',
        { submissionId: 'review-b', expectedRevision: 0, rating: 'good' }
      ]
    ];
    for (const [handler, id, body] of writes) {
      expect(
        (await call(handler, event('learner-a', { params: { id }, body })))
          .status
      ).toBe(404);
    }
    expect(
      (
        await call(
          attempts.POST as Handler,
          event('learner-a', {
            body: {
              studySessionId: 'study-b',
              questionId: 'question-1',
              submissionKey: 'forged',
              evidenceKind: 'independent',
              answer: 'x'
            }
          })
        )
      ).status
    ).toBe(404);
    expect(await privateState(client)).toEqual(before);
  });

  it('ignore learner, owner and user IDs supplied by the client', async () => {
    const forged = { ownerId: 'learner-b', userId: 'learner-b' };
    const listed = await call(
      decks.GET as Handler,
      event('learner-a', {
        query: '?ownerId=learner-b&userId=learner-b&learnerId=learner-b'
      })
    );
    expect(listed.body).toEqual({ decks: [] });
    const before = await privateState(client);
    const response = await call(
      approve.POST as Handler,
      event('learner-a', { params: { id: 'note-b' }, body: forged })
    );
    expect(response.status).toBe(404);
    expect(await privateState(client)).toEqual(before);
  });

  it('reject malformed bodies with 400 and no writes', async () => {
    const before = await privateState(client);
    for (const body of ['not json', '[]', 'null']) {
      const response = await call(
        reviews.POST as Handler,
        event('learner-b', { params: { id: 'card:note-b' }, body })
      );
      expect(response.status).toBe(400);
    }
    const rating = await call(
      reviews.POST as Handler,
      event('learner-b', {
        params: { id: 'card:note-b' },
        body: { submissionId: 'r2', expectedRevision: 1, rating: 'perfect' }
      })
    );
    expect(rating.status).toBe(400);
    expect(await privateState(client)).toEqual(before);
  });

  it('let the owner review and record an attempt through the routes', async () => {
    const reviewed = await call(
      reviews.POST as Handler,
      event('learner-b', {
        params: { id: 'card:note-b' },
        body: { submissionId: 'review-b2', expectedRevision: 1, rating: 'hard' }
      })
    );
    expect(reviewed.status).toBe(200);
    expect(reviewed.body).toMatchObject({ revision: 2, duplicate: false });
    const stale = await call(
      reviews.POST as Handler,
      event('learner-b', {
        params: { id: 'card:note-b' },
        body: { submissionId: 'review-b3', expectedRevision: 1, rating: 'hard' }
      })
    );
    expect(stale.status).toBe(409);

    const recorded = await call(
      attempts.POST as Handler,
      event('learner-a', {
        body: {
          studySessionId: 'study-a',
          questionId: 'question-1',
          submissionKey: 'route-attempt',
          evidenceKind: 'independent',
          answer: 'est'
        }
      })
    );
    expect(recorded.status).toBe(201);
    const read = await call(
      attempt.GET as Handler,
      event('learner-a', { params: { id: recorded.body.id } })
    );
    expect(read.body.attempt).toMatchObject({
      id: recorded.body.id,
      answer: 'est'
    });
    expect(read.body.attempt).not.toHaveProperty('ownerId');
  });
});
