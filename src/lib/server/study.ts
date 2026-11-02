import { randomUUID } from 'node:crypto';
import type { Client, InStatement, Row } from '@libsql/client';
import {
  evaluatePrepared,
  PREPARED_EVALUATOR_VERSION
} from './evaluation/prepared';
import { formats } from './content-import';
import {
  FALLBACK_EVALUATOR_VERSION,
  FALLBACK_RUBRIC_VERSION,
  FALLBACK_SETTLED_EVALUATOR_VERSION,
  HISTORICAL_JEV_EVALUATOR_VERSION,
  HISTORICAL_JEV_RUBRIC_VERSION,
  type FallbackReason
} from './evaluation/fallback';
import type { FallbackEvaluator } from './evaluation/runtime';
import { beginWrite, executeWrite, type LearnerSession } from './flashcards';
import {
  seedLineageKeys,
  syncEvidenceLedger,
  syncLineageEvidence
} from './mastery';
import {
  commitGrammarSessionReviews,
  GRAMMAR_RETENTION_POLICY_VERSION,
  type GrammarRating
} from './grammar-retention';
import { currentCorrelationId } from './request-context';
import { ownSession } from './study-content';
import { StudyError } from './study-error';
import { span } from './tracing';
import type { ExerciseFormat } from '../components/exercises/answer';
import {
  assertAssessmentQuestion,
  completeAssessment,
  feedbackEvaluation,
  provisionalCorrectAttempt
} from './assessment';

export { getLesson, getSessionLesson, nextQuestion } from './study-content';
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
    notSure: Boolean(row.not_sure),
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

// Every learner-facing evaluation read observes assessment completion in SQL.
const visibleEvaluations = `SELECT e.* FROM evaluations e
  JOIN attempts a ON a.id = e.attempt_id AND a.owner_id = e.owner_id
  JOIN study_sessions s ON s.id = a.study_session_id AND s.owner_id = a.owner_id
  WHERE e.owner_id = ? AND e.attempt_id = ?
    AND (s.mode <> 'assessment' OR s.state = 'completed' OR (
      s.assessment_plan IS NOT NULL AND (
        NOT EXISTS (SELECT 1 FROM json_each(s.assessment_plan, '$.questions') p
          WHERE NOT EXISTS (SELECT 1 FROM attempts planned WHERE planned.owner_id = s.owner_id
            AND planned.study_session_id = s.id AND planned.question_id = p.value))
        OR (SELECT COUNT(DISTINCT answered.question_id) FROM attempts answered
          WHERE answered.owner_id = s.owner_id AND answered.study_session_id = s.id
            AND answered.not_sure = 1) >= 5
      )))
  ORDER BY e.created_at, e.id`;

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
        sql: visibleEvaluations,
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
        sql: visibleEvaluations,
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
  notSure?: boolean;
};
type WriteTransaction = Awaited<ReturnType<typeof beginWrite>>;

/** Non-blank text within the length bound. */
const isFilledText = (value: unknown, limit: number) =>
  isBoundedText(value, limit) && value.trim() !== '';

/** The first malformed field of an attempt, in the order they are checked. */
function attemptInputProblem(input: AttemptInput) {
  if (!isFilledText(input.submissionKey, 256)) return 'INVALID_SUBMISSION_KEY';
  if (!evidenceKinds.has(input.evidenceKind)) return 'INVALID_EVIDENCE_KIND';
  if (input.notSure !== undefined && typeof input.notSure !== 'boolean')
    return 'INVALID_ANSWER';
  if (input.notSure ? input.answer !== '' : !isFilledText(input.answer, 4096))
    return 'INVALID_ANSWER';
  if (
    typeof input.studySessionId !== 'string' ||
    typeof input.questionId !== 'string'
  )
    return 'NOT_FOUND';
  return null;
}

/** Reject malformed input before any statement runs. */
function validateAttemptInput(input: AttemptInput) {
  const problem = attemptInputProblem(input);
  if (problem) throw new StudyError(problem);
}

const replayStatement = (
  session: LearnerSession,
  input: AttemptInput
): InStatement => ({
  sql: 'SELECT id, study_session_id, question_id, evidence_kind, answer, not_sure FROM attempts WHERE owner_id = ? AND submission_key = ?',
  args: [session.userId, input.submissionKey]
});

/**
 * The reads an attempt starts with. They do not depend on one another, so a
 * write transaction fetches them in one round trip instead of one each.
 */
type Preread = {
  replay: Row[];
  study: Row[];
  answered: Row[] | null;
  priorEvidence: Row[] | null;
};

/** Run named statements in one round trip; each result is read back by its name. */
async function batchRows(
  tx: WriteTransaction,
  statements: Record<string, InStatement>
) {
  const names = Object.keys(statements);
  const results = await tx.batch(names.map((name) => statements[name]));
  return new Map(names.map((name, index) => [name, results[index].rows]));
}

async function prereadAttempt(
  tx: WriteTransaction,
  session: LearnerSession,
  input: AttemptInput
): Promise<Preread> {
  const independent = input.evidenceKind === 'independent';
  const rows = await batchRows(tx, {
    replay: replayStatement(session, input),
    study: studySessionStatement(session, input),
    ...(independent
      ? {
          answered: answeredStatement(session, input),
          priorEvidence: priorEvidenceStatement(session, input)
        }
      : {})
  });
  const named = (name: string) => rows.get(name) ?? null;
  const replay = named('replay');
  const study = named('study');
  if (!replay || !study)
    throw new Error('The attempt pre-reads did not return their results');
  return {
    replay,
    study,
    answered: named('answered'),
    priorEvidence: named('priorEvidence')
  };
}

/** Whether an earlier attempt carries this payload; the kind is derived only when it matters. */
async function isSamePayload(
  prior: Row,
  input: AttemptInput,
  kind: () => Promise<EvidenceKind>
) {
  if (prior.study_session_id !== input.studySessionId) return false;
  if (prior.question_id !== input.questionId) return false;
  const sameKind =
    prior.evidence_kind === input.evidenceKind ||
    prior.evidence_kind === (await kind());
  return (
    sameKind &&
    Boolean(prior.not_sure) === Boolean(input.notSure) &&
    prior.answer === input.answer
  );
}

/** The caller's earlier attempt under this submission key, if any. */
async function replayAttempt(
  tx: Pick<Client, 'execute'>,
  session: LearnerSession,
  input: AttemptInput,
  preread?: Preread
) {
  const previous = preread
    ? preread.replay
    : (await tx.execute(replayStatement(session, input))).rows;
  const prior = previous[0];
  if (!prior) return null;
  const kind = preread
    ? async () => evidenceKindFrom(input, preread.priorEvidence)
    : () => evidenceKindFor(tx, session, input);
  if (!(await isSamePayload(prior, input, kind)))
    throw new StudyError('IDEMPOTENCY_CONFLICT');
  return { id: String(prior.id), duplicate: true };
}

/**
 * The caller's earlier attempt under this submission key, when the payload is
 * the same, so a retry can be answered with the original result before the
 * session's current question is consulted. Null when the key is new.
 */
export async function findReplay(
  client: Pick<Client, 'execute'>,
  session: LearnerSession,
  input: AttemptInput
) {
  validateAttemptInput(input);
  return replayAttempt(client, session, input);
}

/** Withdrawn content is unavailable; assessment holdouts cannot enter practice. */
const isWithheld = (question: Row, mode: unknown) =>
  question.status === 'quarantined' ||
  (question.holdout === 1 && mode !== 'assessment');

/** The question in the session's language, if it is available in this mode. */
async function availableQuestion(
  tx: WriteTransaction,
  input: AttemptInput,
  studyRow: Row
) {
  const question = await tx.execute({
    sql: 'SELECT q.content_version_id, q.skill_id, q.holdout, q.format, q.prompt, q.answer, q.alternatives, v.status, sk.retired_at FROM questions q JOIN content_versions v ON v.id = q.content_version_id JOIN skills sk ON sk.id = q.skill_id AND sk.language = q.language WHERE q.id = ? AND q.language = ?',
    args: [input.questionId, studyRow.language]
  });
  const questionRow = question.rows[0];
  if (!questionRow) throw new StudyError('NOT_FOUND');
  if (questionRow.retired_at !== null)
    throw new StudyError('CONTENT_UNAVAILABLE');
  if (isWithheld(questionRow, studyRow.mode))
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

async function assertGrammarReviewQuestion(
  tx: WriteTransaction,
  session: LearnerSession,
  input: AttemptInput,
  questionRow: Row
) {
  const planned = await tx.execute({
    sql: `SELECT 1 FROM study_sessions s JOIN json_each(s.grammar_retention_plan, '$.questions') p
        WHERE s.id = ? AND s.owner_id = ? AND s.mode = 'mixed-review'
          AND s.grammar_retention_policy_version = ?
          AND json_extract(p.value, '$.skillId') = ?
          AND json_extract(p.value, '$.questionId') = ?
          AND json_extract(p.value, '$.contentVersionId') = ?`,
    args: [
      input.studySessionId,
      session.userId,
      GRAMMAR_RETENTION_POLICY_VERSION,
      questionRow.skill_id,
      input.questionId,
      questionRow.content_version_id
    ]
  });
  if (!planned.rows.length) throw new StudyError('STALE_QUESTION');
}

/** The caller's active session and an available question in its language. */
const studySessionStatement = (
  session: LearnerSession,
  input: AttemptInput
): InStatement => ({
  sql: 'SELECT language, state, mode, assessment_plan, grammar_retention_plan, grammar_retention_policy_version FROM study_sessions WHERE id = ? AND owner_id = ?',
  args: [input.studySessionId, session.userId]
});

async function attemptSource(
  tx: WriteTransaction,
  session: LearnerSession,
  input: AttemptInput,
  preread: Preread
) {
  const studyRow = preread.study[0];
  if (!studyRow) throw new StudyError('NOT_FOUND');
  if (studyRow.state !== 'active') throw new StudyError('SESSION_NOT_ACTIVE');
  if (studyRow.assessment_plan !== null)
    await assertAssessmentQuestion(
      tx,
      session,
      input.studySessionId,
      input.questionId
    );
  const questionRow = await availableQuestion(tx, input, studyRow);
  await assertSessionVersion(tx, session, input, questionRow);
  if (studyRow.grammar_retention_plan !== null)
    await assertGrammarReviewQuestion(tx, session, input, questionRow);
  return {
    contentVersionId: String(questionRow.content_version_id),
    skillId: String(questionRow.skill_id),
    language: String(studyRow.language),
    mode: String(studyRow.mode),
    assessment: studyRow.assessment_plan !== null,
    grammarRetentionPolicyVersion:
      studyRow.grammar_retention_policy_version === null
        ? null
        : String(studyRow.grammar_retention_policy_version),
    question: questionRow
  };
}

const knownFormats: ReadonlySet<unknown> = new Set(formats);

/**
 * The stored rubric of a question, checked: corrupted rows fail loudly
 * instead of being graded with a guessed rule.
 */
function preparedQuestion(questionId: string, row: Row) {
  const invalid = (field: string) =>
    new Error(`Question ${questionId} has invalid ${field}`);
  if (!knownFormats.has(row.format)) throw invalid('format');
  let alternatives: unknown = [];
  if (row.alternatives !== null) {
    try {
      alternatives = JSON.parse(String(row.alternatives));
    } catch {
      throw invalid('alternatives');
    }
  }
  if (
    !Array.isArray(alternatives) ||
    !alternatives.every((item) => typeof item === 'string')
  )
    throw invalid('alternatives');
  if (row.answer !== null && typeof row.answer !== 'string')
    throw invalid('answer');
  return {
    format: row.format as ExerciseFormat,
    answer: row.answer,
    alternatives: alternatives as string[]
  };
}

type PreparedAttempt = {
  id: string;
  questionId: string;
  answer: string;
  contentVersionId: string;
  question: Row;
  notSure?: boolean;
};

/** What the question's own rubric says about the answer; nothing is read. */
function preparedOutcome(attempt: PreparedAttempt) {
  return attempt.notSure
    ? 'uncertain'
    : evaluatePrepared(
        preparedQuestion(attempt.questionId, attempt.question),
        attempt.answer
      );
}

/**
 * The prepared evaluation of a new attempt, recorded in the transaction that
 * saves the attempt. The rubric is the content version whose answer and
 * alternatives were compared.
 */
function preparedEvaluationStatement(
  session: LearnerSession,
  attempt: PreparedAttempt,
  outcome: string
): InStatement {
  return {
    sql: 'INSERT INTO evaluations (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome) VALUES (?, ?, ?, ?, ?, ?)',
    args: [
      randomUUID(),
      session.userId,
      attempt.id,
      PREPARED_EVALUATOR_VERSION,
      attempt.contentVersionId,
      outcome
    ]
  };
}

/** Loud, content-free log line: never the answer, prompt or learner. */
function logFallback(reason: FallbackReason | 'not-configured' | 'failed') {
  console.warn(
    JSON.stringify({
      operation: 'ai-fallback',
      reason,
      correlationId: currentCorrelationId() || undefined
    })
  );
}

type FallbackAttempt = {
  id: string;
  studySessionId: string;
  mode: string;
  grammarRetentionPolicyVersion: string | null;
  questionId: string;
  answer: string;
  contentVersionId: string;
  language: string;
  question: Row;
};

/** Record that the fallback is finished without a verdict, so results stop waiting for it. */
async function finishFallback(
  tx: WriteTransaction,
  session: LearnerSession,
  attempt: FallbackAttempt,
  attemptOnly: boolean
) {
  const completed =
    attempt.mode === 'assessment' &&
    (await completeAssessment(tx, session, attempt.studySessionId));
  if (completed) {
    await syncEvidenceLedger(tx, {
      ownerId: session.userId,
      language: attempt.language,
      studySessionId: attempt.studySessionId
    });
    await commitGrammarSessionReviews(tx, session, attempt.studySessionId);
  } else if (attemptOnly) {
    await syncEvidenceLedger(tx, {
      ownerId: session.userId,
      language: attempt.language,
      attemptIds: [attempt.id]
    });
  }
}

function isRetentionAssessment(attempt: FallbackAttempt) {
  return (
    attempt.mode === 'assessment' &&
    attempt.grammarRetentionPolicyVersion === GRAMMAR_RETENTION_POLICY_VERSION
  );
}

/**
 * Whether grading that ends without a verdict is recorded for every answer:
 * retention assessments and grammar reviews wait on it. Other practice
 * answers stay unmarked.
 */
function marksGradingDone(attempt: FallbackAttempt) {
  return isRetentionAssessment(attempt) || attempt.mode === 'mixed-review';
}

async function settleFallback(
  client: Client,
  session: LearnerSession,
  attempt: FallbackAttempt,
  retentionAssessmentOnly = false
) {
  if (retentionAssessmentOnly && !marksGradingDone(attempt)) return;
  const tx = await beginWrite(client);
  try {
    await tx.execute({
      sql: "INSERT INTO evaluations (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome) VALUES (?, ?, ?, ?, ?, 'uncertain')",
      args: [
        randomUUID(),
        session.userId,
        attempt.id,
        FALLBACK_SETTLED_EVALUATOR_VERSION,
        `${FALLBACK_RUBRIC_VERSION}:${attempt.contentVersionId}`
      ]
    });
    await finishFallback(tx, session, attempt, false);
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  } finally {
    tx.close();
  }
}

async function recordFallbackVerdict(
  client: Client,
  session: LearnerSession,
  attempt: FallbackAttempt,
  outcome: string
) {
  const tx = await beginWrite(client);
  try {
    await tx.execute({
      sql: 'INSERT INTO evaluations (id, owner_id, attempt_id, evaluator_version, rubric_version, outcome) VALUES (?, ?, ?, ?, ?, ?)',
      args: [
        randomUUID(),
        session.userId,
        attempt.id,
        FALLBACK_EVALUATOR_VERSION,
        `${FALLBACK_RUBRIC_VERSION}:${attempt.contentVersionId}`,
        outcome
      ]
    });
    await finishFallback(tx, session, attempt, true);
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  } finally {
    tx.close();
  }
}

/**
 * Ask the AI fallback about a typed answer the prepared answers did not
 * match. It runs after the attempt commits, so a slow or failed call never
 * loses the answer; every outcome other than a verdict is logged.
 */
async function recordFallbackEvaluation(
  client: Client,
  session: LearnerSession,
  attempt: FallbackAttempt,
  fallback: FallbackEvaluator | undefined
) {
  const { format, answer, alternatives } = preparedQuestion(
    attempt.questionId,
    attempt.question
  );
  if (format === 'multiple-choice' || answer === null) {
    await settleFallback(client, session, attempt, true);
    return;
  }
  try {
    const saved = await findSavedFallbackVerdict(client, session, attempt);
    if (saved) {
      await recordFallbackVerdict(client, session, attempt, saved);
      return;
    }
    await runFallbackProvider({
      client,
      session,
      attempt,
      prepared: { format, answer, alternatives },
      fallback
    });
  } catch (error) {
    // The attempt is already saved; the answer stays uncertain for review.
    logFallback('failed');
    console.error(error);
    await settleFallback(client, session, attempt).catch((settling) =>
      console.error(settling)
    );
  }
}

async function findSavedFallbackVerdict(
  client: Client,
  session: LearnerSession,
  attempt: FallbackAttempt
): Promise<string | null> {
  const saved = await client.execute({
    sql: `SELECT e.outcome FROM attempts a
      JOIN evaluations e ON e.attempt_id = a.id AND e.owner_id = a.owner_id
      WHERE a.owner_id = ? AND a.question_id = ? AND a.content_version_id = ?
        AND a.answer = ? AND e.evaluator_version = ? AND e.rubric_version = ?
        AND e.outcome IN ('correct', 'incorrect')
      ORDER BY e.created_at DESC, e.id DESC LIMIT 1`,
    args: [
      session.userId,
      attempt.questionId,
      attempt.contentVersionId,
      attempt.answer,
      FALLBACK_EVALUATOR_VERSION,
      `${FALLBACK_RUBRIC_VERSION}:${attempt.contentVersionId}`
    ]
  });
  return saved.rows[0] ? String(saved.rows[0].outcome) : null;
}

async function runFallbackProvider({
  client,
  session,
  attempt,
  prepared,
  fallback
}: {
  client: Client;
  session: LearnerSession;
  attempt: FallbackAttempt;
  prepared: {
    format: Exclude<ExerciseFormat, 'multiple-choice'>;
    answer: string;
    alternatives: string[];
  };
  fallback: FallbackEvaluator | undefined;
}) {
  if (!fallback) {
    logFallback('not-configured');
    await settleFallback(client, session, attempt, true);
    return;
  }
  const result = await span('study.jev-call', async (active) => {
    const answered = await fallback({
      language: attempt.language,
      format: prepared.format,
      prompt:
        attempt.question.prompt === null
          ? null
          : String(attempt.question.prompt),
      accepted: [prepared.answer, ...prepared.alternatives],
      answer: attempt.answer
    });
    active.setAttribute('evaluated', answered.evaluated);
    return answered;
  });
  if (result.reason !== 'answered') logFallback(result.reason);
  if (!result.evaluated) {
    await settleFallback(client, session, attempt);
    return;
  }
  await recordFallbackVerdict(client, session, attempt, result.outcome);
}

/**
 * A question takes one independent answer per session, whichever tab sent it;
 * the database index enforces the same rule for writes outside this service.
 */
const answeredStatement = (
  session: LearnerSession,
  input: AttemptInput
): InStatement => ({
  sql: "SELECT 1 FROM attempts WHERE owner_id = ? AND study_session_id = ? AND question_id = ? AND evidence_kind = 'independent'",
  args: [session.userId, input.studySessionId, input.questionId]
});

function assertNotAnswered(input: AttemptInput, preread: Preread) {
  if (input.evidenceKind !== 'independent') return;
  if (!preread.answered)
    throw new Error(
      'The answered check was not read for an independent attempt'
    );
  if (preread.answered[0]) throw new StudyError('QUESTION_ALREADY_ANSWERED');
}

function priorEvidenceStatement(
  session: LearnerSession,
  input: AttemptInput
): InStatement {
  const provisional = provisionalCorrectAttempt('a', 's');
  return {
    sql: `SELECT 1 FROM attempts a JOIN study_sessions s ON s.id = a.study_session_id AND s.owner_id = a.owner_id
      WHERE a.owner_id = ? AND a.question_id = ? AND a.study_session_id <> ?
        AND NOT ${provisional.sql} LIMIT 1`,
    args: [
      session.userId,
      input.questionId,
      input.studySessionId,
      ...provisional.args
    ]
  };
}

/** Re-presenting a question never creates fresh independent evidence. */
function evidenceKindFrom(
  input: AttemptInput,
  priorEvidence: Row[] | null
): EvidenceKind {
  if (input.evidenceKind === 'assisted') return 'assisted';
  if (!priorEvidence)
    throw new Error('Prior evidence was not read for an independent attempt');
  return priorEvidence.length ? 'assisted' : 'independent';
}

async function evidenceKindFor(
  tx: Pick<Client, 'execute'>,
  session: LearnerSession,
  input: AttemptInput
): Promise<EvidenceKind> {
  if (input.evidenceKind === 'assisted') return 'assisted';
  const prior = await tx.execute(priorEvidenceStatement(session, input));
  return evidenceKindFrom(input, prior.rows);
}

/**
 * Record an answer in the caller's own active study session. The submission
 * key is idempotent per owner: a replay with the same payload returns the
 * original attempt, and a different payload is IDEMPOTENCY_CONFLICT.
 */
export async function recordAttempt(
  client: Client,
  session: LearnerSession,
  input: AttemptInput,
  options: { fallback?: FallbackEvaluator } = {}
) {
  validateAttemptInput(input);
  const recorded = await recordAttemptWrite(client, session, input);
  if ('attempt' in recorded) {
    const { attempt } = recorded;
    // Grading runs before the learner sees a result, so a trace shows its time.
    await span('study.grade-fallback', () =>
      recordFallbackEvaluation(client, session, attempt, options.fallback)
    );
  }
  return recorded.result;
}

async function grammarAttemptRows(
  tx: WriteTransaction,
  learner: LearnerSession,
  attemptId: string
) {
  const found = await tx.execute({
    sql: `SELECT a.id AS attempt_id, a.owner_id, a.study_session_id,
          a.skill_id, a.language, a.question_id, a.content_version_id,
          a.evidence_kind, a.received_help, a.not_sure, a.grammar_rating,
          s.mode, s.state, s.grammar_retention_policy_version, v.status, aq.lineage_key,
          e.id AS evaluation_id, e.evaluator_version, e.rubric_version, e.outcome
        FROM attempts a JOIN study_sessions s ON s.id = a.study_session_id AND s.owner_id = a.owner_id
        JOIN content_versions v ON v.id = a.content_version_id
        LEFT JOIN questions aq ON aq.id = a.question_id
        LEFT JOIN evaluations e ON e.attempt_id = a.id AND e.owner_id = a.owner_id
        WHERE a.id = ? AND a.owner_id = ? ORDER BY e.created_at, e.id`,
    args: [attemptId, learner.userId]
  });
  return found.rows;
}

function isUnassistedGrammarAttempt(row: Row, expectedSessionId: string) {
  return (
    row.study_session_id === expectedSessionId &&
    row.grammar_retention_policy_version === GRAMMAR_RETENTION_POLICY_VERSION &&
    !row.received_help &&
    !row.not_sure
  );
}

function ownGrammarAttempt(rows: Row[], expectedSessionId: string) {
  const row = rows[0];
  if (!row) throw new StudyError('NOT_FOUND');
  if (!isUnassistedGrammarAttempt(row, expectedSessionId))
    throw new StudyError('NOT_FOUND');
  return row;
}

function hasCorrectGrammarEvaluation(rows: Row[]) {
  return (
    feedbackEvaluation(rows, String(rows[0].content_version_id))?.outcome ===
    'correct'
  );
}

function hasRateableGrammarOutcome(rows: Row[]) {
  const contentVersionId = String(rows[0].content_version_id);
  const evaluation = feedbackEvaluation(rows, contentVersionId);
  if (evaluation?.outcome === 'correct') return true;
  if (evaluation?.evaluator_version === FALLBACK_EVALUATOR_VERSION)
    return false;
  return rows.some(
    (row) =>
      row.evaluator_version === HISTORICAL_JEV_EVALUATOR_VERSION &&
      row.rubric_version ===
        `${HISTORICAL_JEV_RUBRIC_VERSION}:${contentVersionId}` &&
      row.outcome === 'correct'
  );
}

/** A lesson page rates only its own skill's practice answers. */
function assertLessonPractice(
  rows: Row[],
  expectedSessionId: string,
  skillId: string | undefined
) {
  if (skillId === undefined) return;
  const row = ownGrammarAttempt(rows, expectedSessionId);
  if (row.skill_id !== skillId) throw new StudyError('NOT_FOUND');
  if (row.mode === 'assessment') throw new StudyError('NOT_FOUND');
}

function assertRateableAttempt(rows: Row[], expectedSessionId: string) {
  const row = ownGrammarAttempt(rows, expectedSessionId);
  if (
    row.status === 'quarantined' ||
    !['active', 'completed'].includes(String(row.state))
  )
    throw new StudyError('NOT_FOUND');
  if (!hasRateableGrammarOutcome(rows))
    throw new StudyError('INVALID_GRAMMAR_RATING');
  if (!['schema-validated', 'pilot-ready'].includes(String(row.status)))
    throw new StudyError('CONTENT_UNAVAILABLE');
  return row;
}

function assertDiscardableAttempt(rows: Row[], expectedSessionId: string) {
  const row = ownGrammarAttempt(rows, expectedSessionId);
  if (row.mode !== 'assessment' || row.state !== 'active')
    throw new StudyError('NOT_FOUND');
  if (row.grammar_rating !== null || !hasCorrectGrammarEvaluation(rows))
    throw new StudyError('NOT_FOUND');
  return row;
}

async function persistAttemptRating(
  tx: WriteTransaction,
  learner: LearnerSession,
  row: Row,
  rating: GrammarRating
) {
  if (row.grammar_rating !== null) {
    if (row.grammar_rating !== rating)
      throw new StudyError('STALE_GRAMMAR_RATING');
    return true;
  }
  if (row.state !== 'active') throw new StudyError('SESSION_NOT_ACTIVE');
  const changed = await tx.execute({
    sql: 'UPDATE attempts SET grammar_rating = ? WHERE id = ? AND owner_id = ? AND grammar_rating IS NULL',
    args: [rating, row.attempt_id, learner.userId]
  });
  if (changed.rowsAffected !== 1) throw new StudyError('STALE_GRAMMAR_RATING');
  return false;
}

async function finalizeAssessment(
  tx: WriteTransaction,
  learner: LearnerSession,
  row: Row
) {
  const studySessionId = String(row.study_session_id);
  const completed = await completeAssessment(tx, learner, studySessionId);
  if (completed) {
    await syncEvidenceLedger(tx, {
      ownerId: learner.userId,
      language: String(row.language),
      studySessionId
    });
    await commitGrammarSessionReviews(tx, learner, studySessionId);
  }
  return completed;
}

/** Add a learner difficulty rating to a correct response and finish an assessment if ready. */
export async function rateGrammarAttempt(
  client: Client,
  learner: LearnerSession,
  input: {
    attemptId: string;
    rating: GrammarRating;
    expectedSessionId: string;
    practiceSkillId?: string;
  }
) {
  const { attemptId, rating, expectedSessionId, practiceSkillId } = input;
  if (!['hard', 'good', 'easy'].includes(rating))
    throw new StudyError('INVALID_GRAMMAR_RATING');
  const tx = await beginWrite(client);
  try {
    const rows = await grammarAttemptRows(tx, learner, attemptId);
    assertLessonPractice(rows, expectedSessionId, practiceSkillId);
    const row = assertRateableAttempt(rows, expectedSessionId);
    const duplicate = await persistAttemptRating(tx, learner, row, rating);
    if (duplicate) {
      await tx.commit();
      return {
        duplicate: true,
        completed: row.state === 'completed',
        mode: String(row.mode)
      };
    }
    if (row.mode === 'assessment') {
      const completed = await finalizeAssessment(tx, learner, row);
      await tx.commit();
      return { duplicate: false, completed, mode: String(row.mode) };
    }
    // The attempt rows were just read, so its lineages need no second read.
    await syncLineageEvidence(
      tx,
      { ownerId: learner.userId, language: String(row.language) },
      seedLineageKeys(rows)
    );
    await tx.commit();
    return { duplicate: false, completed: false, mode: String(row.mode) };
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  } finally {
    tx.close();
  }
}

/** Remove a provisional correct assessment response the learner declined to rate. */
export async function discardUnratedAssessmentAnswer(
  client: Client,
  learner: LearnerSession,
  attemptId: string,
  expectedSessionId: string
) {
  const tx = await beginWrite(client);
  try {
    const rows = await grammarAttemptRows(tx, learner, attemptId);
    const row = assertDiscardableAttempt(rows, expectedSessionId);
    const deleted = await tx.execute({
      sql: 'DELETE FROM attempts WHERE id = ? AND owner_id = ? AND grammar_rating IS NULL',
      args: [attemptId, learner.userId]
    });
    if (deleted.rowsAffected !== 1)
      throw new StudyError('STALE_GRAMMAR_RATING');
    await finalizeAssessment(tx, learner, row);
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  } finally {
    tx.close();
  }
}

async function syncAttemptEvidence(
  tx: WriteTransaction,
  session: LearnerSession,
  attempt: {
    attemptId: string;
    language: string;
    mode: string;
    assessment: boolean;
    studySessionId: string;
    outcome: string;
  }
) {
  const scope = { ownerId: session.userId, language: attempt.language };
  // Only an assessment can complete here: for any other session the check is
  // a read and a write that change nothing, so they are not sent.
  const completed =
    attempt.assessment &&
    (await completeAssessment(tx, session, attempt.studySessionId));
  if (completed) {
    await syncEvidenceLedger(tx, {
      ...scope,
      studySessionId: attempt.studySessionId
    });
    await commitGrammarSessionReviews(tx, session, attempt.studySessionId);
    return;
  }
  if (attempt.mode === 'assessment' || attempt.outcome === 'uncertain') return;
  await syncEvidenceLedger(tx, { ...scope, attemptIds: [attempt.attemptId] });
}

/** A wrong first answer under the retention policy is rated 'again' at once. */
function preparedMistakeStatement(
  session: LearnerSession,
  input: AttemptInput,
  attempt: { id: string; outcome: string; policy: string | null }
): InStatement | null {
  if (attempt.outcome !== 'incorrect') return null;
  if (attempt.policy !== GRAMMAR_RETENTION_POLICY_VERSION) return null;
  if (input.evidenceKind !== 'independent') return null;
  if (input.notSure) return null;
  return {
    sql: "UPDATE attempts SET grammar_rating = 'again' WHERE id = ? AND owner_id = ?",
    args: [attempt.id, session.userId]
  };
}

function attemptRecord(
  input: AttemptInput,
  source: Awaited<ReturnType<typeof attemptSource>>,
  kind: EvidenceKind
) {
  return {
    id: randomUUID(),
    studySessionId: input.studySessionId,
    mode: source.mode,
    grammarRetentionPolicyVersion: source.grammarRetentionPolicyVersion,
    questionId: input.questionId,
    answer: input.answer,
    contentVersionId: source.contentVersionId,
    skillId: source.skillId,
    language: source.language,
    question: source.question,
    notSure: input.notSure,
    kind
  };
}

function insertAttemptStatement(
  session: LearnerSession,
  input: AttemptInput,
  attempt: ReturnType<typeof attemptRecord>
): InStatement {
  return {
    sql: 'INSERT INTO attempts (id, owner_id, study_session_id, question_id, content_version_id, skill_id, language, submission_key, evidence_kind, answer, not_sure, received_help) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    args: [
      attempt.id,
      session.userId,
      input.studySessionId,
      input.questionId,
      attempt.contentVersionId,
      attempt.skillId,
      attempt.language,
      input.submissionKey,
      attempt.kind,
      input.answer,
      input.notSure ? 1 : 0,
      input.evidenceKind === 'assisted' ? 1 : 0
    ]
  };
}

async function recordAttemptWrite(
  client: Client,
  session: LearnerSession,
  input: AttemptInput
): Promise<
  | { result: { id: string; duplicate: boolean } }
  | { result: { id: string; duplicate: false }; attempt: FallbackAttempt }
> {
  const tx = await beginWrite(client);
  try {
    const preread = await prereadAttempt(tx, session, input);
    const replay = await replayAttempt(tx, session, input, preread);
    if (replay) {
      await tx.commit();
      return { result: replay };
    }
    const source = await attemptSource(tx, session, input, preread);
    assertNotAnswered(input, preread);
    const attempt = attemptRecord(
      input,
      source,
      evidenceKindFrom(input, preread.priorEvidence)
    );
    const { id } = attempt;
    const outcome = preparedOutcome(attempt);
    const rating = preparedMistakeStatement(session, input, {
      id,
      outcome,
      policy: source.grammarRetentionPolicyVersion
    });
    // The attempt, its evaluation and a mistake's rating are known together,
    // so they are saved in one round trip.
    await tx.batch([
      insertAttemptStatement(session, input, attempt),
      preparedEvaluationStatement(session, attempt, outcome),
      ...(rating ? [rating] : [])
    ]);
    await syncAttemptEvidence(tx, session, {
      attemptId: id,
      language: source.language,
      mode: source.mode,
      assessment: source.assessment,
      studySessionId: input.studySessionId,
      outcome
    });
    await tx.commit();
    const result = { id, duplicate: false as const };
    return outcome === 'uncertain' && !input.notSure
      ? { result, attempt }
      : { result };
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
  const paused = await executeWrite(client, {
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
  const resumed = await executeWrite(client, {
    sql: "UPDATE study_sessions SET state = 'active', paused_at = NULL WHERE id = ? AND owner_id = ? AND state <> 'completed'",
    args: [studySessionId, session.userId]
  });
  // The session completed between the lookup and the write.
  if (resumed.rowsAffected === 0) throw new StudyError('SESSION_NOT_ACTIVE');
  return getStudySession(client, session, studySessionId);
}
