import type { Client } from '@libsql/client';
import type { LearnerSession } from './learner-session';
import { FALLBACK_EVALUATOR_VERSION } from './evaluation/fallback';
import { PREPARED_EVALUATOR_VERSION } from './evaluation/prepared';
import { StudyError } from './study-error';

const KEY_PATTERN = /^[0-9a-f-]{36}$/i;
const PRACTICE_ID_PATTERN = /^practice:[0-9a-f-]{36}$/i;

/**
 * The results page of a practice session. Only an id of the shape
 * startPractice issues is accepted, so a request parameter can never steer
 * the path anywhere else.
 */
export function practiceResultsPath(id: string): string {
  if (!PRACTICE_ID_PATTERN.test(id)) throw new StudyError('NOT_FOUND');
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
  await client.execute({
    sql: `INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode)
      SELECT ?, e.owner_id, e.id, e.language, 'practice' FROM enrollments e
      WHERE e.owner_id = ? AND e.language = ? ON CONFLICT (id) DO NOTHING`,
    args: [id, learner.userId, input.language]
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

/** Mark one of the caller's own practice sessions as completed. */
export async function finishPractice(
  client: Client,
  learner: LearnerSession,
  id: string
): Promise<void> {
  const result = await client.execute({
    sql: "UPDATE study_sessions SET state = 'completed', paused_at = NULL WHERE id = ? AND owner_id = ? AND mode = 'practice'",
    args: [id, learner.userId]
  });
  if (result.rowsAffected !== 1) throw new StudyError('NOT_FOUND');
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
    sql: "SELECT language, state FROM study_sessions WHERE id = ? AND owner_id = ? AND mode = 'practice'",
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
    state: String(session.rows[0].state),
    answered: attempts.rows.length,
    correct: count('correct'),
    incorrect: count('incorrect'),
    uncertain: count('uncertain'),
    pending: count(null),
    skills: [...new Set(attempts.rows.map((row) => String(row.skill_id)))]
  };
}
