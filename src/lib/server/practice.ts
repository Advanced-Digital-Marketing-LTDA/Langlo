import type { Client } from '@libsql/client';
import { beginWrite } from './flashcards';
import type { LearnerSession } from './learner-session';
import { StudyError } from './study-error';

const KEY_PATTERN = /^[0-9a-f-]{36}$/i;

/**
 * Start a practice session in an enrolled track. The submission key makes the
 * start idempotent: a repeated tap returns the same session.
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
  const tx = await beginWrite(client);
  try {
    const previous = await tx.execute({
      sql: 'SELECT owner_id, language, mode FROM study_sessions WHERE id = ?',
      args: [id]
    });
    if (previous.rows[0]) {
      const row = previous.rows[0];
      if (
        row.owner_id !== learner.userId ||
        row.language !== input.language ||
        row.mode !== 'practice'
      )
        throw new StudyError('NOT_FOUND');
      await tx.commit();
      return { id };
    }
    const enrolled = await tx.execute({
      sql: 'SELECT id FROM enrollments WHERE owner_id = ? AND language = ?',
      args: [learner.userId, input.language]
    });
    if (!enrolled.rows[0]) throw new StudyError('NOT_FOUND');
    await tx.execute({
      sql: "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode) VALUES (?, ?, ?, ?, 'practice')",
      args: [id, learner.userId, String(enrolled.rows[0].id), input.language]
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
 * its newest evaluation; an attempt not yet evaluated counts as pending.
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
          ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS outcome
      FROM attempts a WHERE a.study_session_id = ? AND a.owner_id = ?
      ORDER BY a.created_at, a.id`,
    args: [id, learner.userId]
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
