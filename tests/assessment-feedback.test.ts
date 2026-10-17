import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { getAttempt, listEvaluations } from '../src/lib/server/study';
import { recordAttempt } from '../src/lib/server/study';
import {
  practiceFeedback,
  recordAnswer
} from '../src/lib/server/lesson-practice';
import { importContent } from '../src/lib/server/content-import';
import { approvedPackage } from './fixtures/content-package';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';

const learner = testSession('learner-a');
let client: Client;
let close: () => void;

beforeEach(async () => {
  ({ client, close } = await openFixtureDatabase(await fixture()));
  await client.execute(
    "UPDATE study_sessions SET mode = 'assessment' WHERE id = 'study-a'"
  );
});

describe('practice feedback and assisted retries', () => {
  beforeEach(async () => {
    await client.execute(
      "UPDATE study_sessions SET mode = 'practice' WHERE id = 'study-a'"
    );
    await importContent(client, approvedPackage());
  });

  it('shows recorded feedback on reload and marks a retry assisted despite forged input', async () => {
    const first = await recordAttempt(client, learner, {
      studySessionId: 'study-a',
      questionId: 'fr-a1-001@1:q1',
      submissionKey: 'practice-first',
      evidenceKind: 'independent',
      answer: 'es'
    });
    const feedback = await practiceFeedback(
      client,
      learner,
      'study-a',
      'fr-a1-001'
    );
    expect(feedback).toMatchObject({
      attemptId: first.id,
      questionId: 'fr-a1-001@1:q1',
      contentVersionId: 'fr-a1-001@1',
      outcome: 'incorrect',
      expectedAnswer: 'suis',
      evidenceKind: 'independent'
    });
    const form = new FormData();
    for (const [key, value] of Object.entries({
      studySessionId: 'study-a',
      questionId: 'fr-a1-001@1:q1',
      submissionKey: 'retry-1',
      retryAttemptId: first.id,
      evidenceKind: 'independent',
      answer: 'suis'
    }))
      form.set(key, value);
    expect(
      await recordAnswer(client, learner, form, 'fr-a1-001')
    ).toMatchObject({ recorded: true });
    expect(
      await practiceFeedback(client, learner, 'study-a', 'fr-a1-001')
    ).toMatchObject({ outcome: 'correct', evidenceKind: 'assisted' });
    expect(
      await recordAnswer(client, learner, form, 'fr-a1-001')
    ).toMatchObject({ duplicate: true });
  });

  it('cannot regain independent status by opening a new session', async () => {
    const input = {
      studySessionId: 'study-a',
      questionId: 'fr-a1-001@1:q1',
      submissionKey: 'first',
      evidenceKind: 'independent' as const,
      answer: 'suis'
    };
    await recordAttempt(client, learner, input);
    await client.execute(
      "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode) VALUES ('study-again', 'learner-a', 'enrollment-a', 'fr', 'practice')"
    );
    const again = {
      ...input,
      studySessionId: 'study-again',
      submissionKey: 'again'
    };
    const saved = await recordAttempt(client, learner, again);
    expect((await getAttempt(client, learner, saved.id)).evidenceKind).toBe(
      'assisted'
    );
    expect(await recordAttempt(client, learner, again)).toMatchObject({
      duplicate: true
    });
  });

  it('never exposes practice feedback or allows retries for an assessment or foreign owner', async () => {
    await client.execute(
      "UPDATE study_sessions SET mode = 'assessment' WHERE id = 'study-a'"
    );
    await expect(
      practiceFeedback(client, learner, 'study-a', 'fr-a1-001')
    ).rejects.toMatchObject({ code: 'ASSESSMENT_MODE' });
    await expect(
      practiceFeedback(client, testSession('learner-b'), 'study-a', 'fr-a1-001')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const form = new FormData();
    for (const [key, value] of Object.entries({
      studySessionId: 'study-a',
      questionId: 'question-1',
      submissionKey: 'forged',
      retryAttemptId: 'attempt-a',
      answer: 'un'
    }))
      form.set(key, value);
    await expect(
      recordAnswer(client, learner, form, 'fr-articles')
    ).rejects.toMatchObject({ code: 'ASSESSMENT_MODE' });
  });
});
afterEach(async () => {
  close?.();
  await disposeFlashcardFixtures();
});

describe('assessment feedback disclosure', () => {
  it.each(['active', 'paused'])(
    'hides evaluations for a %s assessment through both readers',
    async (state) => {
      await client.execute({
        sql: 'UPDATE study_sessions SET state = ? WHERE id = ?',
        args: [state, 'study-a']
      });
      expect(
        (await getAttempt(client, learner, 'attempt-a')).evaluations
      ).toEqual([]);
      expect(await listEvaluations(client, learner, 'attempt-a')).toEqual([]);
    }
  );

  it('reveals evaluations only after completion', async () => {
    await client.execute(
      "UPDATE study_sessions SET state = 'completed' WHERE id = 'study-a'"
    );
    expect(
      (await getAttempt(client, learner, 'attempt-a')).evaluations
    ).toHaveLength(1);
    expect(await listEvaluations(client, learner, 'attempt-a')).toHaveLength(1);
  });

  it('keeps another learner out before and after completion', async () => {
    for (const state of ['active', 'completed']) {
      await client.execute({
        sql: 'UPDATE study_sessions SET state = ? WHERE id = ?',
        args: [state, 'study-a']
      });
      await expect(
        getAttempt(client, testSession('learner-b'), 'attempt-a')
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        listEvaluations(client, testSession('learner-b'), 'attempt-a')
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });
});
