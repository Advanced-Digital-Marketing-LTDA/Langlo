import { fail } from '@sveltejs/kit';
import type { Client } from '@libsql/client';
import type { LearnerSession } from './learner-session';
import type { FallbackEvaluator } from './evaluation/runtime';
import { checkAnswer, checkAnswerText } from '../components/exercises/answer';
import { findReplay, recordAttempt, StudyError } from './study';
import { getAssessment } from './assessment';

export async function recordAssessmentAnswer(
  client: Client,
  learner: LearnerSession,
  id: string,
  form: FormData,
  fallback?: FallbackEvaluator
) {
  const notSure = form.get('intent') === 'unsure';
  const checked = checkAnswerText(form.get('answer'));
  if (!notSure && !checked.ok) return fail(400, { message: checked.message });
  const input = {
    studySessionId: id,
    questionId: String(form.get('questionId') ?? ''),
    submissionKey: String(form.get('submissionKey') ?? ''),
    evidenceKind: 'independent' as const,
    answer: notSure ? '' : checked.ok ? checked.answer : '',
    notSure
  };
  if (await findReplay(client, learner, input)) return { recorded: true };
  const assessment = await getAssessment(client, learner, id);
  const question = assessment.question;
  if (!question || question.id !== input.questionId)
    throw new StudyError('STALE_QUESTION');
  const answer = checkAnswer(
    question.format,
    input.answer,
    question.alternatives
  );
  if (!notSure && !answer.ok) return fail(400, { message: answer.message });
  await recordAttempt(client, learner, input, { fallback });
  return { recorded: true };
}
