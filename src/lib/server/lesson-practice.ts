import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import type { Client } from '@libsql/client';
import {
  checkAnswer,
  checkAnswerText,
  normalizeAnswer
} from '../components/exercises/answer';
import { describeLearnerError } from './learner-api';
import type { LearnerSession } from './learner-session';
import {
  findReplay,
  getLesson,
  getSessionLesson,
  getStudySession,
  nextQuestion,
  recordAttempt,
  StudyError
} from './study';

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
  const raw = form.get('answer');
  if (typeof raw !== 'string') return null;
  const replay = await findReplay(client, learner, {
    studySessionId,
    questionId: field(form, 'questionId'),
    submissionKey: field(form, 'submissionKey'),
    evidenceKind: 'independent',
    answer: normalizeAnswer(raw)
  });
  return replay && { recorded: true as const, duplicate: replay.duplicate };
}

/** Record the answer to the question the session is currently on. */
export async function recordAnswer(
  client: Client,
  learner: LearnerSession,
  form: FormData,
  skillId: string
) {
  const text = checkAnswerText(form.get('answer'));
  if (!text.ok) return fail(400, { message: text.message });
  const studySessionId = field(form, 'studySessionId');
  const repeated = await repeatedAnswer(client, learner, form, studySessionId);
  if (repeated) return repeated;
  const next = await nextQuestion(client, learner, studySessionId, skillId);
  const question = next.question;
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
  if (!checked.ok) return fail(400, { message: checked.message });
  const attempt = await recordAttempt(client, learner, {
    studySessionId,
    questionId: question.id,
    submissionKey: field(form, 'submissionKey'),
    evidenceKind: 'independent',
    answer: checked.answer
  });
  return { recorded: true as const, duplicate: attempt.duplicate };
}
