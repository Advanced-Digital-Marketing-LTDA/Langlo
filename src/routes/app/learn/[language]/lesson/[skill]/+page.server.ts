import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { openAppDatabase } from '../../../../../../lib/server/db/app';
import { requireLearnerPage } from '../../../../../../lib/server/learner-session';
import { getLesson, StudyError } from '../../../../../../lib/server/study';

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

export const load: PageServerLoad = async (event) => {
  // The learner comes only from the verified session, never from the URL.
  const learner = requireLearnerPage(event);
  const config = event.locals.config;
  if (!config?.dataEnabled || !config.databaseUrl)
    error(503, { message: 'Study data is not available yet.' });
  const { client, close } = await openAppDatabase(config);
  try {
    return {
      language: event.params.language,
      unavailable: false as const,
      lesson: await getLesson(
        client,
        learner,
        event.params.language,
        event.params.skill
      )
    };
  } catch (thrown) {
    return lessonFailure(thrown, event.params.language);
  } finally {
    close();
  }
};
