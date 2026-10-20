import type { Client } from '@libsql/client';
import type { LearnerSession } from './learner-session';
import {
  FALLBACK_EVALUATOR_VERSION,
  FALLBACK_RUBRIC_VERSION
} from './evaluation/fallback';
import { PREPARED_EVALUATOR_VERSION } from './evaluation/prepared';
import { StudyError } from './study-error';
import { beginWrite, executeWrite } from './flashcards';
import {
  commitGrammarSessionReviews,
  dueGrammarReviews,
  GRAMMAR_RETENTION_POLICY_VERSION
} from './grammar-retention';

const KEY_PATTERN = /^[0-9a-f-]{36}$/i;
const SESSION_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

/**
 * The results page of a practice session. An id with a path, query or
 * scheme character is rejected, so a request parameter can never steer the
 * redirect anywhere else; any id the sessions table holds still passes.
 */
export function practiceResultsPath(id: string): string {
  if (!SESSION_ID_PATTERN.test(id)) throw new StudyError('NOT_FOUND');
  return `/app/session/${encodeURIComponent(id)}/results`;
}

/**
 * Start a practice session in an enrolled track. The submission key makes the
 * start idempotent: a repeated tap returns the same session. The insert
 * names the caller's own enrollment, so an unenrolled language inserts nothing.
 */
export async function startPractice(
  client: Client,
  learner: LearnerSession,
  input: { language: string; submissionKey: unknown }
): Promise<{ id: string }> {
  if (
    typeof input.submissionKey !== 'string' ||
    !KEY_PATTERN.test(input.submissionKey)
  )
    throw new StudyError('INVALID_SUBMISSION_KEY');
  const id = `practice:${input.submissionKey}`;
  await executeWrite(client, {
    sql: `INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode, grammar_retention_policy_version)
      SELECT ?, e.owner_id, e.id, e.language, 'practice', ? FROM enrollments e
      WHERE e.owner_id = ? AND e.language = ? ON CONFLICT (id) DO NOTHING`,
    args: [id, GRAMMAR_RETENTION_POLICY_VERSION, learner.userId, input.language]
  });
  const saved = await client.execute({
    sql: 'SELECT owner_id, language, mode FROM study_sessions WHERE id = ?',
    args: [id]
  });
  const row = saved.rows[0];
  // Missing: not enrolled. Mismatched: the key belongs to someone else's session.
  if (
    !row ||
    row.owner_id !== learner.userId ||
    row.language !== input.language ||
    row.mode !== 'practice'
  )
    throw new StudyError('NOT_FOUND');
  return { id };
}

/** Freeze at most five due skills into a manual, one-question-per-skill review session. */
export async function startGrammarReview(
  client: Client,
  learner: LearnerSession,
  input: { language: string; submissionKey: unknown; skillIds: unknown[] },
  now = Date.now()
) {
  if (
    typeof input.submissionKey !== 'string' ||
    !KEY_PATTERN.test(input.submissionKey)
  )
    throw new StudyError('INVALID_SUBMISSION_KEY');
  if (
    !Array.isArray(input.skillIds) ||
    input.skillIds.length < 1 ||
    input.skillIds.length > 5 ||
    !input.skillIds.every((id) => typeof id === 'string') ||
    new Set(input.skillIds).size !== input.skillIds.length
  )
    throw new StudyError('INVALID_REVIEW_SELECTION');
  const id = `grammar-review:${input.submissionKey}`;
  const tx = await beginWrite(client);
  try {
    const previous = await tx.execute({
      sql: 'SELECT owner_id, language, mode, grammar_retention_plan FROM study_sessions WHERE id = ?',
      args: [id]
    });
    if (previous.rows[0]) {
      const row = previous.rows[0];
      const plan = JSON.parse(String(row.grammar_retention_plan ?? '{}'));
      const priorSkills = Array.isArray(plan.questions)
        ? plan.questions.map((item: { skillId?: string }) => item.skillId)
        : [];
      if (
        row.owner_id !== learner.userId ||
        row.language !== input.language ||
        row.mode !== 'mixed-review' ||
        JSON.stringify(priorSkills) !== JSON.stringify(input.skillIds)
      )
        throw new StudyError('NOT_FOUND');
      await tx.commit();
      return { id };
    }
    const due = await dueGrammarReviews(tx, learner, input.language, now);
    if (
      !input.skillIds.every((skillId) =>
        due.some((item) => item.skillId === skillId)
      )
    )
      throw new StudyError('STALE_GRAMMAR_REVIEW');
    const enrolled = await tx.execute({
      sql: 'SELECT id FROM enrollments WHERE owner_id = ? AND language = ?',
      args: [learner.userId, input.language]
    });
    if (!enrolled.rows[0]) throw new StudyError('NOT_FOUND');
    const questions: {
      skillId: string;
      questionId: string;
      contentVersionId: string;
    }[] = [];
    for (const skillId of input.skillIds as string[]) {
      const question = await tx.execute({
        sql: `SELECT q.id, q.content_version_id FROM questions q
          JOIN content_versions v ON v.id = q.content_version_id
          WHERE q.skill_id = ? AND q.language = ? AND q.holdout = 0
            AND q.prompt IS NOT NULL AND q.answer IS NOT NULL
            AND v.status IN ('schema-validated', 'pilot-ready')
            AND v.version = (SELECT MAX(v2.version) FROM content_versions v2
              WHERE v2.skill_id = q.skill_id AND v2.status IN ('schema-validated', 'pilot-ready'))
          ORDER BY q.id <> COALESCE((SELECT a.question_id FROM grammar_retention_events e
            JOIN attempts a ON a.id = e.attempt_id AND a.owner_id = e.owner_id
            WHERE e.owner_id = ? AND e.language = ? AND e.skill_id = ?
            ORDER BY e.reviewed_at DESC LIMIT 1), '') DESC, q.id LIMIT 1`,
        args: [skillId, input.language, learner.userId, input.language, skillId]
      });
      if (!question.rows[0]) throw new StudyError('CONTENT_UNAVAILABLE');
      questions.push({
        skillId,
        questionId: String(question.rows[0].id),
        contentVersionId: String(question.rows[0].content_version_id)
      });
    }
    await tx.execute({
      sql: `INSERT INTO study_sessions (id, owner_id, enrollment_id, language,
        mode, grammar_retention_policy_version, grammar_retention_plan)
        VALUES (?, ?, ?, ?, 'mixed-review', ?, ?)`,
      args: [
        id,
        learner.userId,
        enrolled.rows[0].id,
        input.language,
        GRAMMAR_RETENTION_POLICY_VERSION,
        JSON.stringify({ version: GRAMMAR_RETENTION_POLICY_VERSION, questions })
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

export async function grammarReviewPlan(
  client: Client,
  learner: LearnerSession,
  id: string
) {
  const found = await client.execute({
    sql: `SELECT s.language, s.grammar_retention_plan, p.value AS plan_item,
        sk.id AS skill_id, COALESCE(l.title, sk.id) AS title,
        EXISTS (SELECT 1 FROM attempts a WHERE a.owner_id = s.owner_id
          AND a.study_session_id = s.id AND a.question_id = json_extract(p.value, '$.questionId')) AS answered
      FROM study_sessions s JOIN json_each(s.grammar_retention_plan, '$.questions') p
      JOIN skills sk ON sk.id = json_extract(p.value, '$.skillId') AND sk.language = s.language
      LEFT JOIN content_versions v ON v.id = json_extract(p.value, '$.contentVersionId')
      LEFT JOIN lessons l ON l.content_version_id = v.id
      WHERE s.id = ? AND s.owner_id = ? AND s.mode = 'mixed-review'
      ORDER BY CAST(p.key AS INTEGER)`,
    args: [id, learner.userId]
  });
  if (!found.rows.length) throw new StudyError('NOT_FOUND');
  const plan = JSON.parse(String(found.rows[0].grammar_retention_plan));
  if (
    plan.version !== GRAMMAR_RETENTION_POLICY_VERSION ||
    plan.questions.length !== found.rows.length ||
    found.rows.length > 5
  )
    throw new StudyError('CONTENT_UNAVAILABLE');
  return found.rows.map((row) => ({
    skillId: String(row.skill_id),
    title: String(row.title),
    answered: Boolean(row.answered)
  }));
}

/** Mark one of the caller's own practice sessions as completed. */
export async function finishPractice(
  client: Client,
  learner: LearnerSession,
  id: string
): Promise<void> {
  const tx = await beginWrite(client);
  try {
    const found = await tx.execute({
      sql: "SELECT state, language FROM study_sessions WHERE id = ? AND owner_id = ? AND mode IN ('practice', 'mixed-review')",
      args: [id, learner.userId]
    });
    const session = found.rows[0];
    if (!session) throw new StudyError('NOT_FOUND');
    if (session.state === 'completed') {
      await tx.commit();
      return;
    }
    await tx.execute({
      sql: `DELETE FROM attempts WHERE owner_id = ? AND study_session_id = ?
        AND grammar_rating IS NULL AND EXISTS (
          SELECT 1 FROM study_sessions s WHERE s.id = attempts.study_session_id
            AND s.owner_id = attempts.owner_id AND s.grammar_retention_policy_version = ?
        ) AND (
          EXISTS (SELECT 1 FROM evaluations f WHERE f.attempt_id = attempts.id AND f.owner_id = attempts.owner_id
            AND f.evaluator_version = ? AND f.rubric_version = ? || ':' || attempts.content_version_id AND f.outcome = 'correct')
          OR (NOT EXISTS (SELECT 1 FROM evaluations f WHERE f.attempt_id = attempts.id AND f.owner_id = attempts.owner_id
              AND f.evaluator_version = ? AND f.rubric_version = ? || ':' || attempts.content_version_id)
            AND EXISTS (SELECT 1 FROM evaluations p WHERE p.attempt_id = attempts.id AND p.owner_id = attempts.owner_id
              AND p.evaluator_version = ? AND p.rubric_version = attempts.content_version_id AND p.outcome = 'correct'))
        )`,
      args: [
        learner.userId,
        id,
        GRAMMAR_RETENTION_POLICY_VERSION,
        FALLBACK_EVALUATOR_VERSION,
        FALLBACK_RUBRIC_VERSION,
        FALLBACK_EVALUATOR_VERSION,
        FALLBACK_RUBRIC_VERSION,
        PREPARED_EVALUATOR_VERSION
      ]
    });
    await tx.execute({
      sql: "UPDATE study_sessions SET state = 'completed', paused_at = NULL WHERE id = ? AND owner_id = ? AND mode IN ('practice', 'mixed-review')",
      args: [id, learner.userId]
    });
    await commitGrammarSessionReviews(tx, learner, id);
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  } finally {
    tx.close();
  }
}

/**
 * What a practice session has covered so far. Each attempt counts once, by
 * its verdict: the AI fallback's, else the prepared one, else the newest
 * evaluation. An attempt not yet evaluated counts as pending.
 */
export async function practiceSummary(
  client: Client,
  learner: LearnerSession,
  id: string
) {
  const session = await client.execute({
    sql: "SELECT language, state, mode, grammar_retention_plan FROM study_sessions WHERE id = ? AND owner_id = ? AND mode IN ('practice', 'mixed-review')",
    args: [id, learner.userId]
  });
  if (!session.rows[0]) throw new StudyError('NOT_FOUND');
  const attempts = await client.execute({
    sql: `SELECT a.skill_id,
        (SELECT e.outcome FROM evaluations e WHERE e.attempt_id = a.id AND e.owner_id = a.owner_id
          ORDER BY CASE e.evaluator_version WHEN ? THEN 0 WHEN ? THEN 1 ELSE 2 END,
            e.created_at DESC, e.id DESC LIMIT 1) AS outcome
      FROM attempts a WHERE a.study_session_id = ? AND a.owner_id = ?
      ORDER BY a.created_at, a.id`,
    args: [
      FALLBACK_EVALUATOR_VERSION,
      PREPARED_EVALUATOR_VERSION,
      id,
      learner.userId
    ]
  });
  const count = (outcome: string | null) =>
    attempts.rows.filter((row) => (row.outcome ?? null) === outcome).length;
  return {
    id,
    language: String(session.rows[0].language),
    mode: String(session.rows[0].mode),
    state: String(session.rows[0].state),
    answered: attempts.rows.length,
    correct: count('correct'),
    incorrect: count('incorrect'),
    uncertain: count('uncertain'),
    pending: count(null),
    skills: [...new Set(attempts.rows.map((row) => String(row.skill_id)))]
  };
}
