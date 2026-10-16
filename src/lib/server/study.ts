import { randomUUID } from 'node:crypto';
import type { Client, Row } from '@libsql/client';
import { beginWrite, type LearnerSession } from './flashcards';
import { ownSession } from './study-content';
import { StudyError } from './study-error';

export { getLesson, nextQuestion } from './study-content';
export { StudyError };

// Owner-scoped grammar study repository. Every statement on a learner table
// binds owner_id to the learner derived from the verified session; IDs
// supplied by a client only select among that learner's own rows, and
// anything else is NOT_FOUND. Questions and content versions are shared,
// unowned content and are read only to validate an attempt.

type EvidenceKind = 'independent' | 'assisted';
const evidenceKinds: ReadonlySet<unknown> = new Set([
  'independent',
  'assisted'
]);

function toStudySession(row: Row) {
  return {
    id: String(row.id),
    enrollmentId: String(row.enrollment_id),
    language: String(row.language),
    mode: String(row.mode),
    state: String(row.state),
    pausedAt: row.paused_at === null ? null : Number(row.paused_at),
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
  'id, enrollment_id, language, mode, state, paused_at, created_at';

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

type AttemptInput = {
  studySessionId: string;
  questionId: string;
  submissionKey: string;
  evidenceKind: EvidenceKind;
  answer: string;
};
type WriteTransaction = Awaited<ReturnType<typeof beginWrite>>;

/** Reject malformed input before any statement runs. */
function validateAttemptInput(input: AttemptInput) {
  if (!isBoundedText(input.submissionKey, 256) || !input.submissionKey.trim())
    throw new StudyError('INVALID_SUBMISSION_KEY');
  if (!evidenceKinds.has(input.evidenceKind))
    throw new StudyError('INVALID_EVIDENCE_KIND');
  if (!isBoundedText(input.answer, 4096))
    throw new StudyError('INVALID_ANSWER');
  if (
    typeof input.studySessionId !== 'string' ||
    typeof input.questionId !== 'string'
  )
    throw new StudyError('NOT_FOUND');
}

/** The caller's earlier attempt under this submission key, if any. */
async function replayAttempt(
  tx: WriteTransaction,
  session: LearnerSession,
  input: AttemptInput
) {
  const previous = await tx.execute({
    sql: 'SELECT id, study_session_id, question_id, evidence_kind, answer FROM attempts WHERE owner_id = ? AND submission_key = ?',
    args: [session.userId, input.submissionKey]
  });
  const prior = previous.rows[0];
  if (!prior) return null;
  const samePayload =
    prior.study_session_id === input.studySessionId &&
    prior.question_id === input.questionId &&
    prior.evidence_kind === input.evidenceKind &&
    prior.answer === input.answer;
  if (!samePayload) throw new StudyError('IDEMPOTENCY_CONFLICT');
  return { id: String(prior.id), duplicate: true };
}

/** The question in the session's language, if it is available in this mode. */
async function availableQuestion(
  tx: WriteTransaction,
  input: AttemptInput,
  studyRow: Row
) {
  const question = await tx.execute({
    sql: 'SELECT q.content_version_id, q.skill_id, q.holdout, v.status FROM questions q JOIN content_versions v ON v.id = q.content_version_id WHERE q.id = ? AND q.language = ?',
    args: [input.questionId, studyRow.language]
  });
  const questionRow = question.rows[0];
  if (!questionRow) throw new StudyError('NOT_FOUND');
  // Withdrawn content is unavailable; assessment holdouts cannot enter practice.
  if (
    questionRow.status === 'quarantined' ||
    (questionRow.holdout === 1 && studyRow.mode !== 'assessment')
  )
    throw new StudyError('CONTENT_UNAVAILABLE');
  return questionRow;
}

/**
 * The first answer pins a skill to a version for the session. A tab still
 * holding a question from another version would record evidence the resume
 * position can no longer see.
 */
async function assertSessionVersion(
  tx: WriteTransaction,
  session: LearnerSession,
  input: AttemptInput,
  questionRow: Row
) {
  const pinned = await tx.execute({
    sql: 'SELECT content_version_id FROM attempts WHERE owner_id = ? AND study_session_id = ? AND skill_id = ? ORDER BY created_at, id LIMIT 1',
    args: [session.userId, input.studySessionId, questionRow.skill_id]
  });
  const version = pinned.rows[0]?.content_version_id;
  if (version !== undefined && version !== questionRow.content_version_id)
    throw new StudyError('STALE_QUESTION');
}

/** The caller's active session and an available question in its language. */
async function attemptSource(
  tx: WriteTransaction,
  session: LearnerSession,
  input: AttemptInput
) {
  const study = await tx.execute({
    sql: 'SELECT language, state, mode FROM study_sessions WHERE id = ? AND owner_id = ?',
    args: [input.studySessionId, session.userId]
  });
  const studyRow = study.rows[0];
  if (!studyRow) throw new StudyError('NOT_FOUND');
  if (studyRow.state !== 'active') throw new StudyError('SESSION_NOT_ACTIVE');
  const questionRow = await availableQuestion(tx, input, studyRow);
  await assertSessionVersion(tx, session, input, questionRow);
  return {
    contentVersionId: String(questionRow.content_version_id),
    skillId: String(questionRow.skill_id),
    language: String(studyRow.language)
  };
}

/**
 * A question takes one independent answer per session, whichever tab sent it;
 * the database index enforces the same rule for writes outside this service.
 */
async function assertNotAnswered(
  tx: WriteTransaction,
  session: LearnerSession,
  input: AttemptInput
) {
  if (input.evidenceKind !== 'independent') return;
  const answered = await tx.execute({
    sql: "SELECT 1 FROM attempts WHERE owner_id = ? AND study_session_id = ? AND question_id = ? AND evidence_kind = 'independent'",
    args: [session.userId, input.studySessionId, input.questionId]
  });
  if (answered.rows[0]) throw new StudyError('QUESTION_ALREADY_ANSWERED');
}

/**
 * Record an answer in the caller's own active study session. The submission
 * key is idempotent per owner: a replay with the same payload returns the
 * original attempt, and a different payload is IDEMPOTENCY_CONFLICT.
 */
export async function recordAttempt(
  client: Client,
  session: LearnerSession,
  input: AttemptInput
) {
  validateAttemptInput(input);
  const tx = await beginWrite(client);
  try {
    const replay = await replayAttempt(tx, session, input);
    if (replay) {
      await tx.commit();
      return replay;
    }
    const source = await attemptSource(tx, session, input);
    await assertNotAnswered(tx, session, input);
    const id = randomUUID();
    await tx.execute({
      sql: 'INSERT INTO attempts (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [
        id,
        session.userId,
        input.studySessionId,
        input.questionId,
        source.contentVersionId,
        source.skillId,
        source.language,
        input.submissionKey,
        input.evidenceKind,
        input.answer
      ]
    });
    await tx.commit();
    return { id, duplicate: false };
  } catch (error) {
    // A failed rollback must not replace the error that caused it.
    await tx.rollback().catch(() => undefined);
    throw error;
  } finally {
    tx.close();
  }
}

/**
 * Pause the caller's own session. A repeat keeps the first pause time; there
 * is no expiry, so a session can be resumed after any length of time.
 */
export async function pauseStudySession(
  client: Client,
  session: LearnerSession,
  studySessionId: string,
  now: number = Date.now()
) {
  const { state } = await ownSession(client, session, studySessionId);
  if (state === 'completed') throw new StudyError('SESSION_NOT_ACTIVE');
  const paused = await client.execute({
    sql: "UPDATE study_sessions SET state = 'paused', paused_at = COALESCE(paused_at, ?) WHERE id = ? AND owner_id = ? AND state <> 'completed'",
    args: [now, studySessionId, session.userId]
  });
  // The session completed between the lookup and the write.
  if (paused.rowsAffected === 0) throw new StudyError('SESSION_NOT_ACTIVE');
  return getStudySession(client, session, studySessionId);
}

/** Resume the caller's own paused (or already active) session. */
export async function resumeStudySession(
  client: Client,
  session: LearnerSession,
  studySessionId: string
) {
  const { state } = await ownSession(client, session, studySessionId);
  if (state === 'completed') throw new StudyError('SESSION_NOT_ACTIVE');
  const resumed = await client.execute({
    sql: "UPDATE study_sessions SET state = 'active', paused_at = NULL WHERE id = ? AND owner_id = ? AND state <> 'completed'",
    args: [studySessionId, session.userId]
  });
  // The session completed between the lookup and the write.
  if (resumed.rowsAffected === 0) throw new StudyError('SESSION_NOT_ACTIVE');
  return getStudySession(client, session, studySessionId);
}
