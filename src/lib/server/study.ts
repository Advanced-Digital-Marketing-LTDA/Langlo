import { randomUUID } from 'node:crypto';
import type { Client, Row } from '@libsql/client';
import { beginWrite, type LearnerSession } from './flashcards';

// Owner-scoped grammar study repository. Every statement on a learner table
// binds owner_id to the learner derived from the verified session; IDs
// supplied by a client only select among that learner's own rows, and
// anything else is NOT_FOUND. Questions and content versions are shared,
// unowned content and are read only to validate an attempt.

type EvidenceKind = 'independent' | 'assisted';
const evidenceKinds: readonly string[] = ['independent', 'assisted'];

export class StudyError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function toStudySession(row: Row) {
  return {
    id: String(row.id),
    enrollmentId: String(row.enrollment_id),
    language: String(row.language),
    mode: String(row.mode),
    state: String(row.state),
    createdAt: Number(row.created_at)
  };
}

function toAttempt(row: Row) {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    studySessionId: String(row.study_session_id),
    questionId: String(row.question_id),
    contentVersionId: String(row.content_version_id),
    skillId: String(row.skill_id),
    language: String(row.language),
    submissionKey: String(row.submission_key),
    evidenceKind: String(row.evidence_kind),
    answer: String(row.answer),
    createdAt: Number(row.created_at)
  };
}

function toEvaluation(row: Row) {
  return {
    id: String(row.id),
    attemptId: String(row.attempt_id),
    evaluatorVersion: String(row.evaluator_version),
    rubricVersion: String(row.rubric_version),
    outcome: String(row.outcome),
    createdAt: Number(row.created_at)
  };
}

const studySessionColumns =
  'id, enrollment_id, language, mode, state, created_at';

export async function listStudySessions(
  client: Client,
  session: LearnerSession
) {
  const result = await client.execute({
    sql: `SELECT ${studySessionColumns} FROM study_sessions WHERE owner_id = ? ORDER BY created_at, id`,
    args: [session.userId]
  });
  return result.rows.map(toStudySession);
}

export async function getStudySession(
  client: Client,
  session: LearnerSession,
  studySessionId: string
) {
  const result = await client.execute({
    sql: `SELECT ${studySessionColumns} FROM study_sessions WHERE id = ? AND owner_id = ?`,
    args: [studySessionId, session.userId]
  });
  if (!result.rows[0]) throw new StudyError('NOT_FOUND');
  return toStudySession(result.rows[0]);
}

export async function listAttempts(
  client: Client,
  session: LearnerSession,
  studySessionId: string
) {
  const [owned, attempts] = await client.batch(
    [
      {
        sql: 'SELECT 1 FROM study_sessions WHERE id = ? AND owner_id = ?',
        args: [studySessionId, session.userId]
      },
      {
        sql: 'SELECT * FROM attempts WHERE owner_id = ? AND study_session_id = ? ORDER BY created_at, id',
        args: [session.userId, studySessionId]
      }
    ],
    'read'
  );
  if (!owned.rows[0]) throw new StudyError('NOT_FOUND');
  return attempts.rows.map(toAttempt);
}

export async function listEvaluations(
  client: Client,
  session: LearnerSession,
  attemptId: string
) {
  const [owned, evaluations] = await client.batch(
    [
      {
        sql: 'SELECT 1 FROM attempts WHERE id = ? AND owner_id = ?',
        args: [attemptId, session.userId]
      },
      {
        sql: 'SELECT * FROM evaluations WHERE owner_id = ? AND attempt_id = ? ORDER BY created_at, id',
        args: [session.userId, attemptId]
      }
    ],
    'read'
  );
  if (!owned.rows[0]) throw new StudyError('NOT_FOUND');
  return evaluations.rows.map(toEvaluation);
}

export async function getAttempt(
  client: Client,
  session: LearnerSession,
  attemptId: string
) {
  const [attempt, evaluations] = await client.batch(
    [
      {
        sql: 'SELECT * FROM attempts WHERE id = ? AND owner_id = ?',
        args: [attemptId, session.userId]
      },
      {
        sql: 'SELECT * FROM evaluations WHERE owner_id = ? AND attempt_id = ? ORDER BY created_at, id',
        args: [session.userId, attemptId]
      }
    ],
    'read'
  );
  if (!attempt.rows[0]) throw new StudyError('NOT_FOUND');
  return {
    ...toAttempt(attempt.rows[0]),
    evaluations: evaluations.rows.map(toEvaluation)
  };
}

function isBoundedText(value: unknown, limit: number): value is string {
  return (
    typeof value === 'string' &&
    !value.includes('\0') &&
    value.length <= limit * 2 &&
    Array.from(value).length <= limit
  );
}

/**
 * Record an answer in the caller's own active study session. The submission
 * key is idempotent per owner: a replay with the same payload returns the
 * original attempt, and a different payload is IDEMPOTENCY_CONFLICT.
 */
export async function recordAttempt(
  client: Client,
  session: LearnerSession,
  input: {
    studySessionId: string;
    questionId: string;
    submissionKey: string;
    evidenceKind: EvidenceKind;
    answer: string;
  }
) {
  if (!isBoundedText(input.submissionKey, 256) || !input.submissionKey.trim())
    throw new StudyError('INVALID_SUBMISSION_KEY');
  if (
    typeof input.evidenceKind !== 'string' ||
    !evidenceKinds.includes(input.evidenceKind)
  )
    throw new StudyError('INVALID_EVIDENCE_KIND');
  if (!isBoundedText(input.answer, 4096))
    throw new StudyError('INVALID_ANSWER');
  if (
    typeof input.studySessionId !== 'string' ||
    typeof input.questionId !== 'string'
  )
    throw new StudyError('NOT_FOUND');

  const tx = await beginWrite(client);
  try {
    const previous = await tx.execute({
      sql: 'SELECT id, study_session_id, question_id, evidence_kind, answer FROM attempts WHERE owner_id = ? AND submission_key = ?',
      args: [session.userId, input.submissionKey]
    });
    const prior = previous.rows[0];
    if (prior) {
      if (
        prior.study_session_id !== input.studySessionId ||
        prior.question_id !== input.questionId ||
        prior.evidence_kind !== input.evidenceKind ||
        prior.answer !== input.answer
      )
        throw new StudyError('IDEMPOTENCY_CONFLICT');
      await tx.commit();
      return { id: String(prior.id), duplicate: true };
    }

    const study = await tx.execute({
      sql: 'SELECT language, state FROM study_sessions WHERE id = ? AND owner_id = ?',
      args: [input.studySessionId, session.userId]
    });
    const studyRow = study.rows[0];
    if (!studyRow) throw new StudyError('NOT_FOUND');
    if (studyRow.state !== 'active') throw new StudyError('SESSION_NOT_ACTIVE');

    const question = await tx.execute({
      sql: 'SELECT q.content_version_id, q.skill_id, v.status FROM questions q JOIN content_versions v ON v.id = q.content_version_id WHERE q.id = ? AND q.language = ?',
      args: [input.questionId, studyRow.language]
    });
    const questionRow = question.rows[0];
    if (!questionRow) throw new StudyError('NOT_FOUND');
    // Quarantined content is withdrawn: no new learner history may cite it.
    if (questionRow.status === 'quarantined')
      throw new StudyError('CONTENT_UNAVAILABLE');

    const id = randomUUID();
    await tx.execute({
      sql: 'INSERT INTO attempts (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [
        id,
        session.userId,
        input.studySessionId,
        input.questionId,
        String(questionRow.content_version_id),
        String(questionRow.skill_id),
        String(studyRow.language),
        input.submissionKey,
        input.evidenceKind,
        input.answer
      ]
    });
    await tx.commit();
    return { id, duplicate: false };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}
