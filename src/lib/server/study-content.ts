import type { Client, Row } from '@libsql/client';
import type { LearnerSession } from './flashcards';
import { StudyError } from './study-error';

// Reads of shared content on behalf of a learner's own study session: the
// next question of a skill and a skill's lesson.

/**
 * The newest content version of a skill, as a subquery that callers join their
 * payload to. The status is read in the same statement as the payload, so
 * content withdrawn by a quarantine import is never served after the check.
 */
const latestVersion =
  '(SELECT id, status FROM content_versions WHERE skill_id = ? AND language = ? ORDER BY version DESC LIMIT 1)';

/**
 * The version a session reads for a skill: the one its first attempt at the
 * skill was recorded against, so a session that spans an import is finished on
 * the questions it started, and the newest version otherwise. Takes the
 * owner, session and skill, then the skill and language of the fallback.
 */
const sessionVersionId = `COALESCE(
    (SELECT content_version_id FROM attempts WHERE owner_id = ? AND study_session_id = ? AND skill_id = ? ORDER BY created_at, id LIMIT 1),
    (SELECT id FROM content_versions WHERE skill_id = ? AND language = ? ORDER BY version DESC LIMIT 1))`;
const sessionVersion = `(SELECT id, status FROM content_versions WHERE id = ${sessionVersionId})`;

export type SessionRow = { language: string; mode: string; state: string };

export async function ownSession(
  client: Pick<Client, 'execute'>,
  session: LearnerSession,
  studySessionId: unknown
): Promise<SessionRow> {
  if (typeof studySessionId !== 'string') throw new StudyError('NOT_FOUND');
  const found = await client.execute({
    sql: 'SELECT language, mode, state FROM study_sessions WHERE id = ? AND owner_id = ?',
    args: [studySessionId, session.userId]
  });
  const row = found.rows[0];
  if (!row) throw new StudyError('NOT_FOUND');
  return {
    language: String(row.language),
    mode: String(row.mode),
    state: String(row.state)
  };
}

/** Reject a joined version row that is missing or withdrawn. */
function assertAvailable(row: Row | undefined): asserts row is Row {
  if (!row) throw new StudyError('NOT_FOUND');
  if (row.status === 'quarantined') throw new StudyError('CONTENT_UNAVAILABLE');
}

/** What a question read is scoped to: the owner, session, skill and its mode. */
type QuestionRead = {
  userId: string;
  studySessionId: string;
  skillId: string;
  language: string;
  mode: string;
};

/**
 * The question rows of a skill for an active session, with whether this
 * session answered each. The session state and the version status are read in
 * the payload statement itself, so a pause or quarantine committed after an
 * earlier lookup is not answered with a question.
 */
async function questionRows(client: Client, read: QuestionRead) {
  const found = await client.execute({
    sql: `SELECT s.state, v.status, q.id, q.format, q.prompt, q.alternatives,
            EXISTS (SELECT 1 FROM attempts a WHERE a.owner_id = ? AND a.study_session_id = ? AND a.question_id = q.id) AS answered
          FROM study_sessions s
          CROSS JOIN ${sessionVersion} v
          LEFT JOIN questions q ON q.content_version_id = v.id AND q.prompt IS NOT NULL AND (q.holdout = 0 OR ? = 'assessment')
          WHERE s.id = ? AND s.owner_id = ?
          ORDER BY q.id`,
    args: [
      read.userId,
      read.studySessionId,
      read.userId,
      read.studySessionId,
      read.skillId,
      read.skillId,
      read.language,
      read.mode,
      read.studySessionId,
      read.userId
    ]
  });
  if (found.rows[0] && found.rows[0].state !== 'active')
    throw new StudyError('SESSION_NOT_ACTIVE');
  assertAvailable(found.rows[0]);
  return found.rows.filter((row) => row.id !== null);
}

/** The learner-facing question; the expected answer is never part of it. */
function publicQuestion(row: Row) {
  return {
    id: String(row.id),
    format: String(row.format),
    prompt: String(row.prompt),
    alternatives:
      row.alternatives === null
        ? undefined
        : (JSON.parse(String(row.alternatives)) as string[])
  };
}

/**
 * The next item of a skill for the caller's active session: the first
 * question, in id order, that this session has not attempted. The position is
 * derived from confirmed attempts, so a reload or a second tab gets the same
 * answer. Holdouts are served only in assessment sessions. The expected
 * answer is never returned.
 */
export async function nextQuestion(
  client: Client,
  session: LearnerSession,
  studySessionId: string,
  skillId: string
) {
  const study = await ownSession(client, session, studySessionId);
  if (study.state !== 'active') throw new StudyError('SESSION_NOT_ACTIVE');
  if (typeof skillId !== 'string') throw new StudyError('NOT_FOUND');
  const rows = await questionRows(client, {
    userId: session.userId,
    studySessionId,
    skillId,
    language: study.language,
    mode: study.mode
  });
  const next = rows.find((row) => Number(row.answered) === 0);
  return {
    question: next ? publicQuestion(next) : null,
    answered: rows.filter((row) => Number(row.answered) === 1).length,
    total: rows.length
  };
}

/** The newest version of a skill with its lesson, which must exist and be available. */
async function lessonRow(
  client: Pick<Client, 'execute'>,
  language: string,
  skillId: unknown
) {
  if (typeof skillId !== 'string') throw new StudyError('NOT_FOUND');
  const found = await client.execute({
    sql: `SELECT v.id AS version_id, v.status, l.title, l.explanation, l.examples, l.refs
          FROM ${latestVersion} v
          LEFT JOIN lessons l ON l.content_version_id = v.id`,
    args: [skillId, language]
  });
  const row = found.rows[0];
  assertAvailable(row);
  if (row.title === null) throw new StudyError('NOT_FOUND');
  return row;
}

/**
 * The stored lesson for a skill in a track the caller is enrolled in. Authored
 * explanations are English only; for another enrollment language the English
 * text is returned with `englishFallback` set so the page can say so.
 */
export async function getLesson(
  client: Client,
  session: LearnerSession,
  language: string,
  skillId: string
) {
  if (typeof language !== 'string') throw new StudyError('NOT_FOUND');
  const enrolled = await client.execute({
    sql: 'SELECT explanation_language FROM enrollments WHERE owner_id = ? AND language = ?',
    args: [session.userId, language]
  });
  if (!enrolled.rows[0]) throw new StudyError('NOT_FOUND');
  const row = await lessonRow(client, language, skillId);
  return {
    skillId,
    contentVersionId: String(row.version_id),
    title: String(row.title),
    explanation: String(row.explanation),
    examples: JSON.parse(String(row.examples)) as Record<string, string>[],
    references: JSON.parse(String(row.refs)) as string[],
    explanationLanguage: 'en',
    englishFallback: enrolled.rows[0].explanation_language !== 'en'
  };
}
