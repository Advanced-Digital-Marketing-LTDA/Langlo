import { fail, isHttpError } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { studyPage } from '../../../lib/server/learner-api';
import { requireLearnerApi } from '../../../lib/server/learner-session';
import {
  EXPLANATION_LANGUAGES,
  listEnrollments,
  setExplanationLanguage
} from '../../../lib/server/enrollment';
import { getTimezone, setTimezone } from '../../../lib/server/preferences';

export const load: PageServerLoad = (event) =>
  studyPage(event, async (client, learner) => ({
    enrollments: await listEnrollments(client, learner),
    explanationLanguages: EXPLANATION_LANGUAGES,
    timezone: await getTimezone(client, learner)
  }));

/** Show 4xx repository failures on the form instead of an error page. */
async function toForm(run: () => Promise<unknown>, done: string) {
  try {
    await run();
  } catch (thrown) {
    if (isHttpError(thrown) && thrown.status < 500)
      return fail(thrown.status, { message: thrown.body.message });
    throw thrown;
  }
  return { saved: done };
}

export const actions: Actions = {
  explanationLanguage: async (event) => {
    const learner = requireLearnerApi(event);
    const form = await event.request.formData();
    return toForm(
      () =>
        studyPage(event, (client) =>
          setExplanationLanguage(client, learner, {
            language: form.get('language'),
            explanationLanguage: form.get('explanationLanguage')
          })
        ),
      'Lesson language saved.'
    );
  },
  timezone: async (event) => {
    const learner = requireLearnerApi(event);
    const form = await event.request.formData();
    return toForm(
      () =>
        studyPage(event, (client) =>
          setTimezone(client, learner, form.get('timezone'))
        ),
      'Timezone saved.'
    );
  }
};
