import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { getMastery, scoreGrammar } from '../src/lib/server/mastery';
import { recommendTopics } from '../src/lib/server/recommendations';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { seedBasicNote } from './fixtures/flashcards';
import { approveNote, submitReview } from '../src/lib/server/flashcards';
import { importContent } from '../src/lib/server/content-import';
import { approvedPackage } from './fixtures/content-package';
import { recordAttempt } from '../src/lib/server/study';

let client: Client;
let close: () => void;
const learner = testSession('learner-a');
beforeEach(async () => {
  ({ client, close } = await openFixtureDatabase(await fixture()));
  await importContent(client, approvedPackage());
});
afterEach(async () => {
  close?.();
  await disposeFlashcardFixtures();
});

describe('versioned grammar policy', () => {
  it('records incorrect evidence with zero contribution and rolls back a failed ledger write', async () => {
    const saved = await recordAttempt(client, learner, {
      studySessionId: 'study-a',
      questionId: 'fr-a1-001@1:q1',
      submissionKey: 'wrong-response',
      evidenceKind: 'independent',
      answer: 'es'
    });
    await client.execute(
      "CREATE TRIGGER reject_mastery BEFORE INSERT ON skill_evidence BEGIN SELECT RAISE(ABORT, 'synthetic ledger failure'); END"
    );
    await expect(getMastery(client, learner, 'fr')).rejects.toThrow(
      'synthetic ledger failure'
    );
    expect((await client.execute('SELECT * FROM skill_evidence')).rows).toEqual(
      []
    );
    await client.execute('DROP TRIGGER reject_mastery');
    expect(
      (await getMastery(client, learner, 'fr')).find(
        (skill) => skill.skillId === 'fr-a1-001'
      )
    ).toMatchObject({
      status: 'weak',
      correct: 0,
      incorrect: 1,
      independentItems: 1
    });
    expect(
      (
        await client.execute({
          sql: 'SELECT contribution FROM skill_evidence WHERE attempt_id = ?',
          args: [saved.id]
        })
      ).rows
    ).toEqual([{ contribution: 0 }]);
  });

  it('orders multiple suggested foundations and skips secure or unavailable prerequisites', () => {
    const topics = [
      {
        skillId: 'weak-topic',
        status: 'weak' as const,
        prerequisites: ['b', 'a', 'c']
      },
      { skillId: 'b', status: 'unknown' as const, prerequisites: [] },
      { skillId: 'a', status: 'unknown' as const, prerequisites: [] },
      { skillId: 'c', status: 'secure' as const, prerequisites: [] }
    ];
    expect(recommendTopics(topics)).toMatchObject({
      skillId: 'a',
      manualSkillIds: ['a', 'b', 'c', 'weak-topic']
    });
    expect(
      recommendTopics(
        topics.map((topic) => ({ ...topic, available: topic.skillId !== 'a' }))
      )
    ).toMatchObject({ skillId: 'b', manualSkillIds: ['b', 'c', 'weak-topic'] });
    expect(
      recommendTopics(
        topics.map((topic) =>
          topic.skillId === 'weak-topic'
            ? topic
            : { ...topic, status: 'secure' as const }
        )
      )
    ).toMatchObject({ skillId: 'weak-topic' });
    expect(recommendTopics([])).toBeNull();
  });

  it.each([
    [0, 0, 0, 'unknown'],
    [0, 1, 1, 'weak'],
    [1, 1, 1, 'weak'],
    [3, 2, 2, 'practising'],
    [4, 1, 1, 'practising'],
    [4, 1, 2, 'secure'],
    [1, 0, 1, 'practising'],
    [3, 1, 2, 'practising']
  ])(
    '%i correct, %i incorrect across %i sessions is %s',
    (correct, incorrect, sessions, status) => {
      expect(scoreGrammar({ correct, incorrect, sessions }).status).toBe(
        status
      );
    }
  );

  it('explains every grammar status and keeps both secure thresholds', () => {
    expect(
      scoreGrammar({ correct: 0, incorrect: 0, sessions: 0 })
    ).toMatchObject({
      status: 'unknown',
      reason: 'No qualifying independent grammar evidence yet.'
    });
    expect(
      scoreGrammar({ correct: 2, incorrect: 3, sessions: 2 })
    ).toMatchObject({
      status: 'weak',
      reason:
        'Fewer than 60% of the qualifying items were correct; revisit this topic.'
    });
    expect(
      scoreGrammar({ correct: 1, incorrect: 0, sessions: 1 })
    ).toMatchObject({
      status: 'practising',
      reason:
        'Keep practising distinct items across sessions to build stronger evidence.'
    });
    expect(
      scoreGrammar({ correct: 4, incorrect: 1, sessions: 2 })
    ).toMatchObject({
      status: 'secure',
      reason:
        'At least five distinct items across two sessions, with at least 80% correct.'
    });
    expect(scoreGrammar({ correct: 4, incorrect: 0, sessions: 2 }).status).toBe(
      'practising'
    );
    expect(scoreGrammar({ correct: 5, incorrect: 0, sessions: 1 }).status).toBe(
      'practising'
    );
  });

  it('excludes assisted and uncertain outcomes, hides unfinished assessments and scopes by owner', async () => {
    const uncertain = await recordAttempt(client, learner, {
      studySessionId: 'study-a',
      questionId: 'fr-a1-002@1:q1',
      submissionKey: 'uncertain',
      evidenceKind: 'independent',
      answer: 'unknown text'
    });
    await recordAttempt(client, learner, {
      studySessionId: 'study-a',
      questionId: 'fr-a1-001@1:q1',
      submissionKey: 'assisted',
      evidenceKind: 'assisted',
      answer: 'suis'
    });
    const b = testSession('learner-b');
    await recordAttempt(client, b, {
      studySessionId: 'study-b',
      questionId: 'fr-a1-001@1:q1',
      submissionKey: 'assessment',
      evidenceKind: 'independent',
      answer: 'suis'
    });
    expect(
      (await getMastery(client, learner, 'fr')).find(
        (skill) => skill.skillId === 'fr-a1-001'
      )
    ).toMatchObject({ status: 'unknown', independentItems: 0 });
    expect(
      (await getMastery(client, b, 'fr')).find(
        (skill) => skill.skillId === 'fr-a1-001'
      )
    ).toMatchObject({ status: 'unknown' });
    await client.execute(
      "UPDATE study_sessions SET state = 'completed' WHERE id = 'study-b'"
    );
    expect(
      (await getMastery(client, b, 'fr')).find(
        (skill) => skill.skillId === 'fr-a1-001'
      )
    ).toMatchObject({ status: 'practising', independentItems: 1 });
    expect(
      (
        await client.execute({
          sql: 'SELECT * FROM skill_evidence WHERE attempt_id = ?',
          args: [uncertain.id]
        })
      ).rows
    ).toHaveLength(0);
  });

  it('counts a grammar item once, preserves its evaluation identity and ignores flashcard state', async () => {
    const first = await recordAttempt(client, learner, {
      studySessionId: 'study-a',
      questionId: 'fr-a1-001@1:q1',
      submissionKey: 'first',
      evidenceKind: 'independent',
      answer: 'suis'
    });
    const a = await getMastery(client, learner, 'fr');
    expect(a.find((skill) => skill.skillId === 'fr-a1-001')).toMatchObject({
      correct: 1,
      independentItems: 1,
      policyVersion: 'grammar-1'
    });
    expect(await getMastery(client, learner, 'fr')).toEqual(a);
    const note = await seedBasicNote(client, learner);
    await approveNote(client, learner, note.id);
    await submitReview(client, learner, {
      cardId: note.cardId,
      submissionId: 'mastery-fsrs-check',
      expectedRevision: 0,
      rating: 'easy'
    });
    expect(await getMastery(client, learner, 'fr')).toEqual(a);
    expect(
      (
        await client.execute({
          sql: 'SELECT attempt_id, scoring_version, contribution FROM skill_evidence WHERE attempt_id = ?',
          args: [first.id]
        })
      ).rows
    ).toEqual([
      { attempt_id: first.id, scoring_version: 'grammar-1', contribution: 1 }
    ]);
    await client.execute(
      "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode) VALUES ('repeat', 'learner-a', 'enrollment-a', 'fr', 'practice')"
    );
    await recordAttempt(client, learner, {
      studySessionId: 'repeat',
      questionId: 'fr-a1-001@1:q1',
      submissionKey: 'again',
      evidenceKind: 'independent',
      answer: 'suis'
    });
    expect(await getMastery(client, learner, 'fr')).toEqual(a);
    await expect(getMastery(client, learner, 'de')).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
  });

  it('does not count replacement versions or quarantined evidence as fresh items', async () => {
    await recordAttempt(client, learner, {
      studySessionId: 'study-a',
      questionId: 'fr-a1-001@1:q1',
      submissionKey: 'original',
      evidenceKind: 'independent',
      answer: 'suis'
    });
    await client.batch(
      [
        "INSERT INTO content_versions (id, skill_id, language, version, status) VALUES ('fr-a1-001@2', 'fr-a1-001', 'fr', 2, 'pilot-ready')",
        "INSERT INTO questions (id, content_version_id, skill_id, language, format, prompt, answer) VALUES ('fr-a1-001@2:q1', 'fr-a1-001@2', 'fr-a1-001', 'fr', 'typed-blank', 'synthetic', 'yes')",
        "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode) VALUES ('version-two', 'learner-a', 'enrollment-a', 'fr', 'practice')"
      ],
      'write'
    );
    await recordAttempt(client, learner, {
      studySessionId: 'version-two',
      questionId: 'fr-a1-001@2:q1',
      submissionKey: 'replacement',
      evidenceKind: 'independent',
      answer: 'yes'
    });
    expect(
      (await getMastery(client, learner, 'fr')).find(
        (skill) => skill.skillId === 'fr-a1-001'
      )
    ).toMatchObject({ independentItems: 1 });
    await client.execute(
      "UPDATE content_versions SET status = 'quarantined' WHERE id = 'fr-a1-001@1'"
    );
    expect(
      (await getMastery(client, learner, 'fr')).find(
        (skill) => skill.skillId === 'fr-a1-001'
      )
    ).toMatchObject({ independentItems: 0, status: 'unknown' });
  });

  it('recommends weak topics deterministically without removing manual choices', () => {
    const skills = [
      { skillId: 'b', status: 'weak' as const, prerequisites: ['a'] },
      { skillId: 'a', status: 'unknown' as const, prerequisites: [] },
      { skillId: 'c', status: 'secure' as const, prerequisites: [] }
    ];
    expect(recommendTopics(skills)).toMatchObject({
      skillId: 'a',
      reason: expect.any(String),
      manualSkillIds: ['a', 'b', 'c']
    });
    expect(recommendTopics([...skills].reverse())).toEqual(
      recommendTopics(skills)
    );
  });
});
