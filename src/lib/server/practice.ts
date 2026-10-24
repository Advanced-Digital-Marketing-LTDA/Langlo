import type { Client, Row } from '@libsql/client';
import { z } from 'zod';
import type { LearnerSession } from './learner-session';
import {
  FALLBACK_EVALUATOR_VERSION,
  FALLBACK_RUBRIC_VERSION,
  FALLBACK_SETTLED_EVALUATOR_VERSION,
  HISTORICAL_FALLBACK_EVALUATOR_VERSION,
  HISTORICAL_FALLBACK_RUBRIC_VERSION
} from './evaluation/fallback';
import { PREPARED_EVALUATOR_VERSION } from './evaluation/prepared';
import { StudyError } from './study-error';
import { beginWrite } from './flashcards';
import {
  commitGrammarSessionReviews,
  allDueGrammarReviews,
  GRAMMAR_RETENTION_POLICY_VERSION
} from './grammar-retention';

const KEY_PATTERN = /^[0-9a-f-]{36}$/i;
const reviewSkillSelection = z
  .array(z.string())
  .min(1)
  .max(5)
  .refine((ids) => new Set(ids).size === ids.length);
const grammarPlanHeader = z.object({
  version: z.literal(GRAMMAR_RETENTION_POLICY_VERSION),
  questions: z.array(z.unknown()).max(5)
});

function validateSubmissionKey(value: unknown) {
  if (typeof value !== 'string' || !KEY_PATTERN.test(value))
    throw new StudyError('INVALID_SUBMISSION_KEY');
}

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

function assertSessionIdentity(
  row: Row,
  learner: LearnerSession,
  language: string,
  mode: string
) {
  if (row.owner_id !== learner.userId) throw new StudyError('NOT_FOUND');
  if (row.language !== language) throw new StudyError('NOT_FOUND');
  if (row.mode !== mode) throw new StudyError('NOT_FOUND');
}

/**
 * The learner's newest unfinished (active or paused) practice session in a
 * language, with how many answers it holds, leaving out `exceptId`. Review
 * sessions are not included.
 */
export async function unfinishedPractice(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession,
  language: string,
  exceptId = ''
): Promise<{ id: string; answered: number } | null> {
  const found = await client.execute({
    sql: `SELECT s.id,
        (SELECT COUNT(*) FROM attempts a WHERE a.owner_id = s.owner_id AND a.study_session_id = s.id) AS answered
      FROM study_sessions s
      WHERE s.owner_id = ? AND s.language = ? AND s.mode = 'practice' AND s.state IN ('active', 'paused') AND s.id <> ?
      ORDER BY s.created_at DESC, s.rowid DESC LIMIT 1`,
    args: [learner.userId, language, exceptId]
  });
  const row = found.rows[0];
  return row ? { id: String(row.id), answered: Number(row.answered) } : null;
}

/**
 * The learner's newest grammar review in a track that is not finished yet.
 * A review with a retired or missing topic cannot load, so it is not one.
 */
export async function unfinishedGrammarReview(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession,
  language: string
): Promise<{ id: string } | null> {
  const found = await client.execute({
    sql: `SELECT id FROM study_sessions
      WHERE owner_id = ? AND language = ? AND mode = 'mixed-review' AND state IN ('active', 'paused')
        AND NOT EXISTS (SELECT 1 FROM json_each(study_sessions.grammar_retention_plan, '$.questions') p
          WHERE NOT EXISTS (SELECT 1 FROM skills sk WHERE sk.id = json_extract(p.value, '$.skillId')
            AND sk.language = study_sessions.language AND sk.retired_at IS NULL))
      ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    args: [learner.userId, language]
  });
  const row = found.rows[0];
  return row ? { id: String(row.id) } : null;
}

/**
 * Start a practice session in an enrolled track, or continue the learner's
 * unfinished one: a new session begins only after the old one is finished.
 * The submission key makes the start idempotent: a repeated tap returns the
 * same session. The insert names the caller's own enrollment, so an unenrolled
 * language inserts nothing.
 */
export async function startPractice(
  client: Client,
  learner: LearnerSession,
  input: { language: string; submissionKey: unknown }
): Promise<{ id: string }> {
  validateSubmissionKey(input.submissionKey);
  const id = `practice:${input.submissionKey}`;
  const tx = await beginWrite(client);
  try {
    const unfinished = await unfinishedPractice(tx, learner, input.language);
    if (unfinished) {
      // Continuing a paused practice resumes it, so its lessons serve questions.
      await tx.execute({
        sql: "UPDATE study_sessions SET state = 'active', paused_at = NULL WHERE id = ? AND owner_id = ? AND state = 'paused'",
        args: [unfinished.id, learner.userId]
      });
      await tx.commit();
      return { id: unfinished.id };
    }
    await tx.execute({
      sql: `INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode, grammar_retention_policy_version)
      SELECT ?, e.owner_id, e.id, e.language, 'practice', ? FROM enrollments e
      WHERE e.owner_id = ? AND e.language = ? ON CONFLICT (id) DO NOTHING`,
      args: [
        id,
        GRAMMAR_RETENTION_POLICY_VERSION,
        learner.userId,
        input.language
      ]
    });
    const saved = await tx.execute({
      sql: 'SELECT owner_id, language, mode FROM study_sessions WHERE id = ?',
      args: [id]
    });
    const row = saved.rows[0];
    if (!row) throw new StudyError('NOT_FOUND');
    assertSessionIdentity(row, learner, input.language, 'practice');
    await tx.commit();
    return { id };
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  } finally {
    tx.close();
  }
}

/**
 * Close one of the caller's unfinished practices and delete every answer in
 * it. Unlike finishing, nothing is committed to the review schedule.
 */
export async function discardPractice(
  client: Client,
  learner: LearnerSession,
  id: string
): Promise<void> {
  const tx = await beginWrite(client);
  try {
    // Another tab may have finished it since it was chosen; a finished
    // practice keeps its answers and its committed review schedule.
    const open = await tx.execute({
      sql: "SELECT 1 FROM study_sessions WHERE id = ? AND owner_id = ? AND mode = 'practice' AND state IN ('active', 'paused')",
      args: [id, learner.userId]
    });
    if (!open.rows[0]) {
      await tx.commit();
      return;
    }
    await tx.execute({
      sql: 'DELETE FROM attempts WHERE owner_id = ? AND study_session_id = ?',
      args: [learner.userId, id]
    });
    await tx.execute({
      sql: "UPDATE study_sessions SET state = 'completed', paused_at = NULL WHERE id = ? AND owner_id = ? AND mode = 'practice'",
      args: [id, learner.userId]
    });
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  } finally {
    tx.close();
  }
}

/**
 * Discard every unfinished practice of the learner in a language, with all of
 * its answers, and start a fresh one. Continuing is the way to keep answers.
 */
export async function startPracticeOver(
  client: Client,
  learner: LearnerSession,
  input: { language: string; submissionKey: unknown }
): Promise<{ id: string }> {
  validateSubmissionKey(input.submissionKey);
  // A repeated tap carries the key of the session it already started: keep it.
  const own = `practice:${input.submissionKey}`;
  // A replay of a request whose session is already finished is answered with
  // that session; it must not finish whatever the learner began since.
  const replayed = await client.execute({
    sql: "SELECT owner_id, language, mode FROM study_sessions WHERE id = ? AND state = 'completed'",
    args: [own]
  });
  if (replayed.rows[0]) {
    assertSessionIdentity(
      replayed.rows[0],
      learner,
      input.language,
      'practice'
    );
    return { id: own };
  }
  for (;;) {
    const unfinished = await unfinishedPractice(
      client,
      learner,
      input.language,
      own
    );
    if (!unfinished) break;
    await discardPractice(client, learner, unfinished.id);
  }
  return startPractice(client, learner, input);
}

async function grammarReviewQuestions(
  tx: Pick<Client, 'execute'>,
  learner: LearnerSession,
  input: { language: string; skillIds: unknown[] }
) {
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
  return questions;
}

function reviewPlanSkills(serialized: unknown) {
  const plan = JSON.parse(String(serialized ?? '{}'));
  return Array.isArray(plan.questions)
    ? plan.questions.map((item: { skillId?: string }) => item.skillId)
    : [];
}

async function replayGrammarReview(
  tx: Pick<Client, 'execute'>,
  learner: LearnerSession,
  id: string,
  input: { language: string; skillIds: unknown[] }
) {
  const previous = await tx.execute({
    sql: 'SELECT owner_id, language, mode, grammar_retention_plan FROM study_sessions WHERE id = ?',
    args: [id]
  });
  if (previous.rows[0]) {
    const row = previous.rows[0];
    const priorSkills = reviewPlanSkills(row.grammar_retention_plan);
    assertSessionIdentity(row, learner, input.language, 'mixed-review');
    if (JSON.stringify(priorSkills) !== JSON.stringify(input.skillIds))
      throw new StudyError('NOT_FOUND');
    return true;
  }
  return false;
}

function validateGrammarReview(input: {
  submissionKey: unknown;
  skillIds: unknown[];
}) {
  validateSubmissionKey(input.submissionKey);
  const selection = reviewSkillSelection.safeParse(input.skillIds);
  if (!selection.success) throw new StudyError('INVALID_REVIEW_SELECTION');
  return selection.data;
}

async function assertDueGrammarSelection(
  tx: Pick<Client, 'execute'>,
  learner: LearnerSession,
  selection: { language: string; skillIds: string[] },
  now: number
) {
  // Any due skill may be chosen, so the Review tab can start today's topics
  // while older ones are still overdue; the session still takes at most five.
  const due = await allDueGrammarReviews(tx, learner, selection.language, now);
  const dueIds = new Set(due.map((item) => item.skillId));
  if (!selection.skillIds.every((id) => dueIds.has(id)))
    throw new StudyError('STALE_GRAMMAR_REVIEW');
}

async function reviewEnrollmentId(
  tx: Pick<Client, 'execute'>,
  learner: LearnerSession,
  language: string
) {
  const enrolled = await tx.execute({
    sql: 'SELECT id FROM enrollments WHERE owner_id = ? AND language = ?',
    args: [learner.userId, language]
  });
  if (!enrolled.rows[0]) throw new StudyError('NOT_FOUND');
  return enrolled.rows[0].id;
}

/** Freeze at most five due skills into a manual, one-question-per-skill review session. */
export async function startGrammarReview(
  client: Client,
  learner: LearnerSession,
  input: { language: string; submissionKey: unknown; skillIds: unknown[] },
  now = Date.now()
) {
  const selection = { ...input, skillIds: validateGrammarReview(input) };
  const id = `grammar-review:${input.submissionKey}`;
  const tx = await beginWrite(client);
  try {
    if (await replayGrammarReview(tx, learner, id, selection)) {
      await tx.commit();
      return { id };
    }
    await assertDueGrammarSelection(tx, learner, selection, now);
    const enrollmentId = await reviewEnrollmentId(tx, learner, input.language);
    const questions = await grammarReviewQuestions(tx, learner, selection);
    await tx.execute({
      sql: `INSERT INTO study_sessions (id, owner_id, enrollment_id, language,
        mode, grammar_retention_policy_version, grammar_retention_plan)
        VALUES (?, ?, ?, ?, 'mixed-review', ?, ?)`,
      args: [
        id,
        learner.userId,
        enrollmentId,
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

function assertGrammarPlan(rows: Row[]) {
  if (rows.some((row) => row.retired_at !== null))
    throw new StudyError('CONTENT_UNAVAILABLE');
  const plan = grammarPlanHeader.safeParse(
    JSON.parse(String(rows[0].grammar_retention_plan))
  );
  if (!plan.success) throw new StudyError('CONTENT_UNAVAILABLE');
  if (plan.data.questions.length !== rows.length)
    throw new StudyError('CONTENT_UNAVAILABLE');
}

export async function grammarReviewPlan(
  client: Pick<Client, 'execute'>,
  learner: LearnerSession,
  id: string
) {
  const found = await client.execute({
    sql: `SELECT s.language, s.grammar_retention_plan, p.value AS plan_item,
        sk.id AS skill_id, sk.retired_at, COALESCE(l.title, sk.id) AS title,
        EXISTS (SELECT 1 FROM attempts a WHERE a.owner_id = s.owner_id
          AND a.study_session_id = s.id AND a.question_id = json_extract(p.value, '$.questionId')) AS answered,
        EXISTS (SELECT 1 FROM attempts WHERE attempts.owner_id = s.owner_id
          AND attempts.study_session_id = s.id AND attempts.question_id = json_extract(p.value, '$.questionId')
          AND NOT (${awaitingRatingSql} AND ${rateableSql}))
        AND NOT EXISTS (SELECT 1 FROM attempts WHERE attempts.owner_id = s.owner_id
          AND attempts.study_session_id = s.id AND attempts.question_id = json_extract(p.value, '$.questionId')
          AND ${awaitingRatingSql} AND ${rateableSql})
        AND NOT EXISTS (SELECT 1 FROM attempts WHERE attempts.owner_id = s.owner_id
          AND attempts.study_session_id = s.id AND attempts.question_id = json_extract(p.value, '$.questionId')
          AND ${beingGradedSql}) AS reviewed
      FROM study_sessions s JOIN json_each(s.grammar_retention_plan, '$.questions') p
      JOIN skills sk ON sk.id = json_extract(p.value, '$.skillId') AND sk.language = s.language
      LEFT JOIN content_versions v ON v.id = json_extract(p.value, '$.contentVersionId')
      LEFT JOIN lessons l ON l.content_version_id = v.id
      WHERE s.id = ? AND s.owner_id = ? AND s.mode = 'mixed-review'
      ORDER BY CAST(p.key AS INTEGER)`,
    args: [
      ...awaitingRatingArgs,
      ...awaitingRatingArgs,
      ...beingGradedArgs,
      id,
      learner.userId
    ]
  });
  if (!found.rows.length) throw new StudyError('NOT_FOUND');
  assertGrammarPlan(found.rows);
  return found.rows.map((row) => ({
    skillId: String(row.skill_id),
    title: String(row.title),
    answered: Boolean(row.answered),
    // Answered with no answer still waiting for its rating, so the topic
    // leaves the review's list.
    reviewed: Boolean(row.reviewed)
  }));
}

/**
 * An attempt whose correct answer still waits for its difficulty rating. Such
 * answers are discarded when the session finishes.
 */
const awaitingRatingSql = `attempts.grammar_rating IS NULL AND EXISTS (
    SELECT 1 FROM study_sessions s WHERE s.id = attempts.study_session_id
      AND s.owner_id = attempts.owner_id AND s.grammar_retention_policy_version = ?
  ) AND (
    EXISTS (SELECT 1 FROM evaluations f WHERE f.attempt_id = attempts.id AND f.owner_id = attempts.owner_id
      AND f.evaluator_version = ? AND f.rubric_version = ? || ':' || attempts.content_version_id AND f.outcome = 'correct')
    OR (NOT EXISTS (SELECT 1 FROM evaluations f WHERE f.attempt_id = attempts.id AND f.owner_id = attempts.owner_id
        AND f.evaluator_version = ? AND f.rubric_version = ? || ':' || attempts.content_version_id)
      AND EXISTS (SELECT 1 FROM evaluations p WHERE p.attempt_id = attempts.id AND p.owner_id = attempts.owner_id
        AND p.evaluator_version = ? AND p.rubric_version = attempts.content_version_id AND p.outcome = 'correct'))
  )`;
/**
 * A typed answer the AI grader has neither judged nor given up on yet. It may
 * still turn out correct and need a rating, so its topic is not reviewed.
 */
const beingGradedSql = `attempts.not_sure = 0 AND EXISTS (
    SELECT 1 FROM evaluations p WHERE p.attempt_id = attempts.id AND p.owner_id = attempts.owner_id
      AND p.evaluator_version = ? AND p.rubric_version = attempts.content_version_id AND p.outcome = 'uncertain'
  ) AND NOT EXISTS (
    SELECT 1 FROM evaluations f WHERE f.attempt_id = attempts.id AND f.owner_id = attempts.owner_id
      AND f.evaluator_version IN (?, ?)
  )`;
const beingGradedArgs = [
  PREPARED_EVALUATOR_VERSION,
  FALLBACK_EVALUATOR_VERSION,
  FALLBACK_SETTLED_EVALUATOR_VERSION
];

/** Helped and Not sure answers never take a difficulty rating. */
const rateableSql = 'attempts.received_help = 0 AND attempts.not_sure = 0';
const awaitingRatingArgs = [
  GRAMMAR_RETENTION_POLICY_VERSION,
  FALLBACK_EVALUATOR_VERSION,
  FALLBACK_RUBRIC_VERSION,
  FALLBACK_EVALUATOR_VERSION,
  FALLBACK_RUBRIC_VERSION,
  PREPARED_EVALUATOR_VERSION
];

async function discardUnratedPracticeAnswers(
  tx: Pick<Client, 'execute'>,
  learner: LearnerSession,
  id: string
) {
  await tx.execute({
    sql: `DELETE FROM attempts WHERE owner_id = ? AND study_session_id = ?
        AND ${awaitingRatingSql}`,
    args: [learner.userId, id, ...awaitingRatingArgs]
  });
}

/** Mark one of the caller's own practice sessions as completed. */
export async function finishPractice(
  client: Client,
  learner: LearnerSession,
  id: string
): Promise<void> {
  await inWrite(client, (tx) => completePractice(tx, learner, id));
}

type WriteTransaction = Awaited<ReturnType<typeof beginWrite>>;

/** Run one write transaction, rolled back if it fails. */
async function inWrite(
  client: Client,
  run: (tx: WriteTransaction) => Promise<void>
) {
  const tx = await beginWrite(client);
  try {
    await run(tx);
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  } finally {
    tx.close();
  }
}

async function completePractice(
  tx: WriteTransaction,
  learner: LearnerSession,
  id: string
) {
  const found = await tx.execute({
    sql: "SELECT state, language FROM study_sessions WHERE id = ? AND owner_id = ? AND mode IN ('practice', 'mixed-review')",
    args: [id, learner.userId]
  });
  const session = found.rows[0];
  if (!session) throw new StudyError('NOT_FOUND');
  if (session.state === 'completed') return;
  await discardUnratedPracticeAnswers(tx, learner, id);
  await tx.execute({
    sql: "UPDATE study_sessions SET state = 'completed', paused_at = NULL WHERE id = ? AND owner_id = ? AND mode IN ('practice', 'mixed-review')",
    args: [id, learner.userId]
  });
  await commitGrammarSessionReviews(tx, learner, id);
}

/**
 * Finish a grammar review once every one of its topics is reviewed. Sessions
 * of other modes are left as they are.
 */
export async function finishReviewedGrammarReview(
  client: Client,
  learner: LearnerSession,
  session: { id: string; mode: string }
): Promise<void> {
  if (session.mode !== 'mixed-review') return;
  const id = session.id;
  // The check and the finish share one write, so no answer lands between them.
  await inWrite(client, async (tx) => {
    const plan = await grammarReviewPlan(tx, learner, id);
    if (plan.every((topic) => topic.reviewed))
      await completePractice(tx, learner, id);
  });
}

/**
 * What a practice session has covered so far. Each attempt counts once, by
 * its verdict: Jev, historical Decisions, prepared, then newest evaluation.
 * An attempt not yet evaluated counts as pending.
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
          AND CASE e.evaluator_version
            WHEN ? THEN e.rubric_version = ? || ':' || a.content_version_id
            WHEN ? THEN e.rubric_version = ? || ':' || a.content_version_id
            WHEN ? THEN e.rubric_version = a.content_version_id
            ELSE 1 END
          ORDER BY CASE e.evaluator_version WHEN ? THEN 0 WHEN ? THEN 1 WHEN ? THEN 2 ELSE 3 END,
            e.created_at DESC, e.id DESC LIMIT 1) AS outcome
      FROM attempts a WHERE a.study_session_id = ? AND a.owner_id = ?
      ORDER BY a.created_at, a.id`,
    args: [
      FALLBACK_EVALUATOR_VERSION,
      FALLBACK_RUBRIC_VERSION,
      HISTORICAL_FALLBACK_EVALUATOR_VERSION,
      HISTORICAL_FALLBACK_RUBRIC_VERSION,
      PREPARED_EVALUATOR_VERSION,
      FALLBACK_EVALUATOR_VERSION,
      HISTORICAL_FALLBACK_EVALUATOR_VERSION,
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
