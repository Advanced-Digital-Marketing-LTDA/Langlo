import type { Client, Row } from '@libsql/client';
import type { ExerciseFormat } from '../components/exercises/answer';
import type { LearnerSession } from './flashcards';
import { StudyError } from './study-error';
import { getAssessment } from './assessment';

// Reads of shared content on behalf of a learner's own study session: the
// next question of a skill and a skill's lesson.

/**
 * The newest content version of a skill, as a subquery that callers join their
 * payload to. The status is read in the same statement as the payload, so
 * content withdrawn by a quarantine import is never served after the check.
 */
const latestVersion =
  "(SELECT v.id, v.status, sk.retired_at FROM content_versions v JOIN skills sk ON sk.id = v.skill_id AND sk.language = v.language WHERE v.skill_id = ? AND v.language = ? ORDER BY status = 'quarantined', version DESC LIMIT 1)";

/**
 * The version a session reads for a skill: its frozen review version, else the one its first attempt at the
 * skill was recorded against, so a session that spans an import is finished on
 * the questions it started, and the newest version that is not quarantined
 * otherwise (the newest of all when every version is quarantined). Takes the
 * owner, session and skill, then the skill and language of the fallback.
 */
const sessionVersionId = `COALESCE(
    (SELECT json_extract(p.value, '$.contentVersionId') FROM study_sessions s
      JOIN json_each(s.grammar_retention_plan, '$.questions') p
      WHERE s.owner_id = ? AND s.id = ? AND json_extract(p.value, '$.skillId') = ?),
    (SELECT content_version_id FROM attempts WHERE owner_id = ? AND study_session_id = ? AND skill_id = ? ORDER BY created_at, id LIMIT 1),
    (SELECT id FROM content_versions WHERE skill_id = ? AND language = ? ORDER BY status = 'quarantined', version DESC LIMIT 1))`;
const sessionVersion = `(SELECT v.id, v.status, sk.retired_at FROM content_versions v JOIN skills sk ON sk.id = v.skill_id AND sk.language = v.language WHERE v.id = ${sessionVersionId})`;

export type SessionRow = {
  language: string;
  mode: string;
  state: string;
  assessmentPlan: string | null;
  grammarRetentionPolicyVersion: string | null;
};

export async function ownSession(
  client: Pick<Client, 'execute'>,
  session: LearnerSession,
  studySessionId: unknown
): Promise<SessionRow> {
  if (typeof studySessionId !== 'string') throw new StudyError('NOT_FOUND');
  const found = await client.execute({
    sql: 'SELECT language, mode, state, assessment_plan, grammar_retention_policy_version FROM study_sessions WHERE id = ? AND owner_id = ?',
    args: [studySessionId, session.userId]
  });
  const row = found.rows[0];
  if (!row) throw new StudyError('NOT_FOUND');
  return {
    language: String(row.language),
    mode: String(row.mode),
    state: String(row.state),
    assessmentPlan:
      row.assessment_plan === null ? null : String(row.assessment_plan),
    grammarRetentionPolicyVersion:
      row.grammar_retention_policy_version === null
        ? null
        : String(row.grammar_retention_policy_version)
  };
}

/** A skill of a session the caller has already read with `ownSession`. */
export type SessionRead = {
  studySessionId: string;
  skillId: string;
  study: SessionRow;
};

/** Reject a joined version row that is missing or withdrawn. */
function assertAvailable(row: Row | undefined): asserts row is Row {
  if (!row) throw new StudyError('NOT_FOUND');
  if (row.status === 'quarantined' || row.retired_at != null)
    throw new StudyError('CONTENT_UNAVAILABLE');
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
    sql: `SELECT s.state, v.status, v.retired_at, q.id, q.format, q.prompt, q.alternatives,
            EXISTS (SELECT 1 FROM attempts a WHERE a.owner_id = ? AND a.study_session_id = ? AND a.question_id = q.id) AS answered
          FROM study_sessions s
          CROSS JOIN ${sessionVersion} v
          LEFT JOIN questions q ON q.content_version_id = v.id AND q.prompt IS NOT NULL AND (q.holdout = 0 OR ? = 'assessment')
            AND (s.grammar_retention_plan IS NULL OR EXISTS (
              SELECT 1 FROM json_each(s.grammar_retention_plan, '$.questions') p
              WHERE json_extract(p.value, '$.skillId') = q.skill_id
                AND json_extract(p.value, '$.questionId') = q.id))
          WHERE s.id = ? AND s.owner_id = ?
          ORDER BY q.id`,
    args: [
      read.userId,
      read.studySessionId,
      read.userId,
      read.studySessionId,
      read.skillId,
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
    format: String(row.format) as ExerciseFormat,
    prompt: String(row.prompt),
    // Only multiple choice offers its alternatives; for other formats they
    // are accepted answers and stay on the server.
    alternatives:
      row.format !== 'multiple-choice' || row.alternatives === null
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
  return nextQuestionIn(client, session, { studySessionId, skillId, study });
}

/** `nextQuestion` for a session the caller has already read with `ownSession`. */
export async function nextQuestionIn(
  client: Client,
  session: LearnerSession,
  { studySessionId, skillId, study }: SessionRead
) {
  if (study.state !== 'active') throw new StudyError('SESSION_NOT_ACTIVE');
  if (typeof skillId !== 'string') throw new StudyError('NOT_FOUND');
  if (study.assessmentPlan !== null) {
    const planned = await getAssessment(client, session, studySessionId);
    if (planned.skillId !== skillId) throw new StudyError('NOT_FOUND');
    return {
      question: planned.question,
      answered: planned.answered,
      total: planned.total
    };
  }
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

/** What a lesson read is scoped to; a session pins the version it was started on. */
type LessonRead = {
  userId: string;
  language: string;
  skillId: unknown;
  studySessionId?: string;
};

/**
 * The version of a skill with its lesson, which must exist and be available:
 * the session's version when a session is given, the newest otherwise.
 */
async function lessonRow(
  client: Pick<Client, 'execute'>,
  read: LessonRead,
  explanationLanguage: string
) {
  if (typeof read.skillId !== 'string') throw new StudyError('NOT_FOUND');
  const { userId, studySessionId, language, skillId } = read;
  const found = await client.execute({
    sql: `SELECT v.id AS version_id, v.status, v.retired_at, l.title, l.explanation, l.examples, l.refs,
            t.title AS t_title, t.explanation AS t_explanation, t.examples AS t_examples, t.refs AS t_refs
          FROM ${studySessionId === undefined ? latestVersion : sessionVersion} v
          LEFT JOIN lessons l ON l.content_version_id = v.id
          LEFT JOIN lesson_translations t ON t.content_version_id = v.id AND t.explanation_language = ?`,
    args:
      studySessionId === undefined
        ? [skillId, language, explanationLanguage]
        : [
            userId,
            studySessionId,
            skillId,
            userId,
            studySessionId,
            skillId,
            skillId,
            language,
            explanationLanguage
          ]
  });
  const row = found.rows[0];
  assertAvailable(row);
  if (row.title === null) throw new StudyError('NOT_FOUND');
  return row;
}

/**
 * True when a session is finishing an earlier version of the lesson while a
 * newer, available one with a lesson has been published: the page says so, and the learner's
 * next session starts on the newer version. Without a session the newest is
 * what is shown, so there is nothing to say.
 */
async function newerVersionAvailable(
  client: Pick<Client, 'execute'>,
  read: LessonRead,
  shown: Row
) {
  if (read.studySessionId === undefined) return false;
  const newest = await client.execute({
    sql: "SELECT v.id, v.status FROM content_versions v JOIN lessons l ON l.content_version_id = v.id WHERE v.skill_id = ? AND v.language = ? ORDER BY v.status = 'quarantined', v.version DESC LIMIT 1",
    args: [String(read.skillId), read.language]
  });
  const row = newest.rows[0];
  return (
    row !== undefined &&
    String(row.id) !== String(shown.version_id) &&
    row.status !== 'quarantined'
  );
}

/** The lesson for an enrollment's explanation language, as the page shows it. */
async function readLesson(client: Client, read: LessonRead) {
  if (typeof read.language !== 'string') throw new StudyError('NOT_FOUND');
  const enrolled = await client.execute({
    sql: 'SELECT explanation_language FROM enrollments WHERE owner_id = ? AND language = ?',
    args: [read.userId, read.language]
  });
  if (!enrolled.rows[0]) throw new StudyError('NOT_FOUND');
  const chosen = String(enrolled.rows[0].explanation_language);
  const row = await lessonRow(client, read, chosen);
  const translated = chosen !== 'en' && row.t_title !== null;
  const pick = (own: string, english: string) =>
    String(translated ? row[own] : row[english]);
  return {
    newerVersionAvailable: await newerVersionAvailable(client, read, row),
    skillId: String(read.skillId),
    contentVersionId: String(row.version_id),
    title: pick('t_title', 'title'),
    explanation: pick('t_explanation', 'explanation'),
    examples: JSON.parse(pick('t_examples', 'examples')) as Record<
      string,
      string
    >[],
    references: JSON.parse(pick('t_refs', 'refs')) as string[],
    explanationLanguage: translated ? chosen : 'en',
    englishFallback: chosen !== 'en' && !translated,
    // Portuguese (Brazil) lessons are written in English by design, not by fallback.
    englishOnlyTrack: read.language === 'pt'
  };
}

/**
 * The stored lesson for a skill in a track the caller is enrolled in, in the
 * enrollment's explanation language. Without a stored translation the English
 * text is returned with `englishFallback` set so the page can say so.
 */
export function getLesson(
  client: Client,
  session: LearnerSession,
  language: string,
  skillId: string
) {
  return readLesson(client, { userId: session.userId, language, skillId });
}

/**
 * The lesson as the caller's own study session sees it: the version its first
 * attempt at the skill used, so the explanation matches the questions asked.
 */
export async function getSessionLesson(
  client: Client,
  session: LearnerSession,
  studySessionId: string,
  skillId: string
) {
  const study = await ownSession(client, session, studySessionId);
  return sessionLessonIn(client, session, { studySessionId, skillId, study });
}

/** `getSessionLesson` for a session the caller has already read with `ownSession`. */
export async function sessionLessonIn(
  client: Client,
  session: LearnerSession,
  { studySessionId, skillId, study }: SessionRead
) {
  if (study.mode === 'assessment') throw new StudyError('ASSESSMENT_MODE');
  return readLesson(client, {
    userId: session.userId,
    language: study.language,
    skillId,
    studySessionId
  });
}
