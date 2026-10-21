import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import {
  saveStudySchedule,
  getStudySchedule,
  scheduleStudyReview
} from '../src/lib/server/flashcards';
import { setTimezone } from '../src/lib/server/preferences';
import { getSessionLesson } from '../src/lib/server/study-content';
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
  vi.restoreAllMocks();
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
  return rateGrammarAttempt(client, learner, {
    attemptId: attemptId,
    rating: rating,
    expectedSessionId: sessionId
  });
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

  async function reviewedSkill() {
    const session = await start();
    const incorrect = await answer(session.id, 'fr-a1-001@1:q1', 'es');
    const correct = await answer(session.id, 'fr-a1-001@1:q2', 'es');
    await rate(correct.id, session.id, 'easy');
    await finishPractice(client, learner, session.id);

    return { session, incorrect };
  }

  it('aggregates the lowest rating once and isolates the other learner', async () => {
    const { session, incorrect } = await reviewedSkill();
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
  });

  async function completeGrammarSettingsReview(reviewId: string) {
    const repeated = await answer(reviewId, 'fr-a1-001@1:q2', 'es');
    expect(
      (
        await client.execute({
          sql: 'SELECT evidence_kind, received_help FROM attempts WHERE id = ?',
          args: [repeated.id]
        })
      ).rows[0]
    ).toEqual({ evidence_kind: 'assisted', received_help: 0 });
    await rate(repeated.id, reviewId, 'good');
    await finishPractice(client, learner, reviewId);
    expect(
      (
        await client.execute({
          sql: 'SELECT rating FROM grammar_retention_events WHERE owner_id = ? AND study_session_id = ?',
          args: [learner.userId, reviewId]
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
    const summary = await practiceSummary(client, learner, reviewId);
    expect(summary.mode).toBe('mixed-review');
    expect(summary.answered).toBe(1);
    await finishPractice(client, learner, reviewId);
    expect(
      (await client.execute('SELECT * FROM grammar_retention_events')).rows
    ).toHaveLength(2);
  }

  it('keeps due dates stable until a review uses updated settings', async () => {
    await reviewedSkill();
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
    await completeGrammarSettingsReview(review.id);
  });

  it('resets the affected schedule on new content and preserves immutable events', async () => {
    await reviewedSkill();
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
      revision: 2,
      reset_required: 1
    });
    expect(
      (await client.execute('SELECT * FROM grammar_retention_events')).rows
    ).toHaveLength(1);
    await expect(
      client.execute("UPDATE grammar_retention_events SET rating = 'easy'")
    ).rejects.toThrow(/cannot be updated/iu);
  });

  async function dueReview() {
    const session = await start();
    await answer(session.id, 'fr-a1-001@1:q1', 'es');
    await finishPractice(client, learner, session.id);
    await client.execute('UPDATE grammar_retention_schedules SET due_at = 0');
    return startGrammarReview(client, learner, {
      language: 'fr',
      submissionKey: randomUUID(),
      skillIds: ['fr-a1-001']
    });
  }

  async function retireSkill() {
    await client.execute(
      "UPDATE skills SET retired_at = 1 WHERE id = 'fr-a1-001'"
    );
  }

  it('does not schedule a skill retired after a practice answer', async () => {
    const session = await start();
    await answer(session.id, 'fr-a1-001@1:q1', 'es');
    await retireSkill();
    await finishPractice(client, learner, session.id);
    expect(
      (await client.execute('SELECT * FROM grammar_retention_schedules')).rows
    ).toHaveLength(0);
    expect(
      (await client.execute('SELECT * FROM grammar_retention_events')).rows
    ).toHaveLength(0);
  });

  it('preserves historical reviews without updating a skill retired before completion', async () => {
    const review = await dueReview();
    const priorSchedules = (
      await client.execute('SELECT * FROM grammar_retention_schedules')
    ).rows;
    const priorEvents = (
      await client.execute('SELECT * FROM grammar_retention_events')
    ).rows;
    const recorded = await answer(review.id, 'fr-a1-001@1:q2', 'es');
    await rate(recorded.id, review.id, 'good');
    await retireSkill();
    await finishPractice(client, learner, review.id);
    expect(
      (await client.execute('SELECT * FROM grammar_retention_schedules')).rows
    ).toEqual(priorSchedules);
    expect(
      (await client.execute('SELECT * FROM grammar_retention_events')).rows
    ).toEqual(priorEvents);
  });

  it('refuses a frozen review plan containing a retired skill', async () => {
    const review = await dueReview();
    await retireSkill();
    await expect(
      grammarReviewPlan(client, learner, review.id)
    ).rejects.toMatchObject({ code: 'CONTENT_UNAVAILABLE' });
  });

  it('does not serve a retired frozen review question or lesson', async () => {
    const review = await dueReview();
    await retireSkill();
    expect(
      await exerciseFor(client, learner, review.id, 'fr-a1-001')
    ).toMatchObject({
      question: null,
      notice: 'This content is not available right now.'
    });
    await expect(
      getSessionLesson(client, learner, review.id, 'fr-a1-001')
    ).rejects.toMatchObject({ code: 'CONTENT_UNAVAILABLE' });
  });

  async function storedHistoryCounts() {
    const tables = [
      'attempts',
      'evaluations',
      'skill_evidence',
      'grammar_retention_schedules',
      'grammar_retention_events'
    ];
    const counts = await client.batch(
      tables.map((table) => `SELECT COUNT(*) AS count FROM ${table}`),
      'read'
    );
    return counts.map((result) => result.rows[0].count);
  }

  it.each(['practice', 'mixed-review'] as const)(
    'rejects a loaded %s form submitted after the skill retires',
    async (mode) => {
      const session = mode === 'practice' ? await start() : await dueReview();
      const loaded = await exerciseFor(
        client,
        learner,
        session.id,
        'fr-a1-001'
      );
      expect(loaded?.question).not.toBeNull();
      const before = await storedHistoryCounts();
      await retireSkill();
      await expect(
        answer(session.id, loaded!.question!.id, 'es')
      ).rejects.toMatchObject({ code: 'CONTENT_UNAVAILABLE' });
      expect(await storedHistoryCounts()).toEqual(before);
    }
  );

  const schedulesOf = async () =>
    (
      await client.execute({
        sql: 'SELECT content_version_id, state_json, due_at, revision, reset_required FROM grammar_retention_schedules WHERE owner_id = ? AND skill_id = ?',
        args: [learner.userId, 'fr-a1-001']
      })
    ).rows[0];

  it.each(['insert', 'publish'] as const)(
    'keeps recall state and due date when a wording-only version is published by %s',
    async (operation) => {
      await reviewedSkill();
      const before = await schedulesOf();
      expect(Number(before.due_at)).toBeGreaterThan(0);
      await client.execute({
        sql: "INSERT INTO content_versions (id, skill_id, language, version, status, retention_reset) VALUES ('fr-a1-001@2', 'fr-a1-001', 'fr', 2, ?, 0)",
        args: [operation === 'insert' ? 'pilot-ready' : 'draft']
      });
      if (operation === 'publish')
        await client.execute(
          "UPDATE content_versions SET status = 'schema-validated' WHERE id = 'fr-a1-001@2'"
        );
      expect(await schedulesOf()).toEqual({
        ...before,
        content_version_id: 'fr-a1-001@2',
        revision: Number(before.revision) + 1
      });
    }
  );

  it('does not move a schedule to a wording-only version that is not the newest', async () => {
    await reviewedSkill();
    await client.execute(
      "INSERT INTO content_versions (id, skill_id, language, version, status) VALUES ('fr-a1-001@3', 'fr-a1-001', 'fr', 3, 'pilot-ready')"
    );
    const before = await schedulesOf();
    await client.execute(
      "INSERT INTO content_versions (id, skill_id, language, version, status, retention_reset) VALUES ('fr-a1-001@2', 'fr-a1-001', 'fr', 2, 'pilot-ready', 0)"
    );
    expect(await schedulesOf()).toEqual(before);
  });

  it('does not move a schedule when a wording-only version older than the newest is approved', async () => {
    await reviewedSkill();
    await client.execute(
      "INSERT INTO content_versions (id, skill_id, language, version, status) VALUES ('fr-a1-001@3', 'fr-a1-001', 'fr', 3, 'pilot-ready')"
    );
    await client.execute(
      "INSERT INTO content_versions (id, skill_id, language, version, status, retention_reset) VALUES ('fr-a1-001@2', 'fr-a1-001', 'fr', 2, 'draft', 0)"
    );
    const before = await schedulesOf();
    await client.execute(
      "UPDATE content_versions SET status = 'schema-validated' WHERE id = 'fr-a1-001@2'"
    );
    expect(await schedulesOf()).toEqual(before);
  });

  it('keeps a pending reset when a wording-only version follows the version that caused it', async () => {
    await reviewedSkill();
    await client.execute(
      "INSERT INTO content_versions (id, skill_id, language, version, status) VALUES ('fr-a1-001@2', 'fr-a1-001', 'fr', 2, 'pilot-ready')"
    );
    await client.execute(
      "INSERT INTO content_versions (id, skill_id, language, version, status, retention_reset) VALUES ('fr-a1-001@3', 'fr-a1-001', 'fr', 3, 'pilot-ready', 0)"
    );
    expect(await schedulesOf()).toMatchObject({
      content_version_id: 'fr-a1-001@3',
      due_at: 0,
      reset_required: 1
    });
  });

  it('keeps the frozen question and lesson after publication before the first answer', async () => {
    const review = await dueReview();
    await client.batch(
      [
        "INSERT INTO content_versions (id, skill_id, language, version, status) VALUES ('fr-a1-001@2', 'fr-a1-001', 'fr', 2, 'pilot-ready')",
        "INSERT INTO questions (id, content_version_id, skill_id, language, format, prompt, answer, alternatives, holdout) SELECT replace(id, '@1', '@2'), 'fr-a1-001@2', skill_id, language, format, prompt, answer, alternatives, holdout FROM questions WHERE content_version_id = 'fr-a1-001@1'",
        "INSERT INTO lessons (content_version_id, skill_id, language, title, explanation, examples, refs, fingerprint) SELECT 'fr-a1-001@2', skill_id, language, 'New lesson', explanation, examples, refs, fingerprint FROM lessons WHERE content_version_id = 'fr-a1-001@1'"
      ],
      'write'
    );
    expect(
      await exerciseFor(client, learner, review.id, 'fr-a1-001')
    ).toMatchObject({ question: { id: 'fr-a1-001@1:q2' } });
    expect(
      await getSessionLesson(client, learner, review.id, 'fr-a1-001')
    ).toMatchObject({
      contentVersionId: 'fr-a1-001@1',
      newerVersionAvailable: true
    });
    const recorded = await answer(review.id, 'fr-a1-001@1:q2', 'es');
    await rate(recorded.id, review.id, 'good');
    await finishPractice(client, learner, review.id);
    expect(await practiceSummary(client, learner, review.id)).toMatchObject({
      state: 'completed',
      answered: 1
    });
    expect(
      (
        await client.execute(
          'SELECT * FROM grammar_retention_events WHERE study_session_id = ?',
          [review.id]
        )
      ).rows
    ).toHaveLength(0);
  });

  it('never serves a quarantined frozen review version', async () => {
    const review = await dueReview();
    await client.execute(
      "UPDATE content_versions SET status = 'quarantined' WHERE id = 'fr-a1-001@1'"
    );
    expect(
      await exerciseFor(client, learner, review.id, 'fr-a1-001')
    ).toMatchObject({
      question: null,
      notice: 'This content is not available right now.'
    });
    await expect(
      getSessionLesson(client, learner, review.id, 'fr-a1-001')
    ).rejects.toMatchObject({ code: 'CONTENT_UNAVAILABLE' });
  });

  it.each(['insert', 'publish'] as const)(
    'does not reset current schedules when an older version is approved by %s',
    async (operation) => {
      const session = await start();
      await answer(session.id, 'fr-a1-001@1:q1', 'es');
      await finishPractice(client, learner, session.id);
      await client.execute(
        "INSERT INTO content_versions (id, skill_id, language, version, status) VALUES ('fr-a1-001@3', 'fr-a1-001', 'fr', 3, 'pilot-ready')"
      );
      const before = (
        await client.execute('SELECT * FROM grammar_retention_schedules')
      ).rows;
      await client.execute({
        sql: "INSERT INTO content_versions (id, skill_id, language, version, status) VALUES ('fr-a1-001@2', 'fr-a1-001', 'fr', 2, ?)",
        args: [operation === 'insert' ? 'pilot-ready' : 'draft']
      });
      if (operation === 'publish')
        await client.execute(
          "UPDATE content_versions SET status = 'schema-validated' WHERE id = 'fr-a1-001@2'"
        );
      expect(
        (await client.execute('SELECT * FROM grammar_retention_schedules')).rows
      ).toEqual(before);
    }
  );

  it('serializes duplicate ratings and refuses conflicting concurrent ratings', async () => {
    const session = await start();
    const recorded = await answer(session.id, 'fr-a1-001@1:q2', 'es');
    const conflicts = await Promise.allSettled([
      rate(recorded.id, session.id, 'good'),
      rate(recorded.id, session.id, 'easy')
    ]);
    expect(conflicts[0]).toMatchObject({
      status: 'fulfilled',
      value: { duplicate: false }
    });
    expect(conflicts[1]).toMatchObject({
      status: 'rejected',
      reason: { code: 'STALE_GRAMMAR_RATING' }
    });
    const duplicates = await Promise.all([
      rate(recorded.id, session.id, 'good'),
      rate(recorded.id, session.id, 'good')
    ]);
    expect(duplicates.map((result) => result.duplicate)).toEqual([true, true]);
    await Promise.all([
      finishPractice(client, learner, session.id),
      finishPractice(client, learner, session.id)
    ]);
    expect(
      (await client.execute('SELECT * FROM grammar_retention_events')).rows
    ).toHaveLength(1);
    expect(
      (await client.execute('SELECT revision FROM grammar_retention_schedules'))
        .rows[0].revision
    ).toBe(1);
  });

  it('rejects foreign ratings and completion without changing either learner', async () => {
    const session = await start();
    const recorded = await answer(session.id, 'fr-a1-001@1:q2', 'es');
    await expect(
      rateGrammarAttempt(client, other, {
        attemptId: recorded.id,
        rating: 'good',
        expectedSessionId: session.id
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      finishPractice(client, other, session.id)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      (
        await client.execute(
          'SELECT grammar_rating FROM attempts WHERE id = ?',
          [recorded.id]
        )
      ).rows[0].grammar_rating
    ).toBeNull();
    expect(
      (await client.execute('SELECT * FROM grammar_retention_events')).rows
    ).toHaveLength(0);
  });

  it('rolls back unrated cleanup, completion and schedules when event persistence fails', async () => {
    const session = await start();
    const rated = await answer(session.id, 'fr-a1-001@1:q2', 'es');
    await rate(rated.id, session.id, 'good');
    const unrated = await answer(session.id, 'fr-a1-001@1:q1', 'suis');
    await client.execute(
      "CREATE TRIGGER reject_review BEFORE INSERT ON grammar_retention_events BEGIN SELECT RAISE(ABORT, 'synthetic retention failure'); END"
    );
    await expect(finishPractice(client, learner, session.id)).rejects.toThrow(
      /synthetic retention failure/
    );
    expect(
      (
        await client.execute('SELECT id FROM attempts WHERE id = ?', [
          unrated.id
        ])
      ).rows
    ).toHaveLength(1);
    expect(
      (
        await client.execute('SELECT state FROM study_sessions WHERE id = ?', [
          session.id
        ])
      ).rows[0].state
    ).toBe('active');
    expect(
      (await client.execute('SELECT * FROM grammar_retention_schedules')).rows
    ).toHaveLength(0);
    await client.execute('DROP TRIGGER reject_review');
    await finishPractice(client, learner, session.id);
    expect(
      (
        await client.execute('SELECT id FROM attempts WHERE id = ?', [
          unrated.id
        ])
      ).rows
    ).toHaveLength(0);
    expect(
      (await client.execute('SELECT * FROM grammar_retention_events')).rows
    ).toHaveLength(1);
  });

  it.each(['2026-03-07T16:00:00Z', '2026-10-31T16:00:00Z'])(
    'uses the saved timezone across DST at %s',
    async (instant) => {
      const now = new Date(instant);
      vi.spyOn(Date, 'now').mockReturnValue(now.getTime());
      await setTimezone(client, learner, 'America/New_York');
      const session = await start();
      const recorded = await answer(session.id, 'fr-a1-001@1:q2', 'es');
      await rate(recorded.id, session.id, 'easy');
      await finishPractice(client, learner, session.id);
      const expected = scheduleStudyReview({
        id: `${learner.userId}:fr:fr-a1-001`,
        rating: 'easy',
        schedule: await getStudySchedule(client, learner),
        stateJson: null,
        schedulerVersion: null,
        parametersJson: null,
        resetRequired: true,
        expectedRevision: 0,
        now,
        timezone: 'America/New_York'
      });
      expect(
        (await client.execute('SELECT due_at FROM grammar_retention_schedules'))
          .rows[0].due_at
      ).toBe(expected.dueAt);
      expect(
        (
          await client.execute(
            'SELECT reviewed_at FROM grammar_retention_events'
          )
        ).rows[0].reviewed_at
      ).toBe(now.getTime());
      expect(
        new Intl.DateTimeFormat('en', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          hourCycle: 'h23'
        }).format(new Date(expected.dueAt))
      ).toBe('04');
    }
  );

  it.each([
    [[], 'INVALID_REVIEW_SELECTION'],
    [['fr-a1-001', 'fr-a1-001'], 'INVALID_REVIEW_SELECTION'],
    [[null], 'INVALID_REVIEW_SELECTION'],
    [[42], 'INVALID_REVIEW_SELECTION'],
    [['not-due'], 'STALE_GRAMMAR_REVIEW']
  ] as [unknown[], string][])(
    'rejects invalid or stale review selections %j without starting a session',
    async (skillIds, code) => {
      await expect(
        startGrammarReview(client, learner, {
          language: 'fr',
          submissionKey: randomUUID(),
          skillIds
        })
      ).rejects.toMatchObject({ code });
      expect(
        (
          await client.execute(
            "SELECT id FROM study_sessions WHERE mode = 'mixed-review'"
          )
        ).rows
      ).toHaveLength(0);
    }
  );

  it('replays a frozen review only for the same owner, track and selected skills', async () => {
    const review = await dueReview();
    const submissionKey = review.id.slice('grammar-review:'.length);
    const input = { language: 'fr', submissionKey, skillIds: ['fr-a1-001'] };
    expect(await startGrammarReview(client, learner, input)).toEqual(review);
    await expect(
      startGrammarReview(client, other, input)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      startGrammarReview(client, learner, { ...input, language: 'de' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      startGrammarReview(client, learner, { ...input, skillIds: ['fr-a1-002'] })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      grammarReviewPlan(client, other, review.id)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
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
