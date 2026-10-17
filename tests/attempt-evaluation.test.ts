import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { importContent } from '../src/lib/server/content-import';
import { recordAttempt } from '../src/lib/server/study';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { approvedPackage } from './fixtures/content-package';

// Synthetic principal; these prove repository behavior, not a real session.
const ownerA = testSession('learner-a');

let client: Client;
let close: (() => void) | undefined;

beforeEach(async () => {
  ({ client, close } = await openFixtureDatabase(await fixture()));
  await importContent(client, approvedPackage());
});

afterEach(async () => {
  close?.();
  close = undefined;
  await disposeFlashcardFixtures();
});

const attempt = (key: string, questionId: string, answer: string) =>
  recordAttempt(client, ownerA, {
    studySessionId: 'study-a',
    questionId,
    submissionKey: key,
    evidenceKind: 'independent',
    answer
  });

const evaluationsOf = async (attemptId: string) =>
  (
    await client.execute({
      sql: 'SELECT owner_id, evaluator_version, rubric_version, outcome FROM evaluations WHERE attempt_id = ?',
      args: [attemptId]
    })
  ).rows.map((row) => ({ ...row }));

const evaluationCount = async () =>
  Number(
    (await client.execute('SELECT COUNT(*) AS n FROM evaluations')).rows[0]?.n
  );

describe('prepared evaluation of a recorded attempt', () => {
  it.each([
    ['fr-a1-001@1:q1', 'suis', 'correct', 'fr-a1-001@1'],
    ['fr-a1-001@1:q1', 'es', 'incorrect', 'fr-a1-001@1'],
    ['fr-a1-002@1:q1', 'on est ici !', 'correct', 'fr-a1-002@1'],
    ['fr-a1-002@1:q1', 'Nous somme ici.', 'uncertain', 'fr-a1-002@1']
  ])(
    'records %s answered %j as %s',
    async (questionId, answer, outcome, rubric) => {
      const recorded = await attempt('key-1', questionId, answer);
      expect(await evaluationsOf(recorded.id)).toEqual([
        {
          owner_id: 'learner-a',
          evaluator_version: 'prepared-1',
          rubric_version: rubric,
          outcome
        }
      ]);
    }
  );

  it('writes nothing more for a replayed submission', async () => {
    const first = await attempt('key-1', 'fr-a1-001@1:q1', 'suis');
    const replay = await attempt('key-1', 'fr-a1-001@1:q1', 'suis');
    expect(replay).toEqual({ id: first.id, duplicate: true });
    expect(await evaluationsOf(first.id)).toHaveLength(1);
  });

  it('writes no evaluation when the attempt is refused', async () => {
    const before = await evaluationCount();
    // study-b belongs to another learner.
    await expect(
      recordAttempt(client, ownerA, {
        studySessionId: 'study-b',
        questionId: 'fr-a1-001@1:q1',
        submissionKey: 'key-1',
        evidenceKind: 'independent',
        answer: 'suis'
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await evaluationCount()).toBe(before);
  });
});

describe('prepared evaluation failures', () => {
  const attemptCount = async () =>
    Number(
      (await client.execute('SELECT COUNT(*) AS n FROM attempts')).rows[0]?.n
    );

  it('rolls the attempt back when the evaluation cannot be written', async () => {
    await client.execute(
      "CREATE TRIGGER fail_evaluations BEFORE INSERT ON evaluations BEGIN SELECT RAISE(ABORT, 'synthetic evaluation failure'); END"
    );
    const before = await attemptCount();
    await expect(attempt('key-1', 'fr-a1-001@1:q1', 'suis')).rejects.toThrow(
      'synthetic evaluation failure'
    );
    expect(await attemptCount()).toBe(before);
  });

  it.each([
    ['not JSON', 'not json'],
    ['a JSON string', '"suis"'],
    ['an array with a non-string', '["suis", 3]']
  ])(
    'refuses stored alternatives that are %s, saving nothing',
    async (_, stored) => {
      await client.execute({
        sql: 'UPDATE questions SET alternatives = ? WHERE id = ?',
        args: [stored, 'fr-a1-002@1:q1']
      });
      const before = await attemptCount();
      await expect(attempt('key-1', 'fr-a1-002@1:q1', 's')).rejects.toThrow(
        'Question fr-a1-002@1:q1 has invalid alternatives'
      );
      expect(await attemptCount()).toBe(before);
    }
  );

  it('refuses a stored format outside the known set', async () => {
    // Bypass the table CHECK to simulate corrupted data.
    await client.execute('PRAGMA ignore_check_constraints = ON');
    await client.execute(
      "UPDATE questions SET format = 'essay' WHERE id = 'fr-a1-002@1:q1'"
    );
    await client.execute('PRAGMA ignore_check_constraints = OFF');
    await expect(attempt('key-1', 'fr-a1-002@1:q1', 'x')).rejects.toThrow(
      'Question fr-a1-002@1:q1 has invalid format'
    );
  });
});

describe('evaluation ownership', () => {
  it('writes each learner their own evaluation', async () => {
    const ownerB = testSession('learner-b');
    const a = await attempt('key-1', 'fr-a1-001@1:q1', 'suis');
    const b = await recordAttempt(client, ownerB, {
      studySessionId: 'study-b',
      questionId: 'fr-a1-001@1:q1',
      submissionKey: 'key-1',
      evidenceKind: 'independent',
      answer: 'es'
    });
    expect(
      (await evaluationsOf(a.id)).map((r) => [r.owner_id, r.outcome])
    ).toEqual([['learner-a', 'correct']]);
    expect(
      (await evaluationsOf(b.id)).map((r) => [r.owner_id, r.outcome])
    ).toEqual([['learner-b', 'incorrect']]);
  });
});
