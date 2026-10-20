import type { Client, Row } from '@libsql/client';
import type { ExerciseQuestion } from '../components/exercises/answer';
import { beginWrite, type LearnerSession } from './flashcards';
import { StudyError } from './study-error';
import {
  FALLBACK_EVALUATOR_VERSION,
  FALLBACK_RUBRIC_VERSION,
  FALLBACK_SETTLED_EVALUATOR_VERSION
} from './evaluation/fallback';
import {
  PREPARED_EVALUATOR_VERSION,
  type PreparedOutcome
} from './evaluation/prepared';

export const ASSESSMENT_POLICY_VERSION = 'assessment-2';
type QueryClient = Pick<Client, 'execute'>;

/**
 * A question's identity across content versions: skill ID plus the question ID
 * without its exact `<contentVersionId>:` prefix, as the mastery policy counts it.
 */
const logicalItem = (questionId: string, versionId: string) =>
  `CASE WHEN substr(${questionId}, 1, length(${versionId}) + 1) = ${versionId} || ':'
    THEN substr(${questionId}, length(${versionId}) + 2) ELSE ${questionId} END`;

/**
 * The item a question stands for across lesson versions: its lineage key, or
 * its number for rows imported before lineage keys. `alias` is the questions
 * row of the id being compared.
 */
const itemOf = (alias: string, questionId: string, versionId: string) =>
  `COALESCE(${alias}.lineage_key, ${logicalItem(questionId, versionId)})`;

/**
 * Whether attempt `a` was an answer for the skill of question `q`: on that
 * skill, or on a retired skill whose progress carries to it, directly or
 * through other carries (as mastery counts them).
 */
const answersForSkillOf = (attempt: string, question: string) =>
  `${attempt}.skill_id IN (WITH RECURSIVE source(id) AS (
    SELECT ${question}.skill_id
    UNION SELECT r.id FROM skills r JOIN source ON r.replaced_by = source.id
      WHERE r.retired_at IS NOT NULL AND r.carry_progress = 1
  ) SELECT id FROM source)`;

function assertPreviousSession(
  row: Row | undefined,
  learner: LearnerSession,
  input: { language: string }
) {
  if (!row) return;
  if (row.owner_id !== learner.userId) throw new StudyError('NOT_FOUND');
  if (row.language !== input.language) throw new StudyError('NOT_FOUND');
  if (row.mode !== 'assessment') throw new StudyError('NOT_FOUND');
}

async function assessmentQuestions(
  client: QueryClient,
  learner: LearnerSession,
  input: { language: string }
) {
  const activeSkills = await client.execute({
    sql: 'SELECT id FROM skills WHERE language = ? AND retired_at IS NULL ORDER BY level, id',
    args: [input.language]
  });
  const available = await client.execute({
    sql: `SELECT q.id, q.skill_id, sk.level FROM questions q
        JOIN skills sk ON sk.id = q.skill_id
        JOIN content_versions v ON v.id = q.content_version_id
        WHERE q.language = ? AND q.holdout = 1 AND q.prompt IS NOT NULL AND q.answer IS NOT NULL
          AND sk.retired_at IS NULL
          AND v.status IN ('schema-validated', 'pilot-ready')
          AND v.version = (SELECT MAX(v2.version) FROM content_versions v2 WHERE v2.skill_id = q.skill_id AND v2.status <> 'quarantined')
          AND NOT EXISTS (SELECT 1 FROM attempts a JOIN questions aq ON aq.id = a.question_id WHERE a.owner_id = ? AND ${answersForSkillOf('a', 'q')}
            AND ${itemOf('aq', 'a.question_id', 'a.content_version_id')} = ${itemOf('q', 'q.id', 'q.content_version_id')})
        ORDER BY sk.level, q.skill_id, q.id`,
    args: [input.language, learner.userId]
  });
  const questionBySkill = new Map(
    [...available.rows]
      .reverse()
      .map((row) => [String(row.skill_id), row] as const)
  );
  const questions = activeSkills.rows.flatMap((skill) => {
    const question = questionBySkill.get(String(skill.id));
    return question ? [question] : [];
  });
  if (!questions.length || questions.length !== activeSkills.rows.length)
    throw new StudyError('CONTENT_UNAVAILABLE');
  return questions;
}

/** A saved plan freezes item identities; newly imported content cannot extend it. */
export async function startAssessment(
  client: Client,
  learner: LearnerSession,
  input: { language: string; submissionKey: string }
) {
  if (
    typeof input.submissionKey !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(input.submissionKey)
  )
    throw new StudyError('INVALID_SUBMISSION_KEY');
  if (!['fr', 'de', 'en'].includes(input.language))
    throw new StudyError('NOT_FOUND');
  const id = `assessment:${input.submissionKey}`;
  const tx = await beginWrite(client);
  try {
    const previous = await tx.execute({
      sql: 'SELECT owner_id, language, mode FROM study_sessions WHERE id = ?',
      args: [id]
    });
    const previousRow = previous.rows[0];
    assertPreviousSession(previousRow, learner, input);
    if (previousRow) {
      await tx.commit();
      return { id };
    }
    const enrolled = await tx.execute({
      sql: 'SELECT id FROM enrollments WHERE owner_id = ? AND language = ?',
      args: [learner.userId, input.language]
    });
    const enrollment = enrolled.rows[0];
    if (!enrollment) throw new StudyError('NOT_FOUND');
    const questions = await assessmentQuestions(tx, learner, input);
    await tx.execute({
      sql: "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode, assessment_plan) VALUES (?, ?, ?, ?, 'assessment', ?)",
      args: [
        id,
        learner.userId,
        enrollment.id,
        input.language,
        JSON.stringify({
          version: ASSESSMENT_POLICY_VERSION,
          questions: questions.map((row) => String(row.id))
        })
      ]
    });
    await tx.commit();
    return { id };
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  } finally {
    tx.close();
  }
}

// One statement reads state, quarantine and answered position together.
const plannedRows = `SELECT s.id AS session_id, s.language, s.state, s.assessment_plan,
  q.id, q.skill_id, q.content_version_id, q.format, q.prompt, q.answer, q.alternatives,
  v.status, sk.level,
  EXISTS (SELECT 1 FROM attempts a WHERE a.owner_id = s.owner_id AND a.study_session_id = s.id AND a.question_id = q.id) AS answered
  FROM study_sessions s JOIN json_each(s.assessment_plan, '$.questions') p
  JOIN questions q ON q.id = p.value
  JOIN content_versions v ON v.id = q.content_version_id
  JOIN skills sk ON sk.id = q.skill_id
  WHERE s.id = ? AND s.owner_id = ? AND s.mode = 'assessment'
  ORDER BY CAST(p.key AS INTEGER)`;

function assertPlanVersion(
  plan: { version: string; questions: unknown },
  rows: Row[]
) {
  if (!['assessment-1', ASSESSMENT_POLICY_VERSION].includes(plan.version))
    throw new StudyError('CONTENT_UNAVAILABLE');
  if (plan.version === 'assessment-1' && rows.length > 12)
    throw new StudyError('CONTENT_UNAVAILABLE');
}

function assertPlanQuestions(
  plan: { version: string; questions: unknown },
  rows: Row[]
) {
  if (!Array.isArray(plan.questions))
    throw new StudyError('CONTENT_UNAVAILABLE');
  if (plan.questions.length !== rows.length)
    throw new StudyError('CONTENT_UNAVAILABLE');
  const skills = rows.map((row) => String(row.skill_id));
  if (new Set(skills).size !== skills.length)
    throw new StudyError('CONTENT_UNAVAILABLE');
}

async function readPlan(
  client: QueryClient,
  learner: LearnerSession,
  id: string
) {
  if (typeof id !== 'string') throw new StudyError('NOT_FOUND');
  const result = await client.execute({
    sql: plannedRows,
    args: [id, learner.userId]
  });
  if (!result.rows.length) throw new StudyError('NOT_FOUND');
  const plan = JSON.parse(String(result.rows[0].assessment_plan));
  assertPlanVersion(plan, result.rows);
  assertPlanQuestions(plan, result.rows);
  return result.rows;
}

function questionFor(row: Row): ExerciseQuestion {
  return {
    id: String(row.id),
    format: row.format as ExerciseQuestion['format'],
    prompt: String(row.prompt),
    alternatives:
      row.format === 'multiple-choice' && row.alternatives !== null
        ? JSON.parse(String(row.alternatives))
        : undefined
  };
}

export async function getAssessment(
  client: QueryClient,
  learner: LearnerSession,
  id: string
) {
  const rows = await readPlan(client, learner, id);
  const next = rows.find((row) => !row.answered);
  if (
    rows.some((row) => row.status === 'quarantined') &&
    rows[0].state !== 'completed'
  )
    throw new StudyError('CONTENT_UNAVAILABLE');
  return {
    id,
    language: String(rows[0].language),
    state: String(rows[0].state),
    policyVersion: String(JSON.parse(String(rows[0].assessment_plan)).version),
    answered: rows.filter((row) => row.answered).length,
    total: rows.length,
    coverage: {
      A1: rows.filter((row) => row.level === 'A1').length,
      A2: rows.filter((row) => row.level === 'A2').length
    },
    question: rows[0].state === 'active' && next ? questionFor(next) : null,
    skillId: rows[0].state === 'active' && next ? String(next.skill_id) : null
  };
}

/** Also used by legacy per-skill readers so they cannot escape a saved plan. */
export async function assertAssessmentQuestion(
  client: QueryClient,
  learner: LearnerSession,
  id: string,
  questionId: string
) {
  const rows = await readPlan(client, learner, id);
  if (rows.some((row) => row.status === 'quarantined'))
    throw new StudyError('CONTENT_UNAVAILABLE');
  if (rows.find((row) => !row.answered)?.id !== questionId)
    throw new StudyError('STALE_QUESTION');
  // The plan was frozen at start: an item answered in another session since
  // then is no longer unseen, and counting it would reward a revealed answer.
  const seenElsewhere = await client.execute({
    sql: `SELECT 1 FROM questions q JOIN attempts a ON a.owner_id = ? AND a.study_session_id <> ? AND ${answersForSkillOf('a', 'q')}
      JOIN questions aq ON aq.id = a.question_id
      AND ${itemOf('aq', 'a.question_id', 'a.content_version_id')} = ${itemOf('q', 'q.id', 'q.content_version_id')}
      WHERE q.id = ? LIMIT 1`,
    args: [learner.userId, id, questionId]
  });
  if (seenElsewhere.rows.length) throw new StudyError('STALE_QUESTION');
}

/** Completion and the last answer commit atomically, never by a client flag. */
export async function completeAssessment(
  client: QueryClient,
  learner: LearnerSession,
  id: string
) {
  const completed = await client.execute({
    sql: `UPDATE study_sessions SET state = 'completed', paused_at = NULL WHERE id = ? AND owner_id = ? AND state = 'active' AND assessment_plan IS NOT NULL
      AND (NOT EXISTS (SELECT 1 FROM json_each(study_sessions.assessment_plan, '$.questions') p
        WHERE NOT EXISTS (SELECT 1 FROM attempts a WHERE a.owner_id = study_sessions.owner_id AND a.study_session_id = study_sessions.id AND a.question_id = p.value))
        OR (SELECT COUNT(DISTINCT a.question_id) FROM attempts a WHERE a.owner_id = study_sessions.owner_id AND a.study_session_id = study_sessions.id AND a.not_sure = 1) >= 5)`,
    args: [id, learner.userId]
  });
  return completed.rowsAffected > 0;
}

/** Only recognized versioned verdicts participate; unresolved evidence is uncertain. */
export function feedbackEvaluation(
  rows: Row[],
  contentVersionId: string
): Row | undefined {
  const fallback = rows.find(
    (row) =>
      row.evaluator_version === FALLBACK_EVALUATOR_VERSION &&
      row.rubric_version === `${FALLBACK_RUBRIC_VERSION}:${contentVersionId}`
  );
  const prepared = rows.find(
    (row) =>
      row.evaluator_version === PREPARED_EVALUATOR_VERSION &&
      row.rubric_version === contentVersionId
  );
  return fallback ?? prepared;
}

export function feedbackOutcome(
  rows: Row[],
  contentVersionId: string
): PreparedOutcome {
  const outcome = feedbackEvaluation(rows, contentVersionId)?.outcome;
  return outcome === 'correct' || outcome === 'incorrect'
    ? outcome
    : 'uncertain';
}

/** A fallback verdict that has not arrived this long after the answer is given up on. */
export const FALLBACK_WAIT_MS = 15_000;

/**
 * True while a final answer the prepared answers could not settle is still
 * waiting for its AI fallback. A fallback that ended without a verdict leaves
 * a settled marker, so it is not mistaken for one still running. Older answers
 * are treated as settled too: the provider call is bounded.
 */
async function awaitingFallbackVerdict(
  client: QueryClient,
  learner: LearnerSession,
  id: string,
  now: number
) {
  const pending = await client.execute({
    sql: `SELECT 1 FROM attempts a
      JOIN evaluations p ON p.attempt_id = a.id AND p.owner_id = a.owner_id AND p.evaluator_version = ?
      WHERE a.study_session_id = ? AND a.owner_id = ? AND a.not_sure = 0
        AND p.outcome = 'uncertain' AND a.created_at > ?
        AND NOT EXISTS (SELECT 1 FROM evaluations f WHERE f.attempt_id = a.id AND f.owner_id = a.owner_id AND f.evaluator_version IN (?, ?))
      LIMIT 1`,
    args: [
      PREPARED_EVALUATOR_VERSION,
      id,
      learner.userId,
      now - FALLBACK_WAIT_MS,
      FALLBACK_EVALUATOR_VERSION,
      FALLBACK_SETTLED_EVALUATOR_VERSION
    ]
  });
  return pending.rows.length > 0;
}

export async function assessmentResults(
  client: QueryClient,
  learner: LearnerSession,
  id: string,
  options: { awaitFallback?: boolean; now?: number } = {}
) {
  const rows = await readPlan(client, learner, id);
  if (rows[0].state !== 'completed') throw new StudyError('RESULTS_NOT_READY');
  if (
    options.awaitFallback &&
    (await awaitingFallbackVerdict(
      client,
      learner,
      id,
      options.now ?? Date.now()
    ))
  )
    throw new StudyError('RESULTS_PENDING');
  const evaluations = await client.execute({
    sql: `SELECT e.*, a.id AS recorded_attempt_id, a.question_id, a.content_version_id, a.answer, a.not_sure, a.evidence_kind
      FROM attempts a LEFT JOIN evaluations e ON e.attempt_id = a.id AND e.owner_id = a.owner_id
      WHERE a.study_session_id = ? AND a.owner_id = ? ORDER BY a.created_at, a.id, e.created_at, e.id`,
    args: [id, learner.userId]
  });
  const items = rows.flatMap((row) => {
    const evidence = evaluations.rows.filter(
      (entry) => entry.question_id === row.id
    );
    const first = evidence[0];
    if (!first?.recorded_attempt_id) return [];
    return {
      questionId: String(row.id),
      skillId: String(row.skill_id),
      level: String(row.level),
      contentVersionId: String(row.content_version_id),
      prompt: String(row.prompt),
      answer: String(first.answer),
      expectedAnswer: String(row.answer),
      outcome: first?.not_sure
        ? ('uncertain' as const)
        : feedbackOutcome(evidence, String(row.content_version_id)),
      evidenceKind: String(first.evidence_kind)
    };
  });
  return {
    id,
    language: String(rows[0].language),
    policyVersion: String(JSON.parse(String(rows[0].assessment_plan)).version),
    items,
    total: rows.length,
    notReached: rows.length - items.length,
    counts: {
      correct: items.filter((item) => item.outcome === 'correct').length,
      incorrect: items.filter((item) => item.outcome === 'incorrect').length,
      uncertain: items.filter((item) => item.outcome === 'uncertain').length
    },
    a1Gaps: items
      .filter((item) => item.level === 'A1' && item.outcome !== 'correct')
      .map((item) => item.skillId)
  };
}
