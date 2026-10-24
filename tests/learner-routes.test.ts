import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client, InStatement } from '@libsql/client';
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
import * as pause from '../src/routes/app/api/study-sessions/[id]/pause/+server';
import * as resume from '../src/routes/app/api/study-sessions/[id]/resume/+server';
import * as next from '../src/routes/app/api/study-sessions/[id]/next/+server';
import {
  actions as lessonActions,
  load as lessonPage
} from '../src/routes/app/learn/[language]/lesson/[skill]/+page.server';
import { importContent } from '../src/lib/server/content-import';
import { recordAnswer } from '../src/lib/server/lesson-practice';
import { recordAttempt } from '../src/lib/server/study';
import { approvedPackage } from './fixtures/content-package';

// Route handlers called the way SvelteKit calls them. The principals are the
// synthetic fixture users; the hook-verified locals are the only identity.
// Real signed-in sessions are covered by tests/e2e/owner-routes.spec.ts.

type Handler = (event: never) => Promise<Response>;

let target: FixtureTarget;
let client: Client;
let close: (() => void) | undefined;
let deprecatedErrorWarning = false;

beforeEach(() => {
  deprecatedErrorWarning = false;
  vi.spyOn(console, 'warn').mockImplementation((...args) => {
    if (args.some((arg) => String(arg).includes('error_body_deprecated')))
      deprecatedErrorWarning = true;
  });
});

beforeEach(async () => {
  target = await fixture();
  ({ client, close } = await openFixtureDatabase(target));
  const ownerB = testSession('learner-b');
  await createDeck(client, ownerB, {
    language: 'fr',
    id: 'deck-b',
    name: 'Deutsch'
  });
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
    submissionId: 'b0000000-0000-4000-8000-000000000001',
    expectedRevision: 0,
    rating: 'good'
  });
});

afterEach(async () => {
  const warned = deprecatedErrorWarning;
  vi.restoreAllMocks();
  close?.();
  close = undefined;
  await disposeFlashcardFixtures();
  expect(warned).toBe(false);
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
    expect(response).toMatchObject({
      status: 503,
      body: { message: 'Study data is not available yet.' }
    });
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
      'b0000000-0000-4000-8000-000000000001'
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
        {
          submissionId: 'a0000000-0000-4000-8000-000000000001',
          expectedRevision: 1,
          rating: 'easy'
        }
      ],
      [
        reviews.POST as Handler,
        'card:note-b',
        {
          submissionId: 'b0000000-0000-4000-8000-000000000001',
          expectedRevision: 0,
          rating: 'good'
        }
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
      expect(response).toMatchObject({
        status: 400,
        body: { message: 'Invalid request.' }
      });
    }
    const rating = await call(
      reviews.POST as Handler,
      event('learner-b', {
        params: { id: 'card:note-b' },
        body: {
          submissionId: 'b0000000-0000-4000-8000-000000000002',
          expectedRevision: 1,
          rating: 'perfect'
        }
      })
    );
    expect(rating.status).toBe(400);
    expect(await privateState(client)).toEqual(before);
  });

  it.each(['', '   ', '\n\t', '\u00a0\u2003'])(
    'rejects a blank attempt answer %j with no private writes',
    async (answer) => {
      await client.execute(
        "INSERT INTO questions (id, content_version_id, skill_id, language, format) VALUES ('question-3', 'content-v1', 'fr-articles', 'fr', 'typed-blank')"
      );
      const before = await privateState(client);
      const response = await call(
        attempts.POST as Handler,
        event('learner-a', {
          body: {
            studySessionId: 'study-a',
            questionId: 'question-3',
            submissionKey: 'blank-attempt',
            evidenceKind: 'independent',
            answer
          }
        })
      );
      expect(response).toMatchObject({
        status: 400,
        body: { message: 'Invalid request.' }
      });
      expect(await privateState(client)).toEqual(before);
    }
  );

  it('let the owner review and record an attempt through the routes', async () => {
    const reviewed = await call(
      reviews.POST as Handler,
      event('learner-b', {
        params: { id: 'card:note-b' },
        body: {
          submissionId: 'b0000000-0000-4000-8000-000000000002',
          expectedRevision: 1,
          rating: 'hard'
        }
      })
    );
    expect(reviewed.status).toBe(200);
    expect(reviewed.body).toMatchObject({ revision: 2, duplicate: false });
    const stale = await call(
      reviews.POST as Handler,
      event('learner-b', {
        params: { id: 'card:note-b' },
        body: {
          submissionId: 'b0000000-0000-4000-8000-000000000003',
          expectedRevision: 1,
          rating: 'hard'
        }
      })
    );
    expect(stale.status).toBe(409);

    // A second version-1 question: study-a already answered question-1.
    await client.execute(
      "INSERT INTO questions (id, content_version_id, skill_id, language, format) VALUES ('question-3', 'content-v1', 'fr-articles', 'fr', 'typed-blank')"
    );
    const recorded = await call(
      attempts.POST as Handler,
      event('learner-a', {
        body: {
          studySessionId: 'study-a',
          questionId: 'question-3',
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

describe('pause, resume and next-question routes', () => {
  const params = { id: 'study-a' };

  it('reject an unauthenticated caller before touching data', async () => {
    const before = await privateState(client);
    for (const [handler, query] of [
      [pause.POST, ''],
      [resume.POST, ''],
      [next.GET, '?skill=fr-a1-001']
    ] as const) {
      const body = handler === next.GET ? undefined : {};
      expect(
        (await call(handler as Handler, event(null, { params, body, query })))
          .status
      ).toBe(401);
    }
    expect(await privateState(client)).toEqual(before);
  });

  it("answer 404 for another learner's session and change nothing", async () => {
    const before = await privateState(client);
    for (const [handler, query] of [
      [pause.POST, ''],
      [resume.POST, ''],
      [next.GET, '?skill=fr-a1-001']
    ] as const) {
      const body = handler === next.GET ? undefined : {};
      expect(
        (
          await call(
            handler as Handler,
            event('learner-b', { params, body, query })
          )
        ).status
      ).toBe(404);
    }
    expect(await privateState(client)).toEqual(before);
  });

  it('pause, resume and serve the next item for the owner', async () => {
    await importContent(client, approvedPackage());
    const paused = await call(
      pause.POST as Handler,
      event('learner-a', { params, body: {} })
    );
    expect(paused.status).toBe(200);
    expect(paused.body.studySession).toMatchObject({ state: 'paused' });
    expect(paused.body.studySession.pausedAt).toEqual(expect.any(Number));
    const blocked = await call(
      next.GET as Handler,
      event('learner-a', { params, query: '?skill=fr-a1-001' })
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({
      message:
        'This session is paused or finished. Only a paused session can be resumed.'
    });
    const resumed = await call(
      resume.POST as Handler,
      event('learner-a', { params, body: {} })
    );
    expect(resumed.body.studySession).toMatchObject({
      state: 'active',
      pausedAt: null
    });
    const served = await call(
      next.GET as Handler,
      event('learner-a', { params, query: '?skill=fr-a1-001' })
    );
    expect(served.body.question).toMatchObject({ id: 'fr-a1-001@1:q1' });
    expect(served.body.question).not.toHaveProperty('answer');
  });

  it('returns options for multiple choice but never accepted answers', async () => {
    await importContent(client, approvedPackage());
    const choice = await call(
      next.GET as Handler,
      event('learner-a', { params, query: '?skill=fr-a1-001' })
    );
    expect(choice.body.question.alternatives).toEqual(['suis', 'es', 'est']);
    const translation = await call(
      next.GET as Handler,
      event('learner-a', { params, query: '?skill=fr-a1-002' })
    );
    expect(translation.body.question).toMatchObject({
      id: 'fr-a1-002@1:q1',
      format: 'translation'
    });
    expect(translation.body.question).not.toHaveProperty('alternatives');
    expect(JSON.stringify(translation.body)).not.toContain('On est ici.');
  });

  it('says withdrawn content is unavailable rather than a generic conflict', async () => {
    await importContent(client, approvedPackage());
    await client.execute(
      "UPDATE content_versions SET status = 'quarantined' WHERE id = 'fr-a1-001@1'"
    );
    const response = await call(
      next.GET as Handler,
      event('learner-a', { params, query: '?skill=fr-a1-001' })
    );
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      message: 'This content is not available right now.'
    });
  });

  it('rejects a missing skill with 400', async () => {
    const response = await call(
      next.GET as Handler,
      event('learner-a', { params })
    );
    expect(response).toMatchObject({
      status: 400,
      body: { message: 'Invalid request.' }
    });
  });
});

describe('lesson page load', () => {
  const lesson = {
    title: 'Être',
    explanation: 'Use être to say who you are.',
    examples: [{ fr: 'Je suis étudiant.', en: 'I am a student.' }],
    references: []
  };
  const load = (userId: string | null, language = 'fr', skill = 'fr-a1-001') =>
    lessonPage(
      Object.assign(event(userId), { params: { language, skill } }) as never
    ) as Promise<Record<string, unknown>>;

  beforeEach(async () => {
    const pkg = approvedPackage();
    Object.assign(pkg.versions[0], { lesson });
    await importContent(client, pkg);
  });

  it('redirects a signed-out visitor to sign in', async () => {
    await expect(load(null)).rejects.toMatchObject({
      status: 303,
      location: '/login'
    });
  });

  it('loads the lesson for an enrolled learner', async () => {
    expect(await load('learner-a')).toMatchObject({
      unavailable: false,
      lesson: { title: 'Être', englishFallback: false }
    });
  });

  it('returns map-originated lesson visits to their safe map context', async () => {
    const e = Object.assign(event('learner-a'), {
      params: { language: 'fr', skill: 'fr-a1-001' },
      url: new URL(
        'http://127.0.0.1/app/learn/fr/lesson/fr-a1-001?returnTo=%2Fapp%2Fmap%3Flanguage%3Dfr%26skill%3Dfr-a1-001%26view%3Dlist%26next%3D%252Fapp%252Fdecks'
      )
    });
    expect(await lessonPage(e as never)).toMatchObject({
      returnTo: '/app/map?language=fr&skill=fr-a1-001&view=list'
    });
  });

  it('preserves the safe map context when lesson content becomes unavailable', async () => {
    await client.execute(
      "UPDATE content_versions SET status = 'quarantined' WHERE id = 'fr-a1-001@1'"
    );
    const e = Object.assign(event('learner-a'), {
      params: { language: 'fr', skill: 'fr-a1-001' },
      url: new URL(
        'http://127.0.0.1/app/learn/fr/lesson/fr-a1-001?returnTo=%2Fapp%2Fmap%3Flanguage%3Dfr%26skill%3Dfr-a1-001%26view%3Dlist'
      )
    });
    expect(await lessonPage(e as never)).toMatchObject({
      unavailable: true,
      lesson: null,
      returnTo: '/app/map?language=fr&skill=fr-a1-001&view=list'
    });
  });

  it('answers 404 for a track the learner is not enrolled in', async () => {
    await expect(load('learner-a', 'de')).rejects.toMatchObject({
      status: 404,
      body: { message: 'Lesson not found.' }
    });
  });

  it('answers 409 when an assessment session opens a lesson page', async () => {
    const e = Object.assign(event('learner-b'), {
      params: { language: 'fr', skill: 'fr-a1-001' },
      url: new URL(
        'http://127.0.0.1/app/learn/fr/lesson/fr-a1-001?session=study-b'
      )
    });
    await expect(lessonPage(e as never)).rejects.toMatchObject({
      status: 409,
      body: {
        message:
          'Use the assessment page to continue. Lessons and feedback are hidden during assessments.'
      }
    });
  });

  it('answers 503 with a safe message when study data is not configured', async () => {
    const e = Object.assign(event('learner-a', { config: undefined }), {
      params: { language: 'fr', skill: 'fr-a1-001' }
    });
    await expect(lessonPage(e as never)).rejects.toMatchObject({
      status: 503,
      body: { message: 'Study data is not available yet.' }
    });
  });

  it('rejects a route language that differs from the owned session', async () => {
    const before = await privateState(client);
    const e = Object.assign(event('learner-a'), {
      params: { language: 'de', skill: 'fr-a1-001' },
      url: new URL(
        'http://127.0.0.1/app/learn/de/lesson/fr-a1-001?session=study-a'
      )
    });
    await expect(lessonPage(e as never)).rejects.toMatchObject({ status: 404 });
    expect(await privateState(client)).toEqual(before);
  });

  it('shows an unavailable notice for quarantined content', async () => {
    await client.execute(
      "UPDATE content_versions SET status = 'quarantined' WHERE id = 'fr-a1-001@1'"
    );
    expect(await load('learner-a')).toMatchObject({
      unavailable: true,
      lesson: null
    });
  });
});

describe('lesson report action', () => {
  const report = (fields: Record<string, string>) => {
    const form = new FormData();
    for (const [name, value] of Object.entries({
      submissionKey: crypto.randomUUID(),
      category: 'unclear',
      comment: '',
      ...fields
    }))
      form.set(name, value);
    const base = event('learner-a', {
      params: { language: 'fr', skill: 'fr-a1-001' }
    }) as unknown as { request: Request };
    base.request = new Request('http://127.0.0.1/app/learn', {
      method: 'POST',
      body: form
    });
    return (lessonActions.report as unknown as (e: never) => Promise<unknown>)(
      base as never
    );
  };
  const reportCount = async () =>
    Number(
      (await client.execute('SELECT COUNT(*) AS n FROM content_reports'))
        .rows[0]?.n
    );

  beforeEach(async () => {
    await importContent(client, approvedPackage());
  });

  it("saves a report for the route's own lesson and question", async () => {
    expect(
      await report({
        contentVersionId: 'fr-a1-001@1',
        questionId: 'fr-a1-001@1:q1'
      })
    ).toEqual({ reported: true });
    expect(await reportCount()).toBe(1);
  });

  it('rejects a posted target that belongs to another skill and stores nothing', async () => {
    expect(
      await report({ contentVersionId: 'fr-a1-002@1', questionId: '' })
    ).toMatchObject({ status: 404 });
    expect(
      await report({
        contentVersionId: 'fr-a1-002@1',
        questionId: 'fr-a1-002@1:q1'
      })
    ).toMatchObject({ status: 404 });
    expect(await reportCount()).toBe(0);
  });
});

describe('lesson answer action', () => {
  const attemptCount = async () =>
    Number(
      (await client.execute('SELECT COUNT(*) AS n FROM attempts')).rows[0]?.n
    );

  const submit = (
    userId: string | null,
    fields: Record<string, string>,
    sessionId = 'study-a'
  ) => {
    const form = new FormData();
    for (const [name, value] of Object.entries({
      studySessionId: sessionId,
      submissionKey: `key-${Math.random()}`,
      ...fields
    }))
      form.set(name, value);
    const base = event(userId, {
      params: { language: 'fr', skill: 'fr-a1-001' }
    }) as unknown as { request: Request };
    base.request = new Request('http://127.0.0.1/app/learn', {
      method: 'POST',
      body: form
    });
    return (lessonActions.answer as unknown as (e: never) => Promise<unknown>)(
      base as never
    );
  };

  const q1 = { questionId: 'fr-a1-001@1:q1', answer: 'suis' };
  const q2 = { questionId: 'fr-a1-001@1:q2' };
  const ownerA = testSession('learner-a');

  beforeEach(async () => {
    const pkg = approvedPackage();
    Object.assign(pkg.versions[0], {
      lesson: {
        title: 'Être',
        explanation: 'Use être.',
        examples: [],
        references: []
      }
    });
    await importContent(client, pkg);
  });

  it('answers 401 to a signed-out caller and writes nothing', async () => {
    const before = await attemptCount();
    await expect(submit(null, q1)).rejects.toMatchObject({ status: 401 });
    expect(await attemptCount()).toBe(before);
  });

  it("answers 404 for another learner's session and writes nothing", async () => {
    const before = await attemptCount();
    expect(await submit('learner-b', q1, 'study-a')).toMatchObject({
      status: 404
    });
    expect(await attemptCount()).toBe(before);
  });

  it('records an independent answer with composed accents', async () => {
    expect(await submit('learner-a', q1)).toMatchObject({ recorded: true });
    // "e" followed by a combining acute is stored as the one letter "é".
    expect(
      await submit('learner-a', { ...q2, answer: 'e\u0301te\u0301' })
    ).toMatchObject({ recorded: true, duplicate: false });
    const stored = await client.execute(
      "SELECT answer, evidence_kind FROM attempts WHERE question_id = 'fr-a1-001@1:q2'"
    );
    expect(stored.rows[0]).toMatchObject({
      answer: 'été',
      evidence_kind: 'independent'
    });
  });

  it.each([
    ['an empty answer', '', 'Enter an answer before you submit.'],
    ['a blank answer', '   \n ', 'Enter an answer before you submit.'],
    [
      'an oversized answer',
      'a'.repeat(4097),
      'Your answer is too long. Keep it under 4096 characters.'
    ],
    [
      'an answer with a null byte',
      'es\0',
      'Your answer contains characters that cannot be sent.'
    ],
    [
      'a multi-line blank',
      'es\nes',
      'Your answer contains characters that cannot be sent.'
    ]
  ])(
    'refuses %s with specific feedback and writes nothing',
    async (_name, answer, message) => {
      await submit('learner-a', q1);
      const before = await attemptCount();
      expect(await submit('learner-a', { ...q2, answer })).toMatchObject({
        status: 400,
        data: { message }
      });
      expect(await attemptCount()).toBe(before);
    }
  );

  it('records 4096 supplementary-plane characters as a valid answer', async () => {
    await submit('learner-a', q1);
    const answer = '😀'.repeat(4096);
    expect(await submit('learner-a', { ...q2, answer })).toMatchObject({
      recorded: true
    });
    const stored = await client.execute(
      "SELECT answer FROM attempts WHERE question_id = 'fr-a1-001@1:q2'"
    );
    expect(stored.rows[0]?.answer).toBe(answer);
  });

  it('refuses a multiple-choice answer that is not an option', async () => {
    const before = await attemptCount();
    expect(
      await submit('learner-a', { ...q1, answer: 'sommes' })
    ).toMatchObject({ status: 400 });
    expect(await attemptCount()).toBe(before);
  });

  it('answers a repeated submission with the original attempt', async () => {
    const retry = { ...q1, submissionKey: 'retry-key' };
    expect(await submit('learner-a', retry)).toMatchObject({
      recorded: true,
      duplicate: false
    });
    const before = await attemptCount();
    // The session has moved on to the next question; the retry is still the
    // same submission, not a stale one.
    expect(await submit('learner-a', retry)).toMatchObject({
      recorded: true,
      duplicate: true
    });
    expect(await attemptCount()).toBe(before);
    expect(await submit('learner-a', { ...retry, answer: 'es' })).toMatchObject(
      { status: 409 }
    );
  });

  it('answers a retry that a concurrent request recorded mid-flight', async () => {
    const form = new FormData();
    for (const [name, value] of Object.entries({
      studySessionId: 'study-a',
      submissionKey: 'racing-key',
      ...q1
    }))
      form.set(name, value);
    const before = await attemptCount();
    // The first read of the session's questions finds the same submission
    // committed by another request, so the session has already moved on.
    let raced = false;
    const racing = new Proxy(client, {
      get(target, property) {
        if (property !== 'execute') return Reflect.get(target, property);
        return async (statement: InStatement) => {
          const sql = typeof statement === 'string' ? statement : statement.sql;
          if (!raced && sql.includes('AS answered')) {
            raced = true;
            await recordAttempt(client, ownerA, {
              studySessionId: 'study-a',
              questionId: q1.questionId,
              submissionKey: 'racing-key',
              evidenceKind: 'independent',
              answer: q1.answer
            });
          }
          return target.execute(statement);
        };
      }
    });
    expect(await recordAnswer(racing, ownerA, form, 'fr-a1-001')).toMatchObject(
      { recorded: true, duplicate: true }
    );
    expect(raced).toBe(true);
    // Only the racing request's own attempt was written.
    expect(await attemptCount()).toBe(before + 1);
  });

  it('refuses a question the session is not on', async () => {
    const before = await attemptCount();
    expect(await submit('learner-a', { ...q2, answer: 'es' })).toMatchObject({
      status: 409,
      data: { message: 'This question is out of date. Reload to continue.' }
    });
    expect(await attemptCount()).toBe(before);
  });

  it('serves the exercise on the lesson page without its answer', async () => {
    const e = Object.assign(
      event('learner-a', { params: { language: 'fr', skill: 'fr-a1-001' } }),
      { url: new URL('http://127.0.0.1/x?session=study-a') }
    );
    const loaded = (await lessonPage(e as never)) as {
      exercise: { question: Record<string, unknown>; submissionKey: string };
    };
    expect(loaded.exercise.question).toMatchObject({
      id: 'fr-a1-001@1:q1',
      format: 'multiple-choice'
    });
    expect(loaded.exercise.question).not.toHaveProperty('answer');
    expect(loaded.exercise.submissionKey).toEqual(expect.any(String));
  });
});
