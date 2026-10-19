import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import {
  qualifyingGrammarEvidence,
  scoreGrammar
} from '../src/lib/server/mastery';
import { loadProgress } from '../src/lib/server/progress';
import {
  recommendPractice,
  recommendTopics
} from '../src/lib/server/recommendations';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { seedBasicNote } from './fixtures/flashcards';
import {
  approveNote,
  beginWrite,
  submitReview
} from '../src/lib/server/flashcards';
import { importContent } from '../src/lib/server/content-import';
import { approvedPackage } from './fixtures/content-package';
import { recordAttempt } from '../src/lib/server/study';
import type { GrammarStatus } from '../src/lib/server/mastery';

let client: Client;
let close: () => void;
const learner = testSession('learner-a');
const computeMastery = async (
  client: Client,
  session: typeof learner,
  language: string
) => (await loadProgress(client, session, language)).tracks[0].skills;

const withoutPracticeCounts = <
  T extends {
    practisedSessions: number;
    answers: number;
    lastPractisedAt: number | null;
  }
>({
  practisedSessions: _practisedSessions,
  answers: _answers,
  lastPractisedAt: _lastPractisedAt,
  ...skill
}: T) => skill;

const practiceTopic = (
  skillId: string,
  overrides: Partial<{
    status: GrammarStatus;
    prerequisites: string[];
    available: boolean;
    correct: number;
    independentItems: number;
    practisedSessions: number;
    answers: number;
    lastPractisedAt: number | null;
    reason: string;
  }> = {}
) => ({
  skillId,
  status: 'weak' as const,
  prerequisites: [],
  available: true,
  correct: 0,
  independentItems: 1,
  practisedSessions: 1,
  answers: 1,
  lastPractisedAt: 100,
  reason: 'Revisit this topic.',
  ...overrides
});

beforeEach(async () => {
  ({ client, close } = await openFixtureDatabase(await fixture()));
  await importContent(client, approvedPackage());
});
afterEach(async () => {
  close?.();
  await disposeFlashcardFixtures();
});

it.each([
  {
    reason: 'timestamp before sequence',
    first: ['z-first', 1, 9],
    later: ['a-later', 2, 1]
  },
  {
    reason: 'sequence for equal timestamps',
    first: ['z-first', 1, 1],
    later: ['a-later', 1, 2]
  },
  {
    reason: 'attempt ID for equal timestamps and sequences',
    first: ['a-first', 1, 1],
    later: ['z-later', 1, 1]
  }
])('selects first grammar evidence by $reason', ({ first, later }) => {
  const rows = [later, first].map(([attemptId, createdAt, sequence]) => ({
    length: 0,
    attempt_id: attemptId,
    created_at: createdAt,
    sequence,
    skill_id: 'skill',
    question_id: 'version:q1',
    content_version_id: 'version',
    study_session_id: 'session',
    evidence_kind: 'independent',
    not_sure: 0,
    mode: 'practice',
    state: 'active',
    status: 'pilot-ready',
    evaluator_version: 'prepared-1',
    rubric_version: 'version',
    evaluation_id: `evaluation-${attemptId}`,
    outcome: 'correct'
  }));
  expect(qualifyingGrammarEvidence(rows)).toMatchObject([
    { attemptId: first[0] }
  ]);
});

describe('versioned grammar policy', () => {
  it('waits for an active write before reading a consistent mastery snapshot', async () => {
    const before = await computeMastery(client, learner, 'fr');
    const held = await beginWrite(client);
    await held.execute(
      "UPDATE lessons SET title = 'Uncommitted title' WHERE content_version_id = 'fr-a1-001@1'"
    );
    let completed = false;
    const loading = computeMastery(client, learner, 'fr').then((skills) => {
      completed = true;
      return skills;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const completedDuringWrite = completed;
    await held.rollback();
    held.close();
    expect(completedDuringWrite).toBe(false);
    expect(await loading).toEqual(before);
  });

  it('writes evidence with the answer and computes mastery without writes', async () => {
    const input = {
      studySessionId: 'study-a',
      questionId: 'fr-a1-001@1:q1',
      submissionKey: 'wrong-response',
      evidenceKind: 'independent',
      answer: 'es'
    } as const;
    await client.execute(
      "CREATE TRIGGER reject_mastery BEFORE INSERT ON skill_evidence BEGIN SELECT RAISE(ABORT, 'synthetic ledger failure'); END"
    );
    await expect(recordAttempt(client, learner, input)).rejects.toThrow(
      'synthetic ledger failure'
    );
    expect(
      (
        await client.execute({
          sql: 'SELECT * FROM attempts WHERE submission_key = ?',
          args: [input.submissionKey]
        })
      ).rows
    ).toEqual([]);
    expect((await client.execute('SELECT * FROM skill_evidence')).rows).toEqual(
      []
    );
    await client.execute('DROP TRIGGER reject_mastery');
    const saved = await recordAttempt(client, learner, input);
    expect(
      (
        await client.execute({
          sql: 'SELECT contribution FROM skill_evidence WHERE attempt_id = ?',
          args: [saved.id]
        })
      ).rows
    ).toEqual([{ contribution: 0 }]);
    await client.execute(
      "CREATE TRIGGER reject_mastery BEFORE INSERT ON skill_evidence BEGIN SELECT RAISE(ABORT, 'synthetic ledger failure'); END"
    );
    expect(
      (await computeMastery(client, learner, 'fr')).find(
        (skill) => skill.skillId === 'fr-a1-001'
      )
    ).toMatchObject({
      status: 'weak',
      correct: 0,
      incorrect: 1,
      independentItems: 1
    });
    expect(
      (await client.execute('SELECT * FROM skill_evidence')).rows
    ).toHaveLength(1);
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
      (await computeMastery(client, learner, 'fr')).find(
        (skill) => skill.skillId === 'fr-a1-001'
      )
    ).toMatchObject({ status: 'unknown', independentItems: 0 });
    expect(
      (await computeMastery(client, b, 'fr')).find(
        (skill) => skill.skillId === 'fr-a1-001'
      )
    ).toMatchObject({ status: 'unknown' });
    await client.execute(
      "UPDATE study_sessions SET state = 'completed' WHERE id = 'study-b'"
    );
    expect(
      (await computeMastery(client, b, 'fr')).find(
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
    const a = await computeMastery(client, learner, 'fr');
    expect(a.find((skill) => skill.skillId === 'fr-a1-001')).toMatchObject({
      correct: 1,
      independentItems: 1,
      policyVersion: 'grammar-1'
    });
    expect(await computeMastery(client, learner, 'fr')).toEqual(a);
    const note = await seedBasicNote(client, learner);
    await approveNote(client, learner, note.id);
    await submitReview(client, learner, {
      cardId: note.cardId,
      submissionId: 'a0000000-0000-4000-8000-000000000090',
      expectedRevision: 0,
      rating: 'easy'
    });
    expect(await computeMastery(client, learner, 'fr')).toEqual(a);
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
    const afterRepeat = await computeMastery(client, learner, 'fr');
    expect(
      afterRepeat.find((skill) => skill.skillId === 'fr-a1-001')
    ).toMatchObject({
      correct: 1,
      incorrect: 0,
      independentItems: 1,
      practisedSessions: 2,
      answers: 2
    });
    expect(afterRepeat.map(withoutPracticeCounts)).toEqual(
      a.map(withoutPracticeCounts)
    );
    await expect(loadProgress(client, learner, 'de')).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
  });

  it('reconciles missing ledger evidence when the learner answers its lineage again', async () => {
    const first = await recordAttempt(client, learner, {
      studySessionId: 'study-a',
      questionId: 'fr-a1-001@1:q1',
      submissionKey: 'backfill-first',
      evidenceKind: 'independent',
      answer: 'suis'
    });
    await client.execute({
      sql: 'DELETE FROM skill_evidence WHERE attempt_id = ?',
      args: [first.id]
    });
    await client.execute(
      "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode) VALUES ('backfill-repeat', 'learner-a', 'enrollment-a', 'fr', 'practice')"
    );
    await recordAttempt(client, learner, {
      studySessionId: 'backfill-repeat',
      questionId: 'fr-a1-001@1:q1',
      submissionKey: 'backfill-again',
      evidenceKind: 'independent',
      answer: 'suis'
    });
    expect(
      (
        await client.execute({
          sql: 'SELECT attempt_id FROM skill_evidence WHERE attempt_id = ?',
          args: [first.id]
        })
      ).rows
    ).toEqual([{ attempt_id: first.id }]);
  });

  it('records resolved mixed-review answers in the evidence ledger', async () => {
    await client.execute(
      "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode) VALUES ('mixed-review', 'learner-a', 'enrollment-a', 'fr', 'mixed-review')"
    );
    const attempt = await recordAttempt(client, learner, {
      studySessionId: 'mixed-review',
      questionId: 'fr-a1-001@1:q1',
      submissionKey: 'mixed-review-evidence',
      evidenceKind: 'independent',
      answer: 'suis'
    });
    expect(
      (
        await client.execute({
          sql: 'SELECT attempt_id FROM skill_evidence WHERE attempt_id = ?',
          args: [attempt.id]
        })
      ).rows
    ).toEqual([{ attempt_id: attempt.id }]);
  });

  it('lists the skill from the newest version that is not quarantined', async () => {
    const entry = async () =>
      (await computeMastery(client, learner, 'fr')).find(
        (skill) => skill.skillId === 'fr-a1-001'
      );
    const before = await entry();
    await client.execute(
      "INSERT INTO content_versions (id, skill_id, language, version, status) VALUES ('fr-a1-001@2', 'fr-a1-001', 'fr', 2, 'quarantined')"
    );
    expect(await entry()).toMatchObject({
      contentVersionId: 'fr-a1-001@1',
      available: before?.available
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
      (await computeMastery(client, learner, 'fr')).find(
        (skill) => skill.skillId === 'fr-a1-001'
      )
    ).toMatchObject({ independentItems: 1 });
    await client.execute(
      "UPDATE content_versions SET status = 'quarantined' WHERE id = 'fr-a1-001@1'"
    );
    expect(
      (await computeMastery(client, learner, 'fr')).find(
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

  it('recommends only started, available weak or practising topics', () => {
    const result = recommendPractice([
      practiceTopic('weak'),
      practiceTopic('practising', { status: 'practising' }),
      practiceTopic('secure', { status: 'secure' }),
      practiceTopic('unknown', { status: 'unknown' }),
      practiceTopic('unstarted', { answers: 0, practisedSessions: 0 }),
      practiceTopic('unavailable', { available: false })
    ]);
    expect(result.map((topic) => topic.skillId)).toEqual([
      'weak',
      'practising'
    ]);
  });

  it('orders weak topics by accuracy and practising topics by recency then id', () => {
    const topics = [
      practiceTopic('weak-b', { correct: 0, independentItems: 2 }),
      practiceTopic('weak-a', { correct: 2, independentItems: 10 }),
      practiceTopic('weak-later', { correct: 1, independentItems: 10 }),
      practiceTopic('practice-recent', {
        status: 'practising',
        lastPractisedAt: 30
      }),
      practiceTopic('practice-b', {
        status: 'practising',
        lastPractisedAt: 20
      }),
      practiceTopic('practice-a', {
        status: 'practising',
        lastPractisedAt: 20
      }),
      practiceTopic('practice-old', {
        status: 'practising',
        lastPractisedAt: 10
      })
    ];
    const result = recommendPractice(topics);
    expect(result.map((topic) => topic.skillId)).toEqual([
      'weak-b',
      'weak-later',
      'weak-a',
      'practice-old',
      'practice-a'
    ]);
    expect(result).toHaveLength(5);
    expect(recommendPractice([...topics].reverse())).toEqual(result);
    const undatedTopics = [
      practiceTopic('practice-recent', {
        status: 'practising',
        lastPractisedAt: 30
      }),
      practiceTopic('practice-undated', {
        status: 'practising',
        lastPractisedAt: null
      })
    ];
    expect(
      recommendPractice(undatedTopics).map((topic) => topic.skillId)
    ).toEqual(['practice-recent', 'practice-undated']);
    expect(
      recommendPractice([...undatedTopics].reverse()).map(
        (topic) => topic.skillId
      )
    ).toEqual(['practice-recent', 'practice-undated']);
  });

  it('ranks a started weak or practising prerequisite before its dependent', () => {
    const result = recommendPractice([
      practiceTopic('dependent', { prerequisites: ['foundation'] }),
      practiceTopic('foundation', { status: 'practising' })
    ]);
    expect(result.map((topic) => topic.skillId)).toEqual([
      'foundation',
      'dependent'
    ]);
  });

  it('keeps the existing ranking when imported prerequisites form a cycle', () => {
    const result = recommendPractice([
      practiceTopic('cycle-b', { prerequisites: ['cycle-a'] }),
      practiceTopic('cycle-a', { prerequisites: ['cycle-b'] })
    ]);
    expect(result.map((topic) => topic.skillId)).toEqual([
      'cycle-a',
      'cycle-b'
    ]);
  });

  it('returns no practice recommendations when no started topic needs work', () => {
    expect(
      recommendPractice([
        practiceTopic('secure', { status: 'secure' }),
        practiceTopic('unstarted', { answers: 0 })
      ])
    ).toEqual([]);
  });

  it('counts practice answers and sessions separately from evidence and assessments', async () => {
    await recordAttempt(client, learner, {
      studySessionId: 'study-a',
      questionId: 'fr-a1-001@1:q1',
      submissionKey: 'count-correct',
      evidenceKind: 'independent',
      answer: 'suis'
    });
    await recordAttempt(client, learner, {
      studySessionId: 'study-a',
      questionId: 'fr-a1-001@1:q2',
      submissionKey: 'count-unsure',
      evidenceKind: 'independent',
      answer: '',
      notSure: true
    });
    await client.execute(
      "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode) VALUES ('practice-count-two', 'learner-a', 'enrollment-a', 'fr', 'practice')"
    );
    await recordAttempt(client, learner, {
      studySessionId: 'practice-count-two',
      questionId: 'fr-a1-001@1:q1',
      submissionKey: 'count-assisted',
      evidenceKind: 'independent',
      answer: 'suis'
    });
    await client.batch(
      [
        "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode, state) VALUES ('assessment-count', 'learner-a', 'enrollment-a', 'fr', 'assessment', 'completed')",
        "INSERT INTO attempts (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer) VALUES ('assessment-count-attempt', 'learner-a', 'assessment-count', 'fr-a1-001@1:q1', 'fr-a1-001@1', 'fr-a1-001', 'fr', 'assessment-count-key', 'independent', 'suis')",
        "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode) VALUES ('other-practice-count', 'learner-b', 'enrollment-b', 'fr', 'practice')",
        "INSERT INTO attempts (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer) VALUES ('other-practice-attempt', 'learner-b', 'other-practice-count', 'fr-a1-001@1:q1', 'fr-a1-001@1', 'fr-a1-001', 'fr', 'other-practice-key', 'independent', 'suis')"
      ],
      'write'
    );
    for (const [submissionKey, createdAt] of [
      ['count-correct', 2000],
      ['count-assisted', 3000],
      ['count-unsure', 1000],
      ['assessment-count-key', 9000],
      ['other-practice-key', 9500]
    ] as const)
      await client.execute({
        sql: 'UPDATE attempts SET created_at = ? WHERE submission_key = ?',
        args: [createdAt, submissionKey]
      });
    const topic = (await computeMastery(client, learner, 'fr')).find(
      (skill) => skill.skillId === 'fr-a1-001'
    );
    expect(topic).toMatchObject({ practisedSessions: 2, answers: 3 });
    expect(topic?.lastPractisedAt).toBe(3000);
    expect(topic?.independentItems).toBe(1);
  });

  it('carries raw practice counts from a retired topic to its replacement', async () => {
    await client.batch(
      [
        "INSERT INTO skills (id, language, level, retired_at, replaced_by, carry_progress) VALUES ('fr-a1-old', 'fr', 'A1', 1, 'fr-a1-002', 1)",
        "INSERT INTO content_versions (id, skill_id, language, version, status) VALUES ('fr-a1-old@1', 'fr-a1-old', 'fr', 1, 'pilot-ready')",
        "INSERT INTO questions (id, content_version_id, skill_id, language, format, prompt) VALUES ('fr-a1-old@1:q1', 'fr-a1-old@1', 'fr-a1-old', 'fr', 'typed-blank', 'retired question')",
        "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode) VALUES ('retired-practice', 'learner-a', 'enrollment-a', 'fr', 'practice')",
        "INSERT INTO attempts (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer) VALUES ('retired-practice-attempt', 'learner-a', 'retired-practice', 'fr-a1-old@1:q1', 'fr-a1-old@1', 'fr-a1-old', 'fr', 'retired-practice-key', 'assisted', 'suis')"
      ],
      'write'
    );
    const replacement = (await computeMastery(client, learner, 'fr')).find(
      (skill) => skill.skillId === 'fr-a1-002'
    );
    expect(replacement).toMatchObject({ practisedSessions: 1, answers: 1 });
  });
});
