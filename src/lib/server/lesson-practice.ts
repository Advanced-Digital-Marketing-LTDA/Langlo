import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import type { Client } from '@libsql/client';
import { checkAnswer, normalizeAnswer } from '../components/exercises/answer';
import { describeLearnerError } from './learner-api';
import type { LearnerSession } from './learner-session';
import { findReplay, nextQuestion, recordAttempt, StudyError } from './study';

// The practice half of the lesson page: serving the session's next exercise
// and recording the answer to it.

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
  const studySessionId = field(form, 'studySessionId');
  const repeated = await repeatedAnswer(client, learner, form, studySessionId);
  if (repeated) return repeated;
  const next = await nextQuestion(client, learner, studySessionId, skillId);
  const question = next.question;
  if (!question || question.id !== field(form, 'questionId'))
    throw new StudyError('STALE_QUESTION');
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
