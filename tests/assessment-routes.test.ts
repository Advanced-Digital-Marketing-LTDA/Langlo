import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import type { RuntimeConfig } from '../src/lib/server/config';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { importContent } from '../src/lib/server/content-import';
import { getAssessment, startAssessment } from '../src/lib/server/assessment';
import { recordAttempt } from '../src/lib/server/study';
import { listContentReports } from '../src/lib/server/content-reports';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { privateState } from './fixtures/owner-scope';
import { approvedPackage } from './fixtures/content-package';
import { load as indexPage } from '../src/routes/app/assessment/+page.server';
import {
  load as startPage,
  actions as startActions
} from '../src/routes/app/assessment/[language]/+page.server';
import {
  load as sessionPage,
  actions as sessionActions
} from '../src/routes/app/assessment/session/[id]/+page.server';
import {
  load as resultsPage,
  actions as resultsActions
} from '../src/routes/app/assessment/session/[id]/results/+page.server';
import { load as reportsPage } from '../src/routes/app/reports/+page.server';

const learner = testSession('learner-a');
let client: Client;
let close: () => void;
let databaseUrl: string;

beforeEach(async () => {
  const target = await fixture();
  databaseUrl = target.databaseUrl;
  ({ client, close } = await openFixtureDatabase(target));
  const pkg = approvedPackage();
  for (const version of pkg.versions) {
    version.lesson = {
      title: `Synthetic ${version.skillId}`,
      explanation: 'Synthetic explanation',
      examples: [],
      references: []
    };
    version.questions[0].holdout = true;
  }
  await importContent(client, pkg);
});

afterEach(async () => {
  close?.();
  await disposeFlashcardFixtures();
});

function event(
  options: {
    id?: string;
    language?: string;
    userId?: string | null;
    fields?: Record<string, string>;
    config?: RuntimeConfig | undefined;
  } = {}
) {
  const userId = options.userId === undefined ? learner.userId : options.userId;
  const form = new FormData();
  for (const [key, value] of Object.entries(options.fields ?? {}))
    form.set(key, value);
  return {
    params: { id: options.id ?? '', language: options.language ?? 'fr' },
    locals: {
      user: userId ? { id: userId } : null,
      session: userId ? { userId } : null,
      config: Object.hasOwn(options, 'config')
        ? options.config
        : ({ dataEnabled: true, databaseUrl } as RuntimeConfig)
    },
    request: new Request(
      'http://127.0.0.1/app/assessment',
      options.fields ? { method: 'POST', body: form } : undefined
    )
  } as never;
}

const start = () =>
  startAssessment(client, learner, {
    language: 'fr',
    submissionKey: randomUUID()
  });
const sessionUrl = (id: string) =>
  `/app/assessment/session/${encodeURIComponent(id)}`;
const answerFields = (questionId: string, answer = 'suis') => ({
  questionId,
  answer,
  submissionKey: randomUUID()
});

async function finish(id: string) {
  await recordAttempt(client, learner, {
    studySessionId: id,
    questionId: 'fr-a1-001@1:q1',
    answer: 'suis',
    submissionKey: randomUUID(),
    evidenceKind: 'independent'
  });
  await recordAttempt(client, learner, {
    studySessionId: id,
    questionId: 'fr-a1-002@1:q1',
    answer: 'Nous sommes ici.',
    submissionKey: randomUUID(),
    evidenceKind: 'independent'
  });
}

describe('assessment page boundaries', () => {
  it('lists only the owner’s unfinished assessments and enrolled tracks', async () => {
    const own = await start();
    const completed = await start();
    await finish(completed.id);
    await startAssessment(client, testSession('learner-b'), {
      language: 'fr',
      submissionKey: randomUUID()
    });
    const data = await indexPage(event());
    expect(data).toMatchObject({
      tracks: [{ language: 'fr', level: 'A1' }],
      saved: [{ id: own.id, language: 'fr', state: 'active' }]
    });
    expect(await indexPage(event({ userId: 'no-enrollment' }))).toEqual({
      tracks: [],
      saved: []
    });
  });

  it('requires login for every private page before opening a database', async () => {
    for (const load of [
      indexPage,
      startPage,
      sessionPage,
      resultsPage,
      reportsPage
    ])
      await expect(
        load(event({ userId: null, config: undefined }))
      ).rejects.toMatchObject({ status: 303, location: '/login' });
  });

  it('refuses unauthenticated form actions without writes', async () => {
    const before = await privateState(client);
    for (const action of [
      startActions.start,
      sessionActions.answer,
      sessionActions.resume,
      resultsActions.report
    ])
      await expect(
        action(event({ userId: null, fields: {} }))
      ).rejects.toMatchObject({ status: 401 });
    expect(await privateState(client)).toEqual(before);
  });

  it('shows the enrolled level and refuses unavailable data or an unenrolled language', async () => {
    expect(await startPage(event())).toMatchObject({
      language: 'fr',
      level: 'A1',
      submissionKey: expect.stringMatching(/^[a-f0-9-]{36}$/)
    });
    await expect(startPage(event({ language: 'de' }))).rejects.toMatchObject({
      status: 404
    });
    await expect(indexPage(event({ config: undefined }))).rejects.toMatchObject(
      { status: 503 }
    );
  });

  it('creates and replays a start from form data while ignoring a forged owner', async () => {
    const submissionKey = randomUUID();
    const request = event({ fields: { submissionKey, ownerId: 'learner-b' } });
    const id = `assessment:${submissionKey}`;
    await expect(startActions.start(request)).rejects.toMatchObject({
      status: 303,
      location: sessionUrl(id)
    });
    await expect(
      startActions.start(event({ fields: { submissionKey } }))
    ).rejects.toMatchObject({ status: 303, location: sessionUrl(id) });
    const rows = await client.execute({
      sql: 'SELECT owner_id FROM study_sessions WHERE id = ?',
      args: [id]
    });
    expect(rows.rows).toEqual([{ owner_id: 'learner-a' }]);
    await expect(
      startActions.start(event({ fields: {} }))
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('assessment answer and completion routes', () => {
  it('reloads the current question without typed rubrics and denies foreign session IDs', async () => {
    const { id } = await start();
    expect(await sessionPage(event({ id }))).toMatchObject({
      assessment: {
        answered: 0,
        total: 2,
        question: { id: 'fr-a1-001@1:q1', alternatives: ['suis', 'es', 'est'] }
      }
    });
    await expect(
      sessionActions.answer(
        event({ id, fields: answerFields('fr-a1-001@1:q1') })
      )
    ).rejects.toMatchObject({ status: 303, location: sessionUrl(id) });
    const reloaded = await sessionPage(event({ id }));
    expect(reloaded).toMatchObject({
      assessment: { answered: 1, question: { id: 'fr-a1-002@1:q1' } }
    });
    expect(JSON.stringify(reloaded)).not.toContain('Nous sommes ici.');
    const before = await privateState(client);
    for (const load of [sessionPage, resultsPage])
      await expect(
        load(event({ id, userId: 'learner-b' }))
      ).rejects.toMatchObject({ status: 404 });
    await expect(
      sessionActions.answer(
        event({
          id,
          userId: 'learner-b',
          fields: answerFields('fr-a1-002@1:q1', 'Nous sommes ici.')
        })
      )
    ).rejects.toMatchObject({ status: 404 });
    expect(await privateState(client)).toEqual(before);
  });

  it('returns actionable validation failures and never saves empty, invalid-option or stale answers', async () => {
    const { id } = await start();
    const before = await privateState(client);
    for (const answer of ['', 'not an option'])
      expect(
        await sessionActions.answer(
          event({ id, fields: answerFields('fr-a1-001@1:q1', answer) })
        )
      ).toMatchObject({ status: 400, data: { message: expect.any(String) } });
    await expect(
      sessionActions.answer(
        event({
          id,
          fields: answerFields('fr-a1-002@1:q1', 'Nous sommes ici.')
        })
      )
    ).rejects.toMatchObject({ status: 409 });
    expect(await privateState(client)).toEqual(before);
  });

  it('records Not sure and safely replays both partial and final form submissions', async () => {
    const { id } = await start();
    const first = {
      questionId: 'fr-a1-001@1:q1',
      intent: 'unsure',
      submissionKey: randomUUID()
    };
    for (let i = 0; i < 2; i++)
      await expect(
        sessionActions.answer(event({ id, fields: first }))
      ).rejects.toMatchObject({ status: 303 });
    await expect(resultsPage(event({ id }))).rejects.toMatchObject({
      status: 409
    });
    const final = answerFields('fr-a1-002@1:q1', 'Nous sommes ici.');
    for (let i = 0; i < 2; i++)
      await expect(
        sessionActions.answer(event({ id, fields: final }))
      ).rejects.toMatchObject({ status: 303, location: sessionUrl(id) });
    await expect(sessionPage(event({ id }))).rejects.toMatchObject({
      status: 303,
      location: `${sessionUrl(id)}/results`
    });
    expect(await resultsPage(event({ id }))).toMatchObject({
      results: {
        counts: { correct: 1, incorrect: 0, uncertain: 1 },
        a1Gaps: ['fr-a1-001']
      },
      reportKeys: {
        'fr-a1-001@1:q1': expect.any(String),
        'fr-a1-002@1:q1': expect.any(String)
      }
    });
    expect(
      (
        await client.execute({
          sql: 'SELECT COUNT(*) AS n FROM attempts WHERE study_session_id = ?',
          args: [id]
        })
      ).rows[0].n
    ).toBe(2);
  });

  it('resumes only the owner’s paused saved assessment without revealing feedback', async () => {
    const { id } = await start();
    await client.execute({
      sql: "UPDATE study_sessions SET state = 'paused', paused_at = 100 WHERE id = ?",
      args: [id]
    });
    expect(await sessionPage(event({ id }))).toMatchObject({
      assessment: { state: 'paused', question: null }
    });
    await expect(
      sessionActions.resume(event({ id, userId: 'learner-b', fields: {} }))
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      sessionActions.resume(event({ id, fields: {} }))
    ).rejects.toMatchObject({ status: 303, location: sessionUrl(id) });
    expect(await getAssessment(client, learner, id)).toMatchObject({
      state: 'active',
      answered: 0
    });
  });
});

describe('completed assessment reports', () => {
  it('persists the exact completed item and exposes it only to the reporting owner', async () => {
    const { id } = await start();
    await finish(id);
    const fields = {
      questionId: 'fr-a1-001@1:q1',
      contentVersionId: 'fr-a1-001@1',
      category: 'unclear',
      comment: '<script>untrusted report</script>',
      submissionKey: randomUUID(),
      ownerId: 'learner-b'
    };
    expect(await resultsActions.report(event({ id, fields }))).toEqual({
      reported: true
    });
    expect(await resultsActions.report(event({ id, fields }))).toEqual({
      reported: true
    });
    expect(await reportsPage(event())).toMatchObject({
      reports: [
        {
          questionId: fields.questionId,
          contentVersionId: fields.contentVersionId,
          comment: fields.comment
        }
      ]
    });
    expect(await reportsPage(event({ userId: 'learner-b' }))).toEqual({
      reports: []
    });
    expect(await listContentReports(client, learner)).toHaveLength(1);
  });

  it('refuses reports before completion, for foreign sessions and for mismatched targets without writes', async () => {
    const { id } = await start();
    const fields = {
      questionId: 'fr-a1-001@1:q1',
      contentVersionId: 'fr-a1-001@1',
      category: 'unclear',
      submissionKey: randomUUID()
    };
    const before = await privateState(client);
    await expect(
      resultsActions.report(event({ id, fields }))
    ).rejects.toMatchObject({ status: 409 });
    expect(await privateState(client)).toEqual(before);
    await finish(id);
    for (const options of [
      { id, userId: 'learner-b', fields },
      { id, fields: { ...fields, questionId: 'missing' } },
      { id, fields: { ...fields, contentVersionId: 'missing' } }
    ])
      await expect(resultsActions.report(event(options))).rejects.toMatchObject(
        { status: 404 }
      );
    expect(await listContentReports(client, learner)).toEqual([]);
  });
});
