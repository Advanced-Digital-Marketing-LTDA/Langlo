import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import type { Client } from '@libsql/client';
import {
  checkAnswer,
  checkAnswerText,
  normalizeAnswer
} from '../components/exercises/answer';
import type { FallbackEvaluator } from './evaluation/runtime';
import { describeLearnerError } from './learner-api';
import type { LearnerSession } from './learner-session';
import {
  getAttempt,
  findReplay,
  getLesson,
  getSessionLesson,
  getStudySession,
  nextQuestion,
  recordAttempt,
  StudyError
} from './study';
import { ownSession } from './study-content';
import { feedbackOutcome } from './assessment';
import type { ExerciseQuestion } from '../components/exercises/answer';

// The practice half of the lesson page: serving the session's next exercise
// and recording the answer to it.

/**
 * The lesson of the page: as the learner's session sees it when the page was
 * opened from one, so the explanation matches the questions asked.
 */
export async function lessonFor(
  client: Client,
  learner: LearnerSession,
  page: { language: string; skillId: string; studySessionId: string | null }
) {
  if (!page.studySessionId)
    return getLesson(client, learner, page.language, page.skillId);
  const study = await getStudySession(client, learner, page.studySessionId);
  if (study.language !== page.language) throw new StudyError('NOT_FOUND');
  return getSessionLesson(client, learner, page.studySessionId, page.skillId);
}

/**
 * The next exercise of the learner's own session, when the page was opened
 * from one. A session that cannot serve a question yields a notice instead.
 */
export async function exerciseFor(
  client: Client,
  learner: LearnerSession,
  studySessionId: string | null,
  skillId: string
) {
  if (!studySessionId) return null;
  try {
    const next = await nextQuestion(client, learner, studySessionId, skillId);
    // One key per page load: a repeated tap of Submit replays, not duplicates.
    return {
      studySessionId,
      submissionKey: randomUUID(),
      notice: null,
      ...next
    };
  } catch (thrown) {
    const described =
      thrown instanceof StudyError && describeLearnerError(thrown.code);
    if (!described) throw thrown;
    return { studySessionId, notice: described.message, question: null };
  }
}

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/**
 * A retry of an answer that was already recorded gets the original result,
 * even though the session has since moved on to its next question.
 */
async function repeatedAnswer(
  client: Client,
  learner: LearnerSession,
  form: FormData,
  studySessionId: string
) {
  const raw = form.get('intent') === 'unsure' ? '' : form.get('answer');
  if (typeof raw !== 'string') return null;
  const replay = await findReplay(client, learner, {
    studySessionId,
    questionId: field(form, 'questionId'),
    submissionKey: field(form, 'submissionKey'),
    evidenceKind: form.has('retryAttemptId') ? 'assisted' : 'independent',
    answer: form.get('intent') === 'unsure' ? '' : normalizeAnswer(raw),
    notSure: form.get('intent') === 'unsure'
  });
  return replay && { recorded: true as const, duplicate: replay.duplicate };
}

/** Record the answer to the question the session is currently on. */
export async function recordAnswer(
  client: Client,
  learner: LearnerSession,
  form: FormData,
  skillId: string,
  fallback?: FallbackEvaluator
) {
  const notSure = form.get('intent') === 'unsure';
  const text = checkAnswerText(form.get('answer'));
  if (!notSure && !text.ok) return fail(400, { message: text.message });
  const studySessionId = field(form, 'studySessionId');
  const study = await ownSession(client, learner, studySessionId);
  if (study.mode === 'assessment') throw new StudyError('ASSESSMENT_MODE');
  const repeated = await repeatedAnswer(client, learner, form, studySessionId);
  if (repeated) return repeated;
  const retry = field(form, 'retryAttemptId');
  const question = retry
    ? await retryQuestion(client, learner, studySessionId, skillId, retry)
    : (await nextQuestion(client, learner, studySessionId, skillId)).question;
  if (!question || question.id !== field(form, 'questionId')) {
    // A concurrent request may have recorded this very submission after the
    // first lookup; it is a retry then, not a stale question.
    const raced = await repeatedAnswer(client, learner, form, studySessionId);
    if (raced) return raced;
    throw new StudyError('STALE_QUESTION');
  }
  const checked = checkAnswer(
    question.format,
    form.get('answer'),
    question.alternatives
  );
  if (!notSure && !checked.ok) return fail(400, { message: checked.message });
  const attempt = await recordAttempt(
    client,
    learner,
    {
      studySessionId,
      questionId: question.id,
      submissionKey: field(form, 'submissionKey'),
      evidenceKind: retry ? 'assisted' : 'independent',
      answer: notSure ? '' : checked.ok ? checked.answer : '',
      notSure
    },
    { fallback }
  );
  return { recorded: true as const, duplicate: attempt.duplicate };
}

async function retryQuestion(
  client: Client,
  learner: LearnerSession,
  sessionId: string,
  skillId: string,
  attemptId: string
): Promise<ExerciseQuestion> {
  const prior = await getAttempt(client, learner, attemptId);
  if (prior.studySessionId !== sessionId || prior.skillId !== skillId)
    throw new StudyError('NOT_FOUND');
  const found = await client.execute({
    sql: 'SELECT id, format, prompt, alternatives FROM questions WHERE id = ? AND holdout = 0',
    args: [prior.questionId]
  });
  const row = found.rows[0];
  if (!row) throw new StudyError('CONTENT_UNAVAILABLE');
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

/** Practice feedback is persisted history, so a reload cannot erase or upgrade it. */
export async function practiceFeedback(
  client: Client,
  learner: LearnerSession,
  sessionId: string | null,
  skillId: string
) {
  if (!sessionId) return null;
  const study = await ownSession(client, learner, sessionId);
  if (study.mode === 'assessment') throw new StudyError('ASSESSMENT_MODE');
  const found = await client.execute({
    sql: `SELECT a.*, q.answer AS expected_answer, v.status FROM attempts a
      JOIN questions q ON q.id = a.question_id JOIN content_versions v ON v.id = a.content_version_id
      WHERE a.owner_id = ? AND a.study_session_id = ? AND a.skill_id = ? AND q.holdout = 0
      ORDER BY a.created_at DESC, a.rowid DESC LIMIT 1`,
    args: [learner.userId, sessionId, skillId]
  });
  const row = found.rows[0];
  if (!row || row.status === 'quarantined') return null;
  const evaluations = await client.execute({
    sql: 'SELECT * FROM evaluations WHERE owner_id = ? AND attempt_id = ?',
    args: [learner.userId, row.id]
  });
  return {
    attemptId: String(row.id),
    questionId: String(row.question_id),
    contentVersionId: String(row.content_version_id),
    reportSubmissionKey: randomUUID(),
    answer: String(row.answer),
    expectedAnswer:
      row.expected_answer === null ? null : String(row.expected_answer),
    outcome: row.not_sure
      ? ('uncertain' as const)
      : feedbackOutcome(evaluations.rows, String(row.content_version_id)),
    evidenceKind: String(row.evidence_kind),
    notSure: Boolean(row.not_sure),
    retryQuestion:
      study.state === 'active'
        ? await retryQuestion(
            client,
            learner,
            sessionId,
            skillId,
            String(row.id)
          )
        : null,
    submissionKey: randomUUID()
  };
}
