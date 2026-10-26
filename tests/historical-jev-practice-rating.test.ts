import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import type { RuntimeConfig } from '../src/lib/server/config';
import { openFixtureDatabase } from '../src/lib/server/db/connection';
import { pauseStudySession, resumeStudySession } from '../src/lib/server/study';
import { practiceFor } from '../src/lib/server/lesson-practice';
import { startPractice } from '../src/lib/server/practice';
import { GRAMMAR_RETENTION_POLICY_VERSION } from '../src/lib/server/grammar-retention';
import { importContent } from '../src/lib/server/content-import';
import { approvedPackage } from './fixtures/content-package';
import {
  disposeFlashcardFixtures,
  fixture,
  testSession
} from './fixtures/flashcards';
import { actions as lessonActions } from '../src/routes/app/learn/[language]/lesson/[skill]/+page.server';

const learner = testSession('learner-a');
let client: Client;
let close: () => void;
let databaseUrl: string;

beforeEach(async () => {
  const target = await fixture();
  databaseUrl = target.databaseUrl;
  ({ client, close } = await openFixtureDatabase(target));
  await client.execute("INSERT INTO users (id) VALUES ('fresh')");
});

afterEach(async () => {
  close?.();
  await disposeFlashcardFixtures();
});

function event(options: {
  params?: Record<string, string>;
  fields?: Record<string, string>;
}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(options.fields ?? {}))
    form.set(key, value);
  const url = 'http://127.0.0.1/app';
  return {
    params: options.params ?? {},
    url: new URL(url),
    locals: {
      correlationId: '12345678-1234-4123-8123-123456789abc',
      user: { id: learner.userId },
      session: { userId: learner.userId },
      config: { dataEnabled: true, databaseUrl } as RuntimeConfig
    },
    request: new Request(
      url,
      options.fields ? { method: 'POST', body: form } : undefined
    )
  } as never;
}

async function closeSeededPractice() {
  await client.execute(
    "UPDATE study_sessions SET state = 'completed' WHERE id = 'study-a'"
  );
}

describe('historical Jev practice rating', () => {
  beforeEach(async () => {
    await closeSeededPractice();
    const content = approvedPackage();
    for (const version of content.versions)
      version.lesson = {
        title: 'Synthetic lesson',
        explanation: 'Synthetic explanation',
        examples: [],
        references: []
      };
    await importContent(client, content);
  });

  async function resumedPendingGrammarAttempt(options: {
    evaluatorVersion: 'jev-1' | 'jev-2';
    outcome: 'correct' | 'incorrect' | 'uncertain';
    historicalOutcome?: 'correct' | 'incorrect' | 'uncertain';
    evidenceKind?: 'independent' | 'assisted';
    receivedHelp?: boolean;
  }) {
    const session = await startPractice(client, learner, {
      language: 'fr',
      submissionKey: randomUUID()
    });
    await client.execute({
      sql: 'UPDATE study_sessions SET grammar_retention_policy_version = ? WHERE id = ?',
      args: [GRAMMAR_RETENTION_POLICY_VERSION, session.id]
    });
    const attemptId = randomUUID();
    await client.execute({
      sql: `INSERT INTO attempts
        (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language,
         submission_key, evidence_kind, answer, received_help)
        VALUES (?, ?, ?, 'fr-a1-001@1:q2', 'fr-a1-001@1', 'fr-a1-001', 'fr', ?, ?, 'es', ?)`,
      args: [
        attemptId,
        learner.userId,
        session.id,
        randomUUID(),
        options.evidenceKind ?? 'independent',
        options.receivedHelp ?? false
      ]
    });
    const evaluations = [
      {
        sql: `INSERT INTO evaluations
          (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome)
          VALUES (?, ?, ?, 'prepared-1', 'fr-a1-001@1', 'uncertain')`,
        args: [`prepared-${attemptId}`, learner.userId, attemptId]
      },
      {
        sql: `INSERT INTO evaluations
          (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome)
          VALUES (?, ?, ?, ?, 'jev-rubric-1:fr-a1-001@1', ?)`,
        args: [
          `fallback-${attemptId}`,
          learner.userId,
          attemptId,
          options.evaluatorVersion,
          options.outcome
        ]
      }
    ];
    if (options.historicalOutcome && options.evaluatorVersion === 'jev-2')
      evaluations.push({
        sql: `INSERT INTO evaluations
          (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome)
          VALUES (?, ?, ?, 'jev-1', 'jev-rubric-1:fr-a1-001@1', ?)`,
        args: [
          `historical-${attemptId}`,
          learner.userId,
          attemptId,
          options.historicalOutcome
        ]
      });
    await client.batch(evaluations, 'write');
    await pauseStudySession(client, learner, session.id);
    await resumeStudySession(client, learner, session.id);
    return { session, attemptId };
  }

  it('rates a resumed historical Jev correct answer without adding mastery evidence', async () => {
    const { session, attemptId } = await resumedPendingGrammarAttempt({
      evaluatorVersion: 'jev-1',
      outcome: 'correct'
    });
    const params = { language: 'fr', skill: 'fr-a1-001' };

    const resumed = await practiceFor(client, learner, session.id, 'fr-a1-001');
    expect(resumed.feedback).toMatchObject({
      attemptId,
      outcome: 'correct',
      requiresRating: true,
      rating: null,
      receivedHelp: false
    });
    expect(resumed.exercise).toMatchObject({
      question: null
    });
    expect(resumed.exercise?.notice).toBeTruthy();

    expect(
      await lessonActions.rate(
        event({
          params,
          fields: { attemptId, studySessionId: session.id, rating: 'good' }
        })
      )
    ).toMatchObject({
      rated: true,
      rating: 'good',
      exercise: {
        notice: null,
        question: { id: 'fr-a1-001@1:q1' }
      }
    });
    expect(
      (
        await client.execute({
          sql: 'SELECT grammar_rating FROM attempts WHERE id = ?',
          args: [attemptId]
        })
      ).rows
    ).toEqual([{ grammar_rating: 'good' }]);
    expect(
      (
        await client.execute({
          sql: 'SELECT attempt_id FROM skill_evidence WHERE attempt_id = ?',
          args: [attemptId]
        })
      ).rows
    ).toEqual([]);
  });

  it('continues to rate a current Jev correct answer', async () => {
    const { session, attemptId } = await resumedPendingGrammarAttempt({
      evaluatorVersion: 'jev-2',
      outcome: 'correct'
    });
    const rated = await lessonActions.rate(
      event({
        params: { language: 'fr', skill: 'fr-a1-001' },
        fields: { attemptId, studySessionId: session.id, rating: 'hard' }
      })
    );
    expect(rated).toMatchObject({
      rated: true,
      rating: 'hard',
      exercise: { notice: null, question: { id: 'fr-a1-001@1:q1' } }
    });
  });

  it('does not let historical Jev correct feedback override a current uncertain verdict', async () => {
    const { session, attemptId } = await resumedPendingGrammarAttempt({
      evaluatorVersion: 'jev-2',
      outcome: 'uncertain',
      historicalOutcome: 'correct'
    });
    const resumed = await practiceFor(client, learner, session.id, 'fr-a1-001');
    expect(resumed.feedback).toMatchObject({ attemptId, outcome: 'uncertain' });
    expect(resumed.exercise).toMatchObject({
      notice: null,
      question: { id: 'fr-a1-001@1:q1' }
    });
    expect(
      await lessonActions.rate(
        event({
          params: { language: 'fr', skill: 'fr-a1-001' },
          fields: { attemptId, studySessionId: session.id, rating: 'good' }
        })
      )
    ).toMatchObject({ status: 400 });
  });

  it('does not require a rating for an incorrect historical Jev answer', async () => {
    const { session, attemptId } = await resumedPendingGrammarAttempt({
      evaluatorVersion: 'jev-1',
      outcome: 'incorrect'
    });
    const resumed = await practiceFor(client, learner, session.id, 'fr-a1-001');
    expect(resumed.feedback).toMatchObject({
      attemptId,
      outcome: 'incorrect',
      rating: null
    });
    expect(resumed.exercise).toMatchObject({
      notice: null,
      question: { id: 'fr-a1-001@1:q1' }
    });
    expect(
      await lessonActions.rate(
        event({
          params: { language: 'fr', skill: 'fr-a1-001' },
          fields: { attemptId, studySessionId: session.id, rating: 'good' }
        })
      )
    ).toMatchObject({ status: 400 });
  });

  it('does not require or allow a rating for an assisted historical Jev answer', async () => {
    const { session, attemptId } = await resumedPendingGrammarAttempt({
      evaluatorVersion: 'jev-1',
      outcome: 'correct',
      evidenceKind: 'assisted',
      receivedHelp: true
    });
    const resumed = await practiceFor(client, learner, session.id, 'fr-a1-001');
    expect(resumed.feedback).toMatchObject({
      attemptId,
      outcome: 'correct',
      rating: null,
      receivedHelp: true
    });
    expect(resumed.exercise).toMatchObject({
      notice: null,
      question: { id: 'fr-a1-001@1:q1' }
    });
    expect(
      await lessonActions.rate(
        event({
          params: { language: 'fr', skill: 'fr-a1-001' },
          fields: { attemptId, studySessionId: session.id, rating: 'good' }
        })
      )
    ).toMatchObject({ status: 404 });
  });
});
