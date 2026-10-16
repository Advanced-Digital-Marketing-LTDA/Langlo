import { randomUUID } from 'node:crypto';
import { error, fail } from '@sveltejs/kit';
import type { Client } from '@libsql/client';
import type { Actions, PageServerLoad } from './$types';
import { checkAnswer } from '../../../../../../lib/components/exercises/answer';
import { openAppDatabase } from '../../../../../../lib/server/db/app';
import { describeLearnerError } from '../../../../../../lib/server/learner-api';
import {
  requireLearnerApi,
  requireLearnerPage
} from '../../../../../../lib/server/learner-session';
import {
  getLesson,
  nextQuestion,
  recordAttempt,
  StudyError
} from '../../../../../../lib/server/study';

type Learner = ReturnType<typeof requireLearnerPage>;

/** Withdrawn content gets an honest notice instead of an error page. */
function lessonFailure(thrown: unknown, language: string) {
  if (thrown instanceof StudyError) {
    if (thrown.code === 'CONTENT_UNAVAILABLE')
      return { language, unavailable: true as const, lesson: null };
    if (thrown.code === 'NOT_FOUND')
      error(404, { message: 'Lesson not found.' });
  }
  throw thrown;
}

/** Run with the app database, which is always closed afterwards. */
async function withDatabase<T>(
  config: App.Locals['config'],
  run: (client: Client) => Promise<T>
): Promise<T> {
  if (!config?.dataEnabled || !config.databaseUrl)
    error(503, { message: 'Study data is not available yet.' });
  const { client, close } = await openAppDatabase(config);
  try {
    return await run(client);
  } finally {
    close();
  }
}

/**
 * The next exercise of the learner's own session, when the page was opened
 * from one. A session that cannot serve a question yields a notice instead.
 */
async function exerciseFor(
  client: Client,
  learner: Learner,
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

export const load: PageServerLoad = async (event) => {
  // The learner comes only from the verified session, never from the URL.
  const learner = requireLearnerPage(event);
  const { language, skill } = event.params;
  try {
    return await withDatabase(event.locals.config, async (client) => ({
      language,
      unavailable: false as const,
      lesson: await getLesson(client, learner, language, skill),
      exercise: await exerciseFor(
        client,
        learner,
        event.url.searchParams.get('session'),
        skill
      )
    }));
  } catch (thrown) {
    return lessonFailure(thrown, language);
  }
};

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Record the answer to the question the session is currently on. */
async function recordAnswer(
  client: Client,
  learner: Learner,
  form: FormData,
  skillId: string
) {
  const studySessionId = field(form, 'studySessionId');
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

export const actions: Actions = {
  answer: async (event) => {
    const learner = requireLearnerApi(event);
    const form = await event.request.formData();
    try {
      return await withDatabase(event.locals.config, (client) =>
        recordAnswer(client, learner, form, event.params.skill)
      );
    } catch (thrown) {
      const described =
        thrown instanceof StudyError && describeLearnerError(thrown.code);
      if (!described) throw thrown;
      return fail(described.status, { message: described.message });
    }
  }
};
