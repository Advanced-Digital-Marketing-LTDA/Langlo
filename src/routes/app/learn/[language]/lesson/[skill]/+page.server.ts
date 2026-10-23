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
  lessonFor,
  practiceFor,
  ratePracticeAnswer,
  recordAnswer,
  reportLessonIssue
} from '../../../../../../lib/server/lesson-practice';
import { StudyError } from '../../../../../../lib/server/study';
import { normalizeMapReturnTo } from '../../../../../../lib/skill-map';

/** Withdrawn content gets an honest notice instead of an error page. */
function lessonFailure(thrown: unknown, language: string, returnTo: string) {
  if (thrown instanceof StudyError) {
    if (thrown.code === 'CONTENT_UNAVAILABLE')
      return { language, returnTo, unavailable: true as const, lesson: null };
    if (thrown.code === 'NOT_FOUND') error(404, 'Lesson not found.');
    const described = describeLearnerError(thrown.code);
    if (described) error(described.status, described.message);
  }
  throw thrown;
}

/**
 * Both reads finish before the page fails, so one failure never hides the
 * other: an outage outranks a missing lesson and is not shown as a 404.
 */
function mostSevereFailure(results: PromiseSettledResult<unknown>[]) {
  const reasons = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : []
  );
  return (
    reasons.find((reason) => !(reason instanceof StudyError)) ?? reasons[0]
  );
}

/** Run with the app database, which is always closed afterwards. */
async function withDatabase<T>(
  config: App.Locals['config'],
  run: (client: Client) => Promise<T>
): Promise<T> {
  if (!config?.dataEnabled || !config.databaseUrl)
    error(503, 'Study data is not available yet.');
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
  const returnTo = normalizeMapReturnTo(event.url.searchParams.get('returnTo'));
  try {
    return await withDatabase(event.locals.config, async (client) => {
      // The lesson and the practice state are independent reads: one round
      // trip each is the cost, so they overlap instead of queueing.
      const settled = await Promise.allSettled([
        lessonFor(client, learner, {
          language,
          skillId: skill,
          studySessionId
        }),
        practiceFor(client, learner, studySessionId, skill)
      ]);
      const [lessonRead, practiceRead] = settled;
      if (
        lessonRead.status === 'rejected' ||
        practiceRead.status === 'rejected'
      )
        throw mostSevereFailure(settled);
      const lesson = lessonRead.value;
      const practice = practiceRead.value;
      return {
        language,
        returnTo,
        unavailable: false as const,
        reportSubmissionKey: randomUUID(),
        lesson,
        exercise: practice.exercise,
        feedback: practice.feedback
      };
    });
  } catch (thrown) {
    return lessonFailure(thrown, language, returnTo);
  }
};

export const actions: Actions = {
  report: async (event) => {
    const learner = requireLearnerApi(event);
    const form = await event.request.formData();
    try {
      return await withDatabase(event.locals.config, (client) =>
        reportLessonIssue(client, learner, form, {
          language: event.params.language,
          skillId: event.params.skill
        })
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
  },
  rate: async (event) => {
    const learner = requireLearnerApi(event);
    const form = await event.request.formData();
    try {
      return await withDatabase(event.locals.config, (client) =>
        ratePracticeAnswer(client, learner, form, event.params.skill)
      );
    } catch (thrown) {
      const described =
        thrown instanceof StudyError && describeLearnerError(thrown.code);
      if (!described) throw thrown;
      return fail(described.status, { message: described.message });
    }
  }
};
