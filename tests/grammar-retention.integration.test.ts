import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { importContent } from '../src/lib/server/content-import';
import {
  dueGrammarReviews,
  grammarRetentionFor
} from '../src/lib/server/grammar-retention';
import {
  finishPractice,
  grammarReviewPlan,
  practiceSummary,
  startGrammarReview,
  startPractice
} from '../src/lib/server/practice';
import { recordAttempt, rateGrammarAttempt } from '../src/lib/server/study';
import { saveStudySchedule } from '../src/lib/server/flashcards';
import { loadProgress } from '../src/lib/server/progress';
import { exerciseFor } from '../src/lib/server/lesson-practice';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { approvedPackage } from './fixtures/content-package';

const learner = testSession('learner-a');
const other = testSession('learner-b');
let client: Client;
let close: () => void;

beforeEach(async () => {
  ({ client, close } = await openFixtureDatabase(await fixture()));
  const content = approvedPackage();
  for (const version of content.versions) {
    version.lesson = {
      title: `Synthetic ${version.skillId}`,
      explanation: 'Synthetic lesson',
      examples: [],
      references: []
    };
  }
  await importContent(client, content);
});

afterEach(async () => {
  close?.();
  await disposeFlashcardFixtures();
});

async function start() {
  return startPractice(client, learner, {
    language: 'fr',
    submissionKey: randomUUID()
  });
}

async function answer(sessionId: string, questionId: string, value: string) {
  return recordAttempt(client, learner, {
    studySessionId: sessionId,
    questionId,
    submissionKey: randomUUID(),
    evidenceKind: 'independent',
    answer: value
  });
}

async function rate(
  attemptId: string,
  sessionId: string,
  rating: 'hard' | 'good' | 'easy'
) {
  return rateGrammarAttempt(client, learner, attemptId, rating, sessionId);
}

describe('grammar retention storage and session flow', () => {
  it('keeps untagged existing sessions moving without a grammar rating', async () => {
    const session = await start();
    await client.execute({
      sql: 'UPDATE study_sessions SET grammar_retention_policy_version = NULL WHERE id = ? AND owner_id = ?',
      args: [session.id, learner.userId]
    });
    await answer(session.id, 'fr-a1-001@1:q2', 'es');

    expect(
      await exerciseFor(client, learner, session.id, 'fr-a1-001')
    ).toMatchObject({
      notice: null,
      question: { id: 'fr-a1-001@1:q1' }
    });
  });

  it('drops a correct practice answer that is never rated', async () => {
    const session = await start();
    const answerRow = await answer(session.id, 'fr-a1-001@1:q2', 'es');
    expect(
      (await client.execute('SELECT * FROM skill_evidence')).rows
    ).toHaveLength(0);
    await finishPractice(client, learner, session.id);
    expect(
      (
        await client.execute('SELECT id FROM attempts WHERE id = ?', [
          answerRow.id
        ])
      ).rows
    ).toHaveLength(0);
    expect(
      (await client.execute('SELECT * FROM grammar_retention_schedules')).rows
    ).toHaveLength(0);
  });

  it('treats an abandoned unrated correct answer as unseen for later evidence', async () => {
    const abandoned = await start();
    await answer(abandoned.id, 'fr-a1-001@1:q2', 'es');

    const resumed = await start();
    const repeated = await answer(resumed.id, 'fr-a1-001@1:q2', 'es');
    expect(
      (
        await client.execute({
          sql: 'SELECT evidence_kind FROM attempts WHERE id = ?',
          args: [repeated.id]
        })
      ).rows
    ).toEqual([{ evidence_kind: 'independent' }]);
    await rate(repeated.id, resumed.id, 'good');
    await finishPractice(client, learner, resumed.id);

    const skill = (
      await loadProgress(client, learner, 'fr')
    ).tracks[0]?.skills.find((item) => item.skillId === 'fr-a1-001');
    expect(skill).toMatchObject({
      status: 'practising',
      correct: 1,
      independentItems: 1
    });
  });

  it('keeps repeated FSRS reviews out of distinct-item mastery evidence', async () => {
    for (const rating of ['good', 'easy'] as const) {
      const session = await start();
      const repeated = await answer(session.id, 'fr-a1-001@1:q2', 'es');
      await rate(repeated.id, session.id, rating);
      await finishPractice(client, learner, session.id);
    }

    expect(
      (
        await client.execute({
          sql: 'SELECT rating FROM grammar_retention_events WHERE owner_id = ? AND skill_id = ? ORDER BY rating',
          args: [learner.userId, 'fr-a1-001']
        })
      ).rows
    ).toEqual([{ rating: 'easy' }, { rating: 'good' }]);

    const progress = await loadProgress(client, learner, 'fr');
    const skill = progress.tracks[0]?.skills.find(
      (item) => item.skillId === 'fr-a1-001'
    );
    expect(skill).toMatchObject({
      status: 'practising',
      correct: 1,
      incorrect: 0,
      sessions: 1,
      independentItems: 1
    });
    expect(skill?.retention.state).not.toBe('not-assessed');
  });

  it('aggregates one lowest rating per skill, queues a bounded review, and preserves history on content reset', async () => {
    const session = await start();
    const incorrect = await answer(session.id, 'fr-a1-001@1:q1', 'es');
    const correct = await answer(session.id, 'fr-a1-001@1:q2', 'es');
    await rate(correct.id, session.id, 'easy');
    await finishPractice(client, learner, session.id);

    const firstEvent = await client.execute({
      sql: 'SELECT attempt_id, rating, expected_revision FROM grammar_retention_events WHERE owner_id = ? AND study_session_id = ?',
      args: [learner.userId, session.id]
    });
    expect(firstEvent.rows).toEqual([
      { attempt_id: incorrect.id, rating: 'again', expected_revision: 0 }
    ]);
    expect(await grammarRetentionFor(client, other, 'fr')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillId: 'fr-a1-001',
          retention: expect.objectContaining({ state: 'not-assessed' })
        })
      ])
    );
    expect(await dueGrammarReviews(client, other, 'fr')).toEqual([]);

    const dueBeforeSettingsChange = Number(
      (
        await client.execute({
          sql: 'SELECT due_at FROM grammar_retention_schedules WHERE owner_id = ? AND skill_id = ?',
          args: [learner.userId, 'fr-a1-001']
        })
      ).rows[0].due_at
    );
    await saveStudySchedule(client, learner, {
      desiredRetention: 95,
      newCardPreset: '30m',
      relearningPreset: '1h'
    });
    expect(
      Number(
        (
          await client.execute({
            sql: 'SELECT due_at FROM grammar_retention_schedules WHERE owner_id = ? AND skill_id = ?',
            args: [learner.userId, 'fr-a1-001']
          })
        ).rows[0].due_at
      )
    ).toBe(dueBeforeSettingsChange);

    await client.execute({
      sql: "UPDATE grammar_retention_schedules SET due_at = 0 WHERE owner_id = ? AND skill_id = 'fr-a1-001'",
      args: [learner.userId]
    });
    const due = await dueGrammarReviews(client, learner, 'fr');
    expect(due.map((item) => item.skillId)).toContain('fr-a1-001');
    const overdueRetention = await grammarRetentionFor(
      client,
      learner,
      'fr',
      1
    );
    expect(
      overdueRetention.find((item) => item.skillId === 'fr-a1-001')?.retention
        .state
    ).toBe('overdue');
    const dueAt = Number(
      (
        await client.execute({
          sql: 'SELECT due_at FROM grammar_retention_schedules WHERE owner_id = ? AND skill_id = ?',
          args: [learner.userId, 'fr-a1-001']
        })
      ).rows[0].due_at
    );
    expect(
      (await grammarRetentionFor(client, learner, 'fr', dueAt)).find(
        (item) => item.skillId === 'fr-a1-001'
      )?.retention.state
    ).toBe('due');

    const review = await startGrammarReview(client, learner, {
      language: 'fr',
      submissionKey: randomUUID(),
      skillIds: ['fr-a1-001']
    });
    expect(await grammarReviewPlan(client, learner, review.id)).toEqual([
      { skillId: 'fr-a1-001', title: 'Synthetic fr-a1-001', answered: false }
    ]);
    expect(
      await exerciseFor(client, learner, review.id, 'fr-a1-001')
    ).toMatchObject({
      question: { id: 'fr-a1-001@1:q2' }
    });
    const repeated = await answer(review.id, 'fr-a1-001@1:q2', 'es');
    expect(
      (
        await client.execute({
          sql: 'SELECT evidence_kind, received_help FROM attempts WHERE id = ?',
          args: [repeated.id]
        })
      ).rows[0]
    ).toEqual({ evidence_kind: 'assisted', received_help: 0 });
    await rate(repeated.id, review.id, 'good');
    await finishPractice(client, learner, review.id);
    expect(
      (
        await client.execute({
          sql: 'SELECT rating FROM grammar_retention_events WHERE owner_id = ? AND study_session_id = ?',
          args: [learner.userId, review.id]
        })
      ).rows
    ).toEqual([{ rating: 'good' }]);
    const updatedParameters = JSON.parse(
      String(
        (
          await client.execute({
            sql: 'SELECT parameters_json FROM grammar_retention_schedules WHERE owner_id = ? AND skill_id = ?',
            args: [learner.userId, 'fr-a1-001']
          })
        ).rows[0].parameters_json
      )
    );
    expect(updatedParameters).toMatchObject({
      request_retention: 0.95,
      learning_steps: ['30m'],
      relearning_steps: ['1h']
    });
    const summary = await practiceSummary(client, learner, review.id);
    expect(summary.mode).toBe('mixed-review');
    expect(summary.answered).toBe(1);
    await finishPractice(client, learner, review.id);
    expect(
      (await client.execute('SELECT * FROM grammar_retention_events')).rows
    ).toHaveLength(2);

    await client.execute({
      sql: "INSERT INTO content_versions (id, skill_id, language, version, status) VALUES ('fr-a1-001@2', 'fr-a1-001', 'fr', 2, 'pilot-ready')"
    });
    const reset = await client.execute({
      sql: 'SELECT content_version_id, due_at, revision, reset_required FROM grammar_retention_schedules WHERE owner_id = ? AND skill_id = ?',
      args: [learner.userId, 'fr-a1-001']
    });
    expect(reset.rows[0]).toMatchObject({
      content_version_id: 'fr-a1-001@2',
      due_at: 0,
      revision: 3,
      reset_required: 1
    });
    expect(
      (await client.execute('SELECT * FROM grammar_retention_events')).rows
    ).toHaveLength(2);
    await expect(
      client.execute("UPDATE grammar_retention_events SET rating = 'easy'")
    ).rejects.toThrow(/cannot be updated/iu);
  });

  it('rejects review selections larger than five before touching session state', async () => {
    await expect(
      startGrammarReview(client, learner, {
        language: 'fr',
        submissionKey: randomUUID(),
        skillIds: ['a', 'b', 'c', 'd', 'e', 'f']
      })
    ).rejects.toMatchObject({ code: 'INVALID_REVIEW_SELECTION' });
    expect(
      (
        await client.execute(
          "SELECT * FROM study_sessions WHERE mode = 'mixed-review'"
        )
      ).rows
    ).toHaveLength(0);
  });

  it('allows the existing owner-deletion cascade to remove schedules and events', async () => {
    const session = await start();
    await answer(session.id, 'fr-a1-001@1:q1', 'es');
    await finishPractice(client, learner, session.id);
    expect(
      (await client.execute('SELECT * FROM grammar_retention_events')).rows
    ).toHaveLength(1);
    await client.execute({
      sql: 'DELETE FROM users WHERE id = ?',
      args: [learner.userId]
    });
    expect(
      (await client.execute('SELECT * FROM grammar_retention_schedules')).rows
    ).toHaveLength(0);
    expect(
      (await client.execute('SELECT * FROM grammar_retention_events')).rows
    ).toHaveLength(0);
  });
});
