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

/** A client on which the session completes just before its first UPDATE. */
function completedBeforeUpdate(): Client {
  let completed = false;
  return new Proxy(client, {
    get(target, property) {
      if (property !== 'execute') {
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (statement: InStatement) => {
        const text = typeof statement === 'string' ? statement : statement.sql;
        if (!completed && /^\s*UPDATE study_sessions\b/i.test(text)) {
          completed = true;
          await target.execute(
            "UPDATE study_sessions SET state = 'completed' WHERE id = 'study-a'"
          );
        }
        return target.execute(statement);
      };
    }
  });
}

/**
 * A client whose first read of question or lesson payload is preceded by a
 * quarantine import committing, as when content is withdrawn between a
 * version check and the payload query.
 */
function quarantinedBeforePayloadRead(): Client {
  let withdrawn = false;
  return new Proxy(client, {
    get(target, property) {
      if (property !== 'execute') {
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (statement: InStatement) => {
        const text = typeof statement === 'string' ? statement : statement.sql;
        if (!withdrawn && /\b(FROM|JOIN)\s+(questions|lessons)\b/i.test(text)) {
          withdrawn = true;
          await target.execute(
            "UPDATE content_versions SET status = 'quarantined' WHERE id = 'fr-a1-001@1'"
          );
        }
        return target.execute(statement);
      };
    }
  });
}

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
