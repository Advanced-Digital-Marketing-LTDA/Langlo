import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { importContent } from '../src/lib/server/content-import';
import { GRAMMAR_RETENTION_POLICY_VERSION } from '../src/lib/server/grammar-retention';
import type { FallbackResult } from '../src/lib/server/evaluation/fallback';
import { pauseStudySession, recordAttempt } from '../src/lib/server/study';
import * as assessment from '../src/lib/server/assessment';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { approvedPackage } from './fixtures/content-package';

// The answer is saved in one batch and the checks around it run in one
// transaction. These pin what that must keep doing: which refusal wins when
// several apply, what a failure leaves behind, and what each answer adds to
// the evidence ledger and the rating.

vi.mock('../src/lib/server/assessment', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../src/lib/server/assessment')>();
  return {
    ...original,
    completeAssessment: vi.fn(original.completeAssessment)
  };
});

// Synthetic principal; these prove repository behavior, not a real session.
const ownerA = testSession('learner-a');

let client: Client;
let close: (() => void) | undefined;

beforeEach(async () => {
  ({ client, close } = await openFixtureDatabase(await fixture()));
  await importContent(client, approvedPackage());
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.mocked(assessment.completeAssessment).mockClear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  close?.();
  close = undefined;
  await disposeFlashcardFixtures();
});

type Overrides = {
  key?: string;
  answer?: string;
  evidenceKind?: 'independent' | 'assisted';
  notSure?: boolean;
  studySessionId?: string;
};

const attempt = (
  questionId: string,
  overrides: Overrides = {},
  fallback?: (input: unknown) => Promise<FallbackResult>
) =>
  recordAttempt(
    client,
    ownerA,
    {
      studySessionId: overrides.studySessionId ?? 'study-a',
      questionId,
      submissionKey: overrides.key ?? 'key-1',
      evidenceKind: overrides.evidenceKind ?? 'independent',
      answer: overrides.answer ?? 'suis',
      notSure: overrides.notSure
    },
    { fallback }
  );

const count = async (table: string) =>
  Number(
    (await client.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0]?.n
  );

const stored = async () => ({
  attempts: await count('attempts'),
  evaluations: await count('evaluations'),
  evidence: await count('skill_evidence')
});

const run = (sql: string, args: (string | null)[] = []) =>
  client.execute({ sql, args });

describe('assessment completion is skipped for other sessions', () => {
  it.each([
    ['a correct', 'suis'],
    ['an incorrect', 'es']
  ])('%s practice answer never reaches completion', async (_, answer) => {
    await attempt('fr-a1-001@1:q1', { answer });
    expect(assessment.completeAssessment).not.toHaveBeenCalled();
    const session = await run(
      "SELECT state, mode FROM study_sessions WHERE id = 'study-a'"
    );
    expect(session.rows[0]).toMatchObject({
      state: 'active',
      mode: 'practice'
    });
  });
});

describe('a corrupt question leaves nothing behind', () => {
  const question = 'fr-a1-002@1:q1';
  const snapshot = async () =>
    (
      await run(
        'SELECT format, answer, alternatives FROM questions WHERE id = ?',
        [question]
      )
    ).rows[0];

  it.each([
    [
      'a stored answer that is not text',
      "UPDATE questions SET answer = x'00' WHERE id = 'fr-a1-002@1:q1'",
      'invalid answer'
    ],
    [
      'alternatives that are not JSON',
      "UPDATE questions SET alternatives = 'not json' WHERE id = 'fr-a1-002@1:q1'",
      'invalid alternatives'
    ],
    [
      'a format outside the known set',
      "UPDATE questions SET format = 'essay' WHERE id = 'fr-a1-002@1:q1'",
      'invalid format'
    ]
  ])(
    'rolls back for %s, then records once repaired',
    async (_, corrupt, why) => {
      const before = await snapshot();
      const saved = await stored();
      await run('PRAGMA ignore_check_constraints = ON');
      await run(corrupt);
      await run('PRAGMA ignore_check_constraints = OFF');

      await expect(attempt(question, { answer: 'on est ici' })).rejects.toThrow(
        `Question ${question} has ${why}`
      );
      expect(await stored()).toEqual(saved);

      await run(
        'UPDATE questions SET format = ?, answer = ?, alternatives = ? WHERE id = ?',
        [
          String(before.format),
          before.answer === null ? null : String(before.answer),
          before.alternatives === null ? null : String(before.alternatives),
          question
        ]
      );
      // The failed answer left no row holding its submission key.
      const recorded = await attempt(question, { answer: 'on est ici' });
      expect(recorded.duplicate).toBe(false);
      expect((await stored()).attempts).toBe(saved.attempts + 1);
    }
  );
});

describe('which refusal wins when several apply', () => {
  it('replays a recorded submission although the session is now paused', async () => {
    const first = await attempt('fr-a1-001@1:q1');
    await pauseStudySession(client, ownerA, 'study-a');
    expect(await attempt('fr-a1-001@1:q1')).toEqual({
      id: first.id,
      duplicate: true
    });
  });

  it('reports a reused key with another payload before a paused session', async () => {
    await attempt('fr-a1-001@1:q1');
    await pauseStudySession(client, ownerA, 'study-a');
    await expect(
      attempt('fr-a1-001@1:q1', { answer: 'es' })
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('reports invalid input before looking at the session', async () => {
    await expect(
      attempt('fr-a1-001@1:q1', { studySessionId: 'study-b', key: '' })
    ).rejects.toMatchObject({ code: 'INVALID_SUBMISSION_KEY' });
  });

  it("reports another learner's session as not found, whatever the question", async () => {
    await expect(
      attempt('missing-question', { studySessionId: 'study-b' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reports a paused session before an unknown question', async () => {
    await pauseStudySession(client, ownerA, 'study-a');
    await expect(attempt('missing-question')).rejects.toMatchObject({
      code: 'SESSION_NOT_ACTIVE'
    });
  });

  it('reports an unknown question as not found', async () => {
    await expect(attempt('missing-question')).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
  });

  it('reports withdrawn content before an answered question', async () => {
    await attempt('fr-a1-001@1:q1');
    await run(
      "UPDATE content_versions SET status = 'quarantined' WHERE id = 'fr-a1-001@1'"
    );
    await expect(
      attempt('fr-a1-001@1:q1', { key: 'key-2' })
    ).rejects.toMatchObject({ code: 'CONTENT_UNAVAILABLE' });
  });

  it('reports a retired skill before an answered question', async () => {
    await attempt('fr-a1-001@1:q1');
    await run("UPDATE skills SET retired_at = 1 WHERE id = 'fr-a1-001'");
    await expect(
      attempt('fr-a1-001@1:q1', { key: 'key-2' })
    ).rejects.toMatchObject({ code: 'CONTENT_UNAVAILABLE' });
  });

  it('reports another version of the skill before an answered question', async () => {
    const pkg = approvedPackage();
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
          answer: 'sommes',
          change: 'new'
        }
      ]
    });
    await importContent(client, pkg);
    // Version 1 is pinned by the first answer; version 2 is answered too.
    await attempt('fr-a1-001@1:q1');
    await run(
      `INSERT INTO attempts (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer, created_at)
       VALUES ('answered-v2', 'learner-a', 'study-a', 'fr-a1-001@2:q1', 'fr-a1-001@2', 'fr-a1-001', 'fr', 'key-v2', 'independent', 'sommes', 9999999999999)`
    );
    await expect(
      attempt('fr-a1-001@2:q1', { key: 'key-2', answer: 'sommes' })
    ).rejects.toMatchObject({ code: 'STALE_QUESTION' });
  });

  it('refuses a second independent answer, but records an assisted one', async () => {
    await attempt('fr-a1-001@1:q1');
    await expect(
      attempt('fr-a1-001@1:q1', { key: 'key-2' })
    ).rejects.toMatchObject({ code: 'QUESTION_ALREADY_ANSWERED' });
    const assisted = await attempt('fr-a1-001@1:q1', {
      key: 'key-3',
      evidenceKind: 'assisted'
    });
    expect(assisted.duplicate).toBe(false);
  });

  it('leaves nothing behind for any of the refusals', async () => {
    await attempt('fr-a1-001@1:q1');
    const saved = await stored();
    await pauseStudySession(client, ownerA, 'study-a');
    for (const refused of [
      attempt('fr-a1-001@1:q1', { answer: 'es' }),
      attempt('missing-question', { key: 'key-2' })
    ])
      await expect(refused).rejects.toBeInstanceOf(Error);
    expect(await stored()).toEqual(saved);
  });
});

describe('the evidence ledger across the batched write', () => {
  const evidenceOf = async () =>
    (
      await run(
        'SELECT attempt_id, skill_id, contribution FROM skill_evidence ORDER BY created_at, id'
      )
    ).rows.map((row) => ({ ...row }));

  it('adds one contributing row for a correct answer', async () => {
    const recorded = await attempt('fr-a1-001@1:q1');
    expect(await evidenceOf()).toEqual([
      { attempt_id: recorded.id, skill_id: 'fr-a1-001', contribution: 1 }
    ]);
  });

  it('adds one non-contributing row for an incorrect answer', async () => {
    const recorded = await attempt('fr-a1-001@1:q1', { answer: 'es' });
    expect(await evidenceOf()).toEqual([
      { attempt_id: recorded.id, skill_id: 'fr-a1-001', contribution: 0 }
    ]);
  });

  it('adds nothing for an answer marked not sure', async () => {
    await attempt('fr-a1-001@1:q1', { answer: '', notSure: true });
    expect(await evidenceOf()).toEqual([]);
  });

  it('adds nothing for an unmatched typed answer until the fallback decides', async () => {
    const fallback = vi.fn(async (): Promise<FallbackResult> => {
      expect(await evidenceOf()).toEqual([]);
      return { outcome: 'correct', reason: 'answered', evaluated: true };
    });
    const recorded = await attempt(
      'fr-a1-002@1:q1',
      { answer: 'Nous voilà ici.' },
      fallback
    );
    expect(fallback).toHaveBeenCalledOnce();
    expect(await evidenceOf()).toEqual([
      { attempt_id: recorded.id, skill_id: 'fr-a1-002', contribution: 1 }
    ]);
  });

  it('settles the fallback once, after the answer is saved', async () => {
    const before = await stored();
    const savedWhenCalled: Record<string, unknown>[] = [];
    const fallback = vi.fn(async (): Promise<FallbackResult> => {
      // The attempt and its prepared evaluation are already committed.
      savedWhenCalled.push(await stored());
      return { outcome: 'incorrect', reason: 'answered', evaluated: true };
    });
    await attempt('fr-a1-002@1:q1', { answer: 'Nous voilà ici.' }, fallback);
    expect(fallback).toHaveBeenCalledOnce();
    expect(savedWhenCalled).toEqual([
      {
        attempts: before.attempts + 1,
        evaluations: before.evaluations + 1,
        evidence: before.evidence
      }
    ]);
    expect((await stored()).evaluations).toBe(before.evaluations + 2);
  });
});

describe('the mistake rating across the batched write', () => {
  const ratingOf = async (id: string) =>
    (await run('SELECT grammar_rating FROM attempts WHERE id = ?', [id]))
      .rows[0]?.grammar_rating;

  beforeEach(async () => {
    await run(
      'UPDATE study_sessions SET grammar_retention_policy_version = ? WHERE id = ?',
      [GRAMMAR_RETENTION_POLICY_VERSION, 'study-a']
    );
  });

  it.each([
    ['a wrong first answer', { answer: 'es' }, 'again'],
    ['a correct answer', { answer: 'suis' }, null],
    ['an answer marked not sure', { answer: '', notSure: true }, null],
    [
      'a wrong assisted answer',
      { answer: 'es', evidenceKind: 'assisted' as const },
      null
    ]
  ])('rates %s as %s', async (_, overrides, rating) => {
    const recorded = await attempt('fr-a1-001@1:q1', overrides);
    expect(await ratingOf(recorded.id)).toBe(rating);
  });

  it('leaves a wrong answer unrated outside the retention policy', async () => {
    await run(
      'UPDATE study_sessions SET grammar_retention_policy_version = NULL WHERE id = ?',
      ['study-a']
    );
    const recorded = await attempt('fr-a1-001@1:q1', { answer: 'es' });
    expect(await ratingOf(recorded.id)).toBeNull();
  });
});
