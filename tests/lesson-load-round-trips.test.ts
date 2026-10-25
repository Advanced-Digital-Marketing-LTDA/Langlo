import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client, InStatement } from '@libsql/client';
import type { RuntimeConfig } from '../src/lib/server/config';
import type { FixtureTarget } from '../src/lib/server/db/fixture-target';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { importContent } from '../src/lib/server/content-import';
import {
  ratePracticeAnswer,
  recordAnswer
} from '../src/lib/server/lesson-practice';
import { GRAMMAR_RETENTION_POLICY_VERSION } from '../src/lib/server/grammar-retention';
import { StudyError } from '../src/lib/server/study-error';
import { load } from '../src/routes/app/learn/[language]/lesson/[skill]/+page.server';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { approvedPackage } from './fixtures/content-package';
import {
  counting,
  overriding,
  sqlOf,
  type Counted
} from './fixtures/counting-client';

// The lesson page is reloaded after every answer and each database call costs
// a network round trip in production, so the number of calls and whether they
// overlap are part of the page's behavior.

// Measured: 4 reads, begin, 11 statements and commit. Raising it needs a reason.
const ANSWER_BUDGET = 15;
// A rating is saved with begin, the attempt read, the update, one batch of
// ledger reads, the evidence insert and commit.
const RATING_WRITE_BUDGET = 6;
// The save plus the next question the rating result carries: the session and
// the question rows.
const RATING_BUDGET = 8;
// The session, enrollment, lesson and newer-version reads for the lesson; the
// session, feedback, evaluations and next question for the practice.
const RELOAD_BUDGET = 8;

const held = vi.hoisted(() => ({ client: undefined as Client | undefined }));

vi.mock('../src/lib/server/db/app', () => ({
  openAppDatabase: async () => ({
    client: held.client,
    close: () => undefined
  })
}));

let target: FixtureTarget;
let close: (() => void) | undefined;
let raw: Client;

beforeEach(async () => {
  target = await fixture();
  ({ client: raw, close } = await openFixtureDatabase(target));
  const pkg = approvedPackage();
  Object.assign(pkg.versions[0], {
    lesson: {
      title: 'Être',
      explanation: 'Use être.',
      examples: [],
      references: []
    }
  });
  await importContent(raw, pkg);
});

afterEach(async () => {
  close?.();
  close = undefined;
  await disposeFlashcardFixtures();
});

function pageEvent(session: string, skill = 'fr-a1-001') {
  return {
    params: { language: 'fr', skill },
    url: new URL(
      `http://127.0.0.1/app/learn/fr/lesson/${skill}?session=${session}`
    ),
    locals: {
      config: {
        dataEnabled: true,
        databaseUrl: target.databaseUrl
      } as RuntimeConfig,
      user: { id: 'learner-a', email: 'a@x', name: 'a' },
      session: {
        id: 's-a',
        userId: 'learner-a',
        expiresAt: new Date(Date.now() + 1e6)
      }
    }
  } as never;
}

async function loadCounted(session = 'study-a') {
  const counted: Counted = { sqls: [], peak: 0, together: [] };
  held.client = counting(raw, counted);
  const data = (await load(pageEvent(session))) as Record<string, unknown>;
  return { data, counted };
}

const feedbackReads = (sqls: string[]) =>
  sqls.filter((sql) => sql.includes('AS expected_answer')).length;

describe('lesson page load round trips', () => {
  it('reads the feedback on the last answer once for the whole page', async () => {
    const form = new FormData();
    for (const [name, value] of Object.entries({
      studySessionId: 'study-a',
      submissionKey: 'k1',
      questionId: 'fr-a1-001@1:q1',
      answer: 'suis'
    }))
      form.set(name, value);
    await recordAnswer(raw, testSession('learner-a'), form, 'fr-a1-001');

    const { data, counted } = await loadCounted();

    expect(data).toMatchObject({
      unavailable: false,
      feedback: { outcome: 'correct', answer: 'suis' },
      exercise: { question: { id: 'fr-a1-001@1:q2' } }
    });
    expect(feedbackReads(counted.sqls)).toBe(1);
    expect(counted.sqls.length).toBeLessThanOrEqual(12);
  });

  it('saves an answer in few round trips', async () => {
    const counted: Counted = { sqls: [], peak: 0, together: [] };
    const form = new FormData();
    for (const [name, value] of Object.entries({
      studySessionId: 'study-a',
      submissionKey: 'k1',
      questionId: 'fr-a1-001@1:q1',
      answer: 'suis'
    }))
      form.set(name, value);

    const result = await recordAnswer(
      counting(raw, counted),
      testSession('learner-a'),
      form,
      'fr-a1-001'
    );

    expect(result).toMatchObject({ recorded: true, duplicate: false });
    const stored = await raw.execute(
      `SELECT COUNT(*) AS attempts, COUNT(e.id) AS evaluations FROM attempts a
        LEFT JOIN evaluations e ON e.attempt_id = a.id WHERE a.submission_key = 'k1'`
    );
    expect(stored.rows[0]).toMatchObject({ attempts: 1, evaluations: 1 });
    expect(counted.sqls.length).toBeLessThanOrEqual(ANSWER_BUDGET);
    // Only an assessment can complete from an answer; a practice answer sends
    // neither the count nor the completing update.
    expect(
      counted.sqls.some((sql) => sql.startsWith('UPDATE study_sessions'))
    ).toBe(false);
  });

  it.each([
    ['correct', 'suis', 1],
    ['incorrect', 'es', 0]
  ])(
    'records the ledger row for a %s answer with the ledger reads batched',
    async (_, answer, contribution) => {
      const counted: Counted = { sqls: [], peak: 0, together: [] };
      const form = new FormData();
      for (const [name, value] of Object.entries({
        studySessionId: 'study-a',
        submissionKey: 'k1',
        questionId: 'fr-a1-001@1:q1',
        answer
      }))
        form.set(name, value);

      await recordAnswer(
        counting(raw, counted),
        testSession('learner-a'),
        form,
        'fr-a1-001'
      );

      const evidence = await raw.execute(
        `SELECT e.skill_id, e.contribution FROM skill_evidence e
          JOIN attempts a ON a.id = e.attempt_id WHERE a.submission_key = 'k1'`
      );
      expect(evidence.rows.map((row) => ({ ...row }))).toEqual([
        { skill_id: 'fr-a1-001', contribution }
      ]);
      // The lineage history and the current content go in one batch, so
      // neither content read is sent on its own.
      expect(
        counted.sqls.filter(
          (sql) =>
            sql.includes(
              'SELECT q.skill_id, q.id, q.content_version_id, q.lineage_key'
            ) || sql.includes('FROM skills WHERE language = ? AND retired_at')
        )
      ).toEqual([]);
    }
  );

  it('overlaps the lesson reads with the practice reads', async () => {
    const { counted } = await loadCounted();
    // A lesson-only read and a practice-only read are in flight together, not
    // merely two reads of the same half.
    expect(
      counted.together.some(
        (active) =>
          active.some((sql) => sql.includes('explanation_language')) &&
          active.some((sql) => sql.includes('expected_answer'))
      )
    ).toBe(true);
  });

  it('shows a database failure beside a missing lesson, not a 404', async () => {
    const outage = new Error('synthetic database outage');
    held.client = overriding(raw, {
      execute: (base) => async (statement: InStatement) => {
        const sql = sqlOf(statement);
        if (!sql.includes('AS expected_answer')) return base.execute(statement);
        // The outage lands after the lesson read has already failed.
        await new Promise((resolve) => setTimeout(resolve, 30));
        throw outage;
      }
    });

    await expect(load(pageEvent('study-a', 'fr-a2-unknown'))).rejects.toBe(
      outage
    );
  });

  it('keeps reading nothing about practice without a session', async () => {
    const { data, counted } = await loadCounted('');
    expect(data).toMatchObject({ exercise: null, feedback: null });
    expect(feedbackReads(counted.sqls)).toBe(0);
  });
});

const answerForm = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
};

/** A correct first answer under the retention policy, which asks for a rating. */
async function answeredForRating() {
  await raw.execute({
    sql: 'UPDATE study_sessions SET grammar_retention_policy_version = ? WHERE id = ?',
    args: [GRAMMAR_RETENTION_POLICY_VERSION, 'study-a']
  });
  await recordAnswer(
    raw,
    testSession('learner-a'),
    answerForm({
      studySessionId: 'study-a',
      submissionKey: 'k1',
      questionId: 'fr-a1-001@1:q1',
      answer: 'suis'
    }),
    'fr-a1-001'
  );
  const attempt = await raw.execute(
    "SELECT id FROM attempts WHERE submission_key = 'k1'"
  );
  return String(attempt.rows[0].id);
}

const ratingForm = (attemptId: string, studySessionId = 'study-a') =>
  answerForm({ attemptId, studySessionId, rating: 'good' });

describe('lesson rating round trips', () => {
  it('saves a rating in few round trips and keeps the ledger', async () => {
    const attemptId = await answeredForRating();
    const counted: Counted = { sqls: [], peak: 0, together: [] };

    await ratePracticeAnswer(
      counting(raw, counted),
      testSession('learner-a'),
      ratingForm(attemptId),
      'fr-a1-001'
    );

    const stored = await raw.execute({
      sql: `SELECT a.grammar_rating, COUNT(e.id) AS evidence FROM attempts a
        LEFT JOIN skill_evidence e ON e.attempt_id = a.id WHERE a.id = ?`,
      args: [attemptId]
    });
    expect(stored.rows[0]).toMatchObject({
      grammar_rating: 'good',
      evidence: 1
    });
    expect(counted.sqls.indexOf('commit') + 1).toBeLessThanOrEqual(
      RATING_WRITE_BUDGET
    );
    expect(counted.sqls.length).toBeLessThanOrEqual(RATING_BUDGET);
  });

  it('returns the next question with the rating, so the page need not reload', async () => {
    const attemptId = await answeredForRating();

    const result = await ratePracticeAnswer(
      raw,
      testSession('learner-a'),
      ratingForm(attemptId),
      'fr-a1-001'
    );

    expect(result).toMatchObject({
      rated: true,
      rating: 'good',
      exercise: {
        studySessionId: 'study-a',
        notice: null,
        question: { id: 'fr-a1-001@1:q2' },
        answered: 1
      }
    });
    expect(result).toHaveProperty('exercise.submissionKey');
  });

  it('reloads after a rating in few round trips', async () => {
    const attemptId = await answeredForRating();
    await ratePracticeAnswer(
      raw,
      testSession('learner-a'),
      ratingForm(attemptId),
      'fr-a1-001'
    );

    const { data, counted } = await loadCounted();

    expect(data).toMatchObject({
      feedback: {
        attemptId,
        rating: 'good'
      },
      exercise: { question: { id: 'fr-a1-001@1:q2' } }
    });
    // Assisted retries are removed, so the feedback offers none.
    expect(data.feedback).not.toHaveProperty('retryQuestion');
    expect(counted.sqls.length).toBeLessThanOrEqual(RELOAD_BUDGET);
  });

  it.each([
    ['another skill', { skill: 'fr-a1-002' }],
    ['another session', { session: 'study-b' }],
    ['another learner', { learner: 'learner-b' }],
    ['an assessment session', { assessment: true }]
  ])(
    'refuses a rating through %s',
    async (_, scope: Record<string, unknown>) => {
      const attemptId = await answeredForRating();
      if (scope.assessment)
        await raw.execute(
          "UPDATE study_sessions SET mode = 'assessment' WHERE id = 'study-a'"
        );

      const refused = ratePracticeAnswer(
        raw,
        testSession(String(scope.learner ?? 'learner-a')),
        ratingForm(attemptId, String(scope.session ?? 'study-a')),
        String(scope.skill ?? 'fr-a1-001')
      );

      await expect(refused).rejects.toBeInstanceOf(StudyError);
      await expect(refused).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const stored = await raw.execute({
        sql: 'SELECT grammar_rating FROM attempts WHERE id = ?',
        args: [attemptId]
      });
      expect(stored.rows[0].grammar_rating).toBeNull();
    }
  );
});
