import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client, InStatement } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { importContent } from '../src/lib/server/content-import';
import {
  getLesson,
  getStudySession,
  nextQuestion,
  pauseStudySession,
  recordAttempt,
  resumeStudySession
} from '../src/lib/server/study';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { approvedPackage } from './fixtures/content-package';

// Synthetic principals; these prove repository behavior, not a real session.
const ownerA = testSession('learner-a');
const ownerB = testSession('learner-b');

const lesson = {
  title: 'Être',
  explanation: 'Use être to say who you are.',
  examples: [{ fr: 'Je suis étudiant.', en: 'I am a student.' }],
  references: ['https://example.test/etre']
};

let client: Client;
let close: (() => void) | undefined;

beforeEach(async () => {
  ({ client, close } = await openFixtureDatabase(await fixture()));
  const pkg = approvedPackage();
  Object.assign(pkg.versions[0], { lesson });
  // q2 of fr-a1-001 is an assessment holdout.
  Object.assign(pkg.versions[0].questions[1], { holdout: true });
  await importContent(client, pkg);
});

afterEach(async () => {
  close?.();
  close = undefined;
  await disposeFlashcardFixtures();
});

const attempt = (key: string, questionId: string, studySessionId = 'study-a') =>
  recordAttempt(client, ownerA, {
    studySessionId,
    questionId,
    submissionKey: key,
    evidenceKind: 'independent',
    answer: 'suis'
  });

describe('one independent answer per question', () => {
  it('lets only one of two tabs answer the same question', async () => {
    const settled = await Promise.allSettled([
      attempt('tab-1', 'fr-a1-001@1:q1'),
      attempt('tab-2', 'fr-a1-001@1:q1')
    ]);
    expect(settled.map((result) => result.status).sort()).toEqual([
      'fulfilled',
      'rejected'
    ]);
    const lost = settled.find((result) => result.status === 'rejected');
    expect((lost as PromiseRejectedResult).reason.message).toBe(
      'QUESTION_ALREADY_ANSWERED'
    );
    const stored = await client.execute(
      "SELECT count(*) AS n FROM attempts WHERE study_session_id = 'study-a' AND question_id = 'fr-a1-001@1:q1' AND evidence_kind = 'independent'"
    );
    expect(stored.rows[0].n).toBe(1);
  });

  it('still replays the same submission key and records an assisted retry', async () => {
    const first = await attempt('k-once', 'fr-a1-001@1:q1');
    expect(await attempt('k-once', 'fr-a1-001@1:q1')).toEqual({
      id: first.id,
      duplicate: true
    });
    await expect(
      recordAttempt(client, ownerA, {
        studySessionId: 'study-a',
        questionId: 'fr-a1-001@1:q1',
        submissionKey: 'k-retry',
        evidenceKind: 'assisted',
        answer: 'suis'
      })
    ).resolves.toMatchObject({ duplicate: false });
  });

  it('is enforced by the database for writes that bypass the service', async () => {
    await attempt('k-db', 'fr-a1-001@1:q1');
    await expect(
      client.execute(
        "INSERT INTO attempts (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer) VALUES ('dup', 'learner-a', 'study-a', 'fr-a1-001@1:q1', 'fr-a1-001@1', 'fr-a1-001', 'fr', 'k-dup', 'independent', 'suis')"
      )
    ).rejects.toThrow(/UNIQUE/i);
  });
});

describe('pause and resume', () => {
  it('pauses with the supplied time and resumes a paused session with no expiry', async () => {
    const pausedAt = 1_800_000_000_000;
    await pauseStudySession(client, ownerA, 'study-a', pausedAt);
    expect(await getStudySession(client, ownerA, 'study-a')).toMatchObject({
      state: 'paused',
      pausedAt
    });
    await expect(attempt('k-paused', 'fr-a1-001@1:q1')).rejects.toThrow(
      'SESSION_NOT_ACTIVE'
    );
    await resumeStudySession(client, ownerA, 'study-a');
    expect(await getStudySession(client, ownerA, 'study-a')).toMatchObject({
      state: 'active',
      pausedAt: null
    });
    await expect(attempt('k-resumed', 'fr-a1-001@1:q1')).resolves.toMatchObject(
      { duplicate: false }
    );
  });

  it('reports a session that completed during the write as not active', async () => {
    await expect(
      pauseStudySession(completedBeforeUpdate(), ownerA, 'study-a')
    ).rejects.toThrow('SESSION_NOT_ACTIVE');
    await expect(
      resumeStudySession(completedBeforeUpdate(), ownerA, 'study-a')
    ).rejects.toThrow('SESSION_NOT_ACTIVE');
  });

  it('pausing twice keeps the first pause time', async () => {
    await pauseStudySession(client, ownerA, 'study-a', 1000);
    await pauseStudySession(client, ownerA, 'study-a', 2000);
    expect(await getStudySession(client, ownerA, 'study-a')).toMatchObject({
      pausedAt: 1000
    });
  });

  it('a completed session can be neither paused nor resumed', async () => {
    await client.execute(
      "UPDATE study_sessions SET state = 'completed' WHERE id = 'study-a'"
    );
    await expect(pauseStudySession(client, ownerA, 'study-a')).rejects.toThrow(
      'SESSION_NOT_ACTIVE'
    );
    await expect(resumeStudySession(client, ownerA, 'study-a')).rejects.toThrow(
      'SESSION_NOT_ACTIVE'
    );
  });

  it("another learner's session is not found and unchanged", async () => {
    await expect(pauseStudySession(client, ownerB, 'study-a')).rejects.toThrow(
      'NOT_FOUND'
    );
    await expect(resumeStudySession(client, ownerB, 'study-a')).rejects.toThrow(
      'NOT_FOUND'
    );
    expect(await getStudySession(client, ownerA, 'study-a')).toMatchObject({
      state: 'active',
      pausedAt: null
    });
  });
});

/**
 * A client that first runs `sql` when the first statement matching `pattern`
 * is about to execute, as when another request commits between two reads or
 * between a lookup and its write.
 */
function afterOtherCommit(pattern: RegExp, sql: string): Client {
  let committed = false;
  return new Proxy(client, {
    get(target, property) {
      if (property !== 'execute') {
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (statement: InStatement) => {
        const text = typeof statement === 'string' ? statement : statement.sql;
        if (!committed && pattern.test(text)) {
          committed = true;
          await target.execute(sql);
        }
        return target.execute(statement);
      };
    }
  });
}

const completedBeforeUpdate = () =>
  afterOtherCommit(
    /^\s*UPDATE study_sessions\b/i,
    "UPDATE study_sessions SET state = 'completed' WHERE id = 'study-a'"
  );

// Content is withdrawn just before its question or lesson payload is read.
const quarantinedBeforePayloadRead = () =>
  afterOtherCommit(
    /\b(FROM|JOIN)\s+(questions|lessons)\b/i,
    "UPDATE content_versions SET status = 'quarantined' WHERE id = 'fr-a1-001@1'"
  );

describe('next question', () => {
  it('returns the same item after a reload and never the answer', async () => {
    const first = await nextQuestion(client, ownerA, 'study-a', 'fr-a1-001');
    expect(first).toEqual({
      question: {
        id: 'fr-a1-001@1:q1',
        format: 'multiple-choice',
        prompt: 'Je ___ étudiant.',
        alternatives: ['suis', 'es', 'est']
      },
      answered: 0,
      total: 1
    });
    expect(await nextQuestion(client, ownerA, 'study-a', 'fr-a1-001')).toEqual(
      first
    );
  });

  it('moves on only after a confirmed attempt, and a replay does not double count', async () => {
    const one = await attempt('k1', 'fr-a1-001@1:q1');
    const replay = await attempt('k1', 'fr-a1-001@1:q1');
    expect(replay).toEqual({ id: one.id, duplicate: true });
    expect(await nextQuestion(client, ownerA, 'study-a', 'fr-a1-001')).toEqual({
      question: null,
      answered: 1,
      total: 1
    });
  });

  it('keeps holdouts out of practice but serves them in assessment', async () => {
    const practice = await nextQuestion(client, ownerA, 'study-a', 'fr-a1-001');
    expect(practice.total).toBe(1);
    const assessment = await nextQuestion(
      client,
      ownerB,
      'study-b',
      'fr-a1-001'
    );
    expect(assessment.total).toBe(2);
  });

  it('is unavailable while paused, for unknown skills and for quarantined content', async () => {
    await pauseStudySession(client, ownerA, 'study-a');
    await expect(
      nextQuestion(client, ownerA, 'study-a', 'fr-a1-001')
    ).rejects.toThrow('SESSION_NOT_ACTIVE');
    await resumeStudySession(client, ownerA, 'study-a');
    await expect(
      nextQuestion(client, ownerA, 'study-a', 'no-such-skill')
    ).rejects.toThrow('NOT_FOUND');
    await client.execute(
      "UPDATE content_versions SET status = 'quarantined' WHERE id = 'fr-a1-001@1'"
    );
    await expect(
      nextQuestion(client, ownerA, 'study-a', 'fr-a1-001')
    ).rejects.toThrow('CONTENT_UNAVAILABLE');
  });

  it('does not serve content withdrawn after the version check', async () => {
    await expect(
      nextQuestion(
        quarantinedBeforePayloadRead(),
        ownerA,
        'study-a',
        'fr-a1-001'
      )
    ).rejects.toThrow('CONTENT_UNAVAILABLE');
  });

  it('keeps a started skill on its original version after a newer import', async () => {
    await attempt('k-pin', 'fr-a1-001@1:q1');
    const pkg = approvedPackage();
    Object.assign(pkg.versions[0], { lesson });
    Object.assign(pkg.versions[0].questions[1], { holdout: true });
    pkg.curriculumVersion = '0.2.0';
    pkg.versions.push({
      id: 'fr-a1-001@2',
      skillId: 'fr-a1-001',
      version: 2,
      review: 'approved',
      questions: [
        {
          id: 'fr-a1-001@2:q1',
          format: 'typed-blank',
          prompt: 'Nous ___ ici.',
          answer: 'sommes'
        }
      ]
    });
    await importContent(client, pkg);
    await pauseStudySession(client, ownerA, 'study-a');
    await resumeStudySession(client, ownerA, 'study-a');
    // The resumed session is finished with version 1, not restarted on 2.
    expect(await nextQuestion(client, ownerA, 'study-a', 'fr-a1-001')).toEqual({
      question: null,
      answered: 1,
      total: 1
    });
    // A session that has not started the skill gets the newest version.
    expect(
      await nextQuestion(client, ownerB, 'study-b', 'fr-a1-001')
    ).toMatchObject({ question: { id: 'fr-a1-001@2:q1' }, total: 1 });
  });

  it("does not reveal another learner's session", async () => {
    await expect(
      nextQuestion(client, ownerB, 'study-a', 'fr-a1-001')
    ).rejects.toThrow('NOT_FOUND');
  });
});

describe('lesson', () => {
  it('returns the stored lesson with the enrollment explanation language', async () => {
    expect(await getLesson(client, ownerA, 'fr', 'fr-a1-001')).toEqual({
      skillId: 'fr-a1-001',
      contentVersionId: 'fr-a1-001@1',
      title: 'Être',
      explanation: 'Use être to say who you are.',
      examples: lesson.examples,
      references: lesson.references,
      explanationLanguage: 'en',
      englishFallback: false
    });
  });

  it('shows English with a flag for a Portuguese enrollment', async () => {
    await client.execute(
      "UPDATE enrollments SET explanation_language = 'pt' WHERE id = 'enrollment-a'"
    );
    expect(await getLesson(client, ownerA, 'fr', 'fr-a1-001')).toMatchObject({
      explanationLanguage: 'en',
      englishFallback: true
    });
  });

  it('does not serve a lesson withdrawn after the version check', async () => {
    await expect(
      getLesson(quarantinedBeforePayloadRead(), ownerA, 'fr', 'fr-a1-001')
    ).rejects.toThrow('CONTENT_UNAVAILABLE');
  });

  it('is not found without an enrollment, for a skill without a lesson, and unavailable when quarantined', async () => {
    await expect(getLesson(client, ownerA, 'de', 'fr-a1-001')).rejects.toThrow(
      'NOT_FOUND'
    );
    await expect(getLesson(client, ownerA, 'fr', 'fr-a1-002')).rejects.toThrow(
      'NOT_FOUND'
    );
    await client.execute(
      "UPDATE content_versions SET status = 'quarantined' WHERE id = 'fr-a1-001@1'"
    );
    await expect(getLesson(client, ownerA, 'fr', 'fr-a1-001')).rejects.toThrow(
      'CONTENT_UNAVAILABLE'
    );
  });
});
