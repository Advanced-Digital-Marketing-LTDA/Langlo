import { error, fail } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { Client } from '@libsql/client';
import type { Actions, PageServerLoad } from './$types';
import { openAppDatabase } from '../../../../../../lib/server/db/app';
import { fallbackEvaluator } from '../../../../../../lib/server/evaluation/runtime';
import { describeLearnerError } from '../../../../../../lib/server/learner-api';
import {
  requireLearnerApi,
  requireLearnerPage
} from '../../../../../../lib/server/learner-session';
import {
  exerciseFor,
  lessonFor,
  practiceFeedback,
  recordAnswer
} from '../../../../../../lib/server/lesson-practice';
import { StudyError } from '../../../../../../lib/server/study';
import { reportContentForm } from '../../../../../../lib/server/content-reports';

/** Withdrawn content gets an honest notice instead of an error page. */
function lessonFailure(thrown: unknown, language: string) {
  if (thrown instanceof StudyError) {
    if (thrown.code === 'CONTENT_UNAVAILABLE')
      return { language, unavailable: true as const, lesson: null };
    if (thrown.code === 'NOT_FOUND')
      error(404, { message: 'Lesson not found.' });
    const described = describeLearnerError(thrown.code);
    if (described) error(described.status, { message: described.message });
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

export const load: PageServerLoad = async (event) => {
  // The learner comes only from the verified session, never from the URL.
  const learner = requireLearnerPage(event);
  const { language, skill } = event.params;
  const studySessionId = event.url.searchParams.get('session');
  try {
    return await withDatabase(event.locals.config, async (client) => ({
      language,
      unavailable: false as const,
      reportSubmissionKey: randomUUID(),
      lesson: await lessonFor(client, learner, {
        language,
        skillId: skill,
        studySessionId
      }),
      exercise: await exerciseFor(client, learner, studySessionId, skill),
      feedback: await practiceFeedback(client, learner, studySessionId, skill)
    }));
  } catch (thrown) {
    return lessonFailure(thrown, language);
  }
};

export const actions: Actions = {
  report: async (event) => {
    const learner = requireLearnerApi(event);
    const form = await event.request.formData();
    try {
      return await withDatabase(event.locals.config, (client) =>
        reportContentForm(client, learner, form)
      );
    } catch (thrown) {
      const described =
        thrown instanceof StudyError && describeLearnerError(thrown.code);
      if (described)
        return fail(described.status, { reportError: described.message });
      throw thrown;
    }
  },
  answer: async (event) => {
    const learner = requireLearnerApi(event);
    const form = await event.request.formData();
    try {
      return await withDatabase(event.locals.config, (client) =>
        recordAnswer(
          client,
          learner,
          form,
          event.params.skill,
          fallbackEvaluator(client, event.locals.config)
        )
      );
    } catch (thrown) {
      const described =
        thrown instanceof StudyError && describeLearnerError(thrown.code);
      if (!described) throw thrown;
      return fail(described.status, { message: described.message });
    }
  }
};
